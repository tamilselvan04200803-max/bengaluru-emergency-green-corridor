"""
Production-grade Offline Telemetry Simulation Server for Bengaluru Digital Twin.

Key capabilities:
1. Loads Bengaluru road network, traffic signals, and hospitals from GeoJSON.
2. Constructs a directed topological graph using NetworkX (with custom Dijkstra adjacency fallback).
3. Maps traffic signals and hospital ingress points to graph vertices using spatial nearest-neighbor.
4. Simulates 3 to 5 active emergency ambulances traversing shortest paths (Dijkstra/A*) toward destination hospitals.
5. Calculates realistic movement along road linestrings (40-60 km/h) with heading, altitude, and current road OSM ID.
6. Dynamic CongestionEngine updating edge weights with rush-hour multiplier and blockage injection.
7. Dynamic A* route evaluation rerouting when edge congestion > 0.85.
8. Multi-junction Green Wave window calculated via min(300.0m, speed_mps * 25.0s).
9. Multi-ambulance ConflictArbiter prioritizing by patient criticality tier and ETA.
10. Broadcasts telemetry at 10Hz and decoupled state frame at 2Hz over WebSocket (ws://0.0.0.0:8765).
"""

from __future__ import annotations

import asyncio
import heapq
import json
import logging
import math
import os
import random
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False

import websockets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("TelemetryServer")

EARTH_RADIUS_M = 6371000.0
GREEN_WAVE_DISTANCE_M = 300.0
GREEN_WAVE_ETA_SEC = 25.0


def haversine_distance(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Calculate great-circle distance between two points in meters."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EARTH_RADIUS_M * c


def calculate_bearing(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Calculate compass heading/bearing from point 1 to point 2 in degrees (0-360)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    lam1, lam2 = math.radians(lon1), math.radians(lon2)
    y = math.sin(lam2 - lam1) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(lam2 - lam1)
    b = math.degrees(math.atan2(y, x))
    return round((b + 360.0) % 360.0, 2)


def interpolate_coord(p1: List[float], p2: List[float], fraction: float) -> List[float]:
    """Linear interpolation between two 3D or 2D coordinates [lon, lat, alt?]."""
    fraction = max(0.0, min(1.0, fraction))
    lon = p1[0] + (p2[0] - p1[0]) * fraction
    lat = p1[1] + (p2[1] - p1[1]) * fraction
    alt1 = p1[2] if len(p1) > 2 else 920.0
    alt2 = p2[2] if len(p2) > 2 else 920.0
    alt = alt1 + (alt2 - alt1) * fraction
    return [lon, lat, round(alt, 2)]


def extract_id(val: Any) -> Any:
    """Parse integer if numeric or return string identifier for OSM feature/node."""
    if val is None:
        return None
    val_str = str(val).strip()
    if val_str.isdigit():
        return int(val_str)
    try:
        return int(val_str)
    except (ValueError, TypeError):
        return val_str


def get_ambulance_criticality_tier(vehicle_id: str) -> int:
    """Determine patient criticality tier from vehicle ID."""
    if vehicle_id == "AMB-108-01":
        return 1
    elif vehicle_id in ("AMB-108-02", "AMB-108-03"):
        return 2
    elif vehicle_id in ("AMB-108-04", "AMB-108-05"):
        return 3
    return 1


@dataclass
class RoadEdge:
    id: Any
    start_node: str
    end_node: str
    name: str
    length_m: float
    maxspeed_kmh: float
    oneway: bool
    coordinates: List[List[float]]
    weight: float  # estimated travel time in seconds


@dataclass
class RoutePoint:
    lon: float
    lat: float
    alt: float
    road_id: Any
    segment_idx: int
    edge_u: str
    edge_v: str


@dataclass
class AmbulanceInfo:
    vehicle_id: str
    criticality_tier: int  # 1=critical, 2=urgent, 3=standard
    eta_seconds: float     # ETA to contested junction


class ConflictArbiter:
    """Per-junction ownership lock resolving simultaneous preemption conflicts."""

    def __init__(self):
        self._locks: Dict[Any, AmbulanceInfo] = {}
        self._advisories: Dict[str, float] = {}

    def request_preemption(self, junction_osm_id: Any, info: AmbulanceInfo) -> bool:
        """
        Returns True if this ambulance wins or holds the junction preemption.
        Conflict resolution order:
        1. patient_criticality_tier (lower number = higher priority)
        2. ETA to junction (shorter = higher priority, as tiebreaker)
        3. Deterministic tiebreaker on vehicle_id
        """
        jid = extract_id(junction_osm_id)
        holder = self._locks.get(jid)
        if holder is None:
            self._locks[jid] = info
            return True

        if holder.vehicle_id == info.vehicle_id:
            self._locks[jid] = info
            return True

        challenger_wins = False
        if info.criticality_tier < holder.criticality_tier:
            challenger_wins = True
        elif info.criticality_tier == holder.criticality_tier:
            if info.eta_seconds < holder.eta_seconds:
                challenger_wins = True
            elif info.eta_seconds == holder.eta_seconds:
                challenger_wins = info.vehicle_id < holder.vehicle_id

        if challenger_wins:
            self._advisories[holder.vehicle_id] = 30.0
            self._locks[jid] = info
            return True
        else:
            self._advisories[info.vehicle_id] = 30.0
            return False

    def release(self, junction_osm_id: Any, vehicle_id: str):
        jid = extract_id(junction_osm_id)
        holder = self._locks.get(jid)
        if holder and holder.vehicle_id == vehicle_id:
            del self._locks[jid]

    def get_speed_advisory(self, vehicle_id: str) -> Optional[float]:
        return self._advisories.pop(vehicle_id, None)


class CustomGraph:
    """Fallback adjacency list directed graph with Dijkstra shortest path."""

    def __init__(self):
        self.adj: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.nodes: Set[str] = set()

    def add_node(self, node: str):
        self.nodes.add(node)
        if node not in self.adj:
            self.adj[node] = {}

    def add_edge(self, u: str, v: str, **attrs):
        self.add_node(u)
        self.add_node(v)
        self.adj[u][v] = attrs

    def shortest_path(self, source: str, target: str, weight: str = "weight") -> List[str]:
        if source not in self.adj or target not in self.nodes:
            raise ValueError(f"Node {source} or {target} not in graph")
        
        dist: Dict[str, float] = {source: 0.0}
        prev: Dict[str, Optional[str]] = {source: None}
        pq: List[Tuple[float, str]] = [(0.0, source)]

        while pq:
            d, u = heapq.heappop(pq)
            if u == target:
                break
            if d > dist.get(u, float("inf")):
                continue

            for v, data in self.adj.get(u, {}).items():
                w = data.get(weight, 1.0)
                new_d = d + w
                if new_d < dist.get(v, float("inf")):
                    dist[v] = new_d
                    prev[v] = u
                    heapq.heappush(pq, (new_d, v))

        if target not in prev and target != source:
            raise ValueError(f"No path between {source} and {target}")

        path = []
        curr = target
        while curr is not None:
            path.append(curr)
            curr = prev.get(curr)
        path.reverse()
        return path


class RoadNetwork:
    """Represents the topological road graph and mapped points of interest."""

    def __init__(self):
        self.nx_graph: Optional[nx.DiGraph] = nx.DiGraph() if HAS_NETWORKX else None
        self.fallback_graph: CustomGraph = CustomGraph()
        self.node_coords: Dict[str, List[float]] = {}
        self.edges: Dict[Tuple[str, str], RoadEdge] = {}
        self.road_features: Dict[Any, RoadEdge] = {}
        self.signals_by_node: Dict[str, Dict[str, Any]] = {}
        self.hospitals: Dict[str, Dict[str, Any]] = {}
        self.signals_raw: List[Dict[str, Any]] = []

    def load_from_geojson(
        self,
        roads_path: Union[str, Path],
        signals_path: Union[str, Path],
        hospitals_path: Union[str, Path],
    ):
        roads_p = Path(roads_path)
        signals_p = Path(signals_path)
        hospitals_p = Path(hospitals_path)

        if not roads_p.exists():
            raise FileNotFoundError(f"Roads GeoJSON file not found: {roads_p}")
        if not signals_p.exists():
            raise FileNotFoundError(f"Signals GeoJSON file not found: {signals_p}")
        if not hospitals_p.exists():
            raise FileNotFoundError(f"Hospitals GeoJSON file not found: {hospitals_p}")

        with open(roads_p, "r", encoding="utf-8") as f:
            roads_data = json.load(f)
        with open(signals_p, "r", encoding="utf-8") as f:
            signals_data = json.load(f)
        with open(hospitals_p, "r", encoding="utf-8") as f:
            hospitals_data = json.load(f)

        self._build_road_graph(roads_data)
        self._map_traffic_signals(signals_data)
        self._map_hospitals(hospitals_data)

    def _build_road_graph(self, data: Dict[str, Any]):
        features = data.get("features", [])
        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [])
            if not coords or len(coords) < 2:
                continue

            u = str(props.get("start_node") or f"node_{coords[0][0]}_{coords[0][1]}")
            v = str(props.get("end_node") or f"node_{coords[-1][0]}_{coords[-1][1]}")

            self.node_coords[u] = coords[0]
            self.node_coords[v] = coords[-1]

            road_id = props.get("id") or feat.get("id")
            name = props.get("name", "Unnamed Road")
            oneway = bool(props.get("oneway", False))
            
            speed = props.get("maxspeed_kmh")
            if speed is None:
                speed = props.get("maxspeed", 40.0)
            try:
                maxspeed_kmh = float(speed)
            except (ValueError, TypeError):
                maxspeed_kmh = 40.0

            length_m = props.get("length_m")
            if length_m is None:
                length_m = 0.0
                for i in range(len(coords) - 1):
                    length_m += haversine_distance(
                        coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]
                    )
            else:
                length_m = float(length_m)

            speed_mps = max(10.0, maxspeed_kmh) * 1000.0 / 3600.0
            travel_time_sec = length_m / speed_mps

            forward_edge = RoadEdge(
                id=road_id,
                start_node=u,
                end_node=v,
                name=name,
                length_m=length_m,
                maxspeed_kmh=maxspeed_kmh,
                oneway=oneway,
                coordinates=coords,
                weight=travel_time_sec,
            )
            self.edges[(u, v)] = forward_edge
            self.road_features[road_id] = forward_edge

            if self.nx_graph is not None:
                self.nx_graph.add_edge(
                    u, v, weight=travel_time_sec, length_m=length_m, road_edge=forward_edge
                )
            self.fallback_graph.add_edge(
                u, v, weight=travel_time_sec, length_m=length_m, road_edge=forward_edge
            )

            if not oneway:
                rev_coords = list(reversed(coords))
                reverse_edge = RoadEdge(
                    id=road_id,
                    start_node=v,
                    end_node=u,
                    name=name,
                    length_m=length_m,
                    maxspeed_kmh=maxspeed_kmh,
                    oneway=oneway,
                    coordinates=rev_coords,
                    weight=travel_time_sec,
                )
                self.edges[(v, u)] = reverse_edge
                if self.nx_graph is not None:
                    self.nx_graph.add_edge(
                        v, u, weight=travel_time_sec, length_m=length_m, road_edge=reverse_edge
                    )
                self.fallback_graph.add_edge(
                    v, u, weight=travel_time_sec, length_m=length_m, road_edge=reverse_edge
                )

        logger.info(
            f"Built road graph with {len(self.node_coords)} vertices and {len(self.edges)} directed edges."
        )

    def find_nearest_node(self, lon: float, lat: float) -> Optional[str]:
        """Find the nearest graph vertex to a given coordinate."""
        best_node = None
        min_dist = float("inf")
        for node_id, coords in self.node_coords.items():
            d = haversine_distance(lon, lat, coords[0], coords[1])
            if d < min_dist:
                min_dist = d
                best_node = node_id
        return best_node

    def _map_traffic_signals(self, data: Dict[str, Any]):
        features = data.get("features", [])
        self.signals_raw = features
        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [])
            node_id = props.get("node_id")

            if node_id and node_id in self.node_coords:
                target_node = node_id
            elif coords and len(coords) >= 2:
                target_node = self.find_nearest_node(coords[0], coords[1])
            else:
                target_node = None

            if target_node:
                self.signals_by_node[target_node] = {
                    "signal_id": props.get("id") or feat.get("id"),
                    "name": props.get("name"),
                    "node_id": target_node,
                    "osm_id": props.get("osm_id") or props.get("id") or feat.get("id"),
                    "coordinates": coords or self.node_coords[target_node],
                    "raw_properties": props,
                }

        logger.info(f"Mapped {len(self.signals_by_node)} traffic signals to road graph vertices.")

    def _map_hospitals(self, data: Dict[str, Any]):
        features = data.get("features", [])
        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [])
            hosp_id = props.get("id") or feat.get("id")
            ingress_node = props.get("nearest_junction_node")

            if ingress_node and ingress_node in self.node_coords:
                target_node = ingress_node
            elif coords and len(coords) >= 2:
                target_node = self.find_nearest_node(coords[0], coords[1])
            else:
                target_node = None

            if target_node:
                self.hospitals[hosp_id] = {
                    "id": hosp_id,
                    "name": props.get("name"),
                    "target_node": target_node,
                    "coordinates": coords or self.node_coords[target_node],
                    "raw_properties": props,
                }

        logger.info(f"Mapped {len(self.hospitals)} hospitals to road graph vertices.")

    def find_shortest_path(self, source_node: str, target_node: str) -> List[str]:
        """Calculate shortest path between two vertices using NetworkX or fallback."""
        if HAS_NETWORKX and self.nx_graph is not None:
            try:
                return nx.shortest_path(self.nx_graph, source=source_node, target=target_node, weight="weight")
            except (nx.NetworkXNoPath, nx.NodeNotFound) as e:
                raise ValueError(f"No path found between {source_node} and {target_node}: {e}")
        else:
            return self.fallback_graph.shortest_path(source_node, target_node, weight="weight")


@dataclass
class CongestionEngine:
    """Dynamic edge weight simulation modeling traffic congestion and bottlenecks."""

    network: RoadNetwork
    _congestion: Dict[Any, float] = field(default_factory=dict)
    _base_weights: Dict[Tuple[str, str], float] = field(default_factory=dict)

    def initialize(self):
        """Snapshot base unloaded travel times and assign initial noise."""
        for (u, v), edge in self.network.edges.items():
            self._base_weights[(u, v)] = edge.weight
            if edge.id not in self._congestion:
                self._congestion[edge.id] = random.uniform(0.05, 0.35)
        self._apply_weights()

    def _apply_weights(self):
        """Update directed graph edge weights: travel_time = base_time * (1.0 + congestion)."""
        for (u, v), edge in self.network.edges.items():
            base = self._base_weights.get((u, v), edge.weight)
            c = self._congestion.get(
                edge.id,
                self._congestion.get(extract_id(edge.id), self._congestion.get(str(edge.id), 0.0))
            )
            new_weight = base * (1.0 + c)

            if self.network.nx_graph is not None and self.network.nx_graph.has_edge(u, v):
                self.network.nx_graph[u][v]["weight"] = new_weight

            if u in self.network.fallback_graph.adj and v in self.network.fallback_graph.adj[u]:
                self.network.fallback_graph.adj[u][v]["weight"] = new_weight

    def tick(self, elapsed_sim_seconds: float):
        """Advance congestion simulation by 1s with time-of-day rush multiplier."""
        hour = (elapsed_sim_seconds / 3600.0) % 24
        rush = self._rush_multiplier(hour)
        for (u, v), edge in self.network.edges.items():
            delta = random.gauss(0, 0.03) + (rush - 0.5) * 0.02
            old = self._congestion.get(edge.id, 0.2)
            self._congestion[edge.id] = max(0.0, min(1.0, old + delta))
        self._apply_weights()

    def inject_blockage(self, osm_id: Any, factor: float = 1.0):
        """Force a specific road to designated congestion factor (clamped [0.0, 1.0])."""
        val = max(0.0, min(1.0, factor))
        self._congestion[osm_id] = val
        self._congestion[extract_id(osm_id)] = val
        self._congestion[str(osm_id)] = val
        self._apply_weights()

    def get_map(self) -> Dict[str, float]:
        """Return string-keyed congestion factor map with 3-decimal precision."""
        return {str(k): round(v, 3) for k, v in self._congestion.items()}

    def _rush_multiplier(self, hour: float) -> float:
        if 8 <= hour <= 10 or 17 <= hour <= 20:
            return 0.8
        return 0.3


class AmbulanceAgent:
    """
    Simulates an emergency ambulance traveling continuously toward a hospital.
    Traverses the road coordinates at realistic speeds (40 - 60 km/h),
    computes heading, altitude, dynamic reroutes on congestion, and Green Wave corridor locks.
    """

    def __init__(
        self,
        vehicle_id: str,
        network: RoadNetwork,
        speed_kmh: Optional[float] = None,
        destination_hospital_id: Optional[str] = None,
        start_node: Optional[str] = None,
        criticality_tier: Optional[int] = None,
        conflict_arbiter: Optional[ConflictArbiter] = None,
    ):
        self.vehicle_id = vehicle_id
        self.network = network
        self.speed_kmh = speed_kmh or random.uniform(42.0, 58.0)
        self.priority_active = True
        self.destination_hospital_id = destination_hospital_id
        self.start_node = start_node
        self.criticality_tier = (
            criticality_tier
            if criticality_tier is not None
            else get_ambulance_criticality_tier(vehicle_id)
        )
        self.conflict_arbiter = conflict_arbiter

        self.current_lat: float = 12.9716
        self.current_lon: float = 77.5946
        self.current_alt: float = 920.0
        self.heading: float = 0.0
        self.current_road_osm_id: Any = None
        self.preempt_junction_osm_id: Optional[Any] = None
        self.green_wave_junction_ids: List[Any] = []
        self.active_route_osm_ids: List[Any] = []
        self.speed_advisory_kmh: Optional[float] = None

        # Route state
        self.node_path: List[str] = []
        self.route_points: List[List[float]] = []  # [[lon, lat, alt, road_id, edge_u, edge_v], ...]
        self.route_distances: List[float] = []      # cumulative distance along route
        self.total_route_length: float = 0.0
        self.current_distance: float = 0.0

        self._plan_new_route(initial_start=start_node, target_hosp=destination_hospital_id)

    def _plan_new_route(
        self,
        initial_start: Optional[str] = None,
        target_hosp: Optional[str] = None,
    ):
        """Plan a valid shortest route to a destination hospital."""
        hosp_ids = list(self.network.hospitals.keys())
        if not hosp_ids:
            logger.warning("No hospitals available in network.")
            return

        all_nodes = list(self.network.node_coords.keys())
        max_attempts = 30
        planned = False

        for _ in range(max_attempts):
            dest_id = target_hosp or random.choice(hosp_ids)
            dest_info = self.network.hospitals[dest_id]
            dest_node = dest_info["target_node"]

            origin_node = initial_start or random.choice(all_nodes)
            if origin_node == dest_node:
                initial_start = None
                continue

            try:
                path = self.network.find_shortest_path(origin_node, dest_node)
                if len(path) >= 2:
                    self.destination_hospital_id = dest_id
                    self.node_path = path
                    self._materialize_route(path)
                    planned = True
                    break
            except Exception:
                pass
            initial_start = None

        if not planned:
            for dest_id, hinfo in self.network.hospitals.items():
                dest_node = hinfo["target_node"]
                for origin_node in all_nodes:
                    if origin_node != dest_node:
                        try:
                            path = self.network.find_shortest_path(origin_node, dest_node)
                            if len(path) >= 2:
                                self.destination_hospital_id = dest_id
                                self.node_path = path
                                self._materialize_route(path)
                                return
                        except Exception:
                            continue

    def _materialize_route(self, path: List[str]):
        """Expand node path into continuous polyline vertices with segment distances."""
        self.route_points = []
        self.route_distances = [0.0]
        self.current_distance = 0.0

        for i in range(len(path) - 1):
            u = path[i]
            v = path[i + 1]
            edge = self.network.edges.get((u, v))
            if not edge:
                continue

            coords = edge.coordinates
            start_k = 0 if i == 0 else 1
            for k in range(start_k, len(coords)):
                pt = coords[k]
                lon = pt[0]
                lat = pt[1]
                alt = pt[2] if len(pt) > 2 else 920.0
                road_id = edge.id
                self.route_points.append([lon, lat, alt, road_id, u, v])

        total = 0.0
        self.route_distances = [0.0]
        for idx in range(len(self.route_points) - 1):
            p1 = self.route_points[idx]
            p2 = self.route_points[idx + 1]
            seg_dist = haversine_distance(p1[0], p1[1], p2[0], p2[1])
            total += seg_dist
            self.route_distances.append(total)

        self.total_route_length = total
        if self.route_points:
            self.current_lon = self.route_points[0][0]
            self.current_lat = self.route_points[0][1]
            self.current_alt = self.route_points[0][2]
            self.current_road_osm_id = extract_id(self.route_points[0][3])
            if len(self.route_points) > 1:
                self.heading = calculate_bearing(
                    self.current_lon, self.current_lat,
                    self.route_points[1][0], self.route_points[1][1]
                )

        route_osm_ids = []
        for i in range(len(path) - 1):
            u = path[i]
            v = path[i + 1]
            edge = self.network.edges.get((u, v))
            if edge and edge.id is not None:
                eid = extract_id(edge.id)
                if not route_osm_ids or route_osm_ids[-1] != eid:
                    route_osm_ids.append(eid)
        self.active_route_osm_ids = route_osm_ids

    def _nearest_node_on_route(self) -> str:
        """Find the closest node ahead or current on the active route."""
        if not self.route_points or not self.node_path:
            return list(self.network.node_coords.keys())[0]
        seg_idx = 0
        for i in range(len(self.route_distances) - 1):
            if self.route_distances[i] <= self.current_distance <= self.route_distances[i + 1]:
                seg_idx = i
                break
        # If at very beginning of segment, edge_u is the current node; otherwise edge_v
        if self.current_distance < 5.0:
            return self.route_points[seg_idx][4]
        return self.route_points[seg_idx][5]

    def _check_route_congestion(self, congestion_engine: CongestionEngine) -> bool:
        """
        Dynamically triggers A* rerouting when ANY upcoming edge on the route
        exceeds congestion factor > 0.85.
        """
        if not self.node_path or len(self.node_path) < 2:
            return False

        seg_idx = 0
        if self.route_points and len(self.route_distances) > 1:
            for i in range(len(self.route_distances) - 1):
                if self.route_distances[i] <= self.current_distance <= self.route_distances[i + 1]:
                    seg_idx = i
                    break

        curr_u = self.route_points[seg_idx][4] if self.route_points else self.node_path[0]
        try:
            start_idx = self.node_path.index(curr_u)
        except ValueError:
            start_idx = 0

        for i in range(start_idx, len(self.node_path) - 1):
            u, v = self.node_path[i], self.node_path[i + 1]
            edge = self.network.edges.get((u, v))
            if edge:
                c = congestion_engine._congestion.get(
                    edge.id,
                    congestion_engine._congestion.get(extract_id(edge.id), 0.0)
                )
                if c > 0.85:
                    logger.info(
                        f"{self.vehicle_id}: Rerouting due to high congestion ({c:.2f}) on road {edge.id}"
                    )
                    reroute_from = curr_u if self.current_distance < 5.0 else self.route_points[seg_idx][5]
                    self._plan_new_route(
                        initial_start=reroute_from,
                        target_hosp=self.destination_hospital_id
                    )
                    return True
        return False

    def step(self, dt_seconds: float):
        """Advance ambulance by distance covered in dt_seconds and update telemetry."""
        if not self.route_points or self.total_route_length <= 0.0:
            return

        speed_mps = (self.speed_kmh * 1000.0) / 3600.0
        delta_m = speed_mps * dt_seconds
        self.current_distance += delta_m

        if self.current_distance >= self.total_route_length:
            dest_hosp = self.network.hospitals.get(self.destination_hospital_id)
            new_start = dest_hosp["target_node"] if dest_hosp else None
            self.speed_kmh = random.uniform(42.0, 58.0)
            self._plan_new_route(initial_start=new_start)
            return

        seg_idx = 0
        for i in range(len(self.route_distances) - 1):
            if self.route_distances[i] <= self.current_distance <= self.route_distances[i + 1]:
                seg_idx = i
                break

        d1 = self.route_distances[seg_idx]
        d2 = self.route_distances[seg_idx + 1]
        seg_len = max(0.001, d2 - d1)
        frac = (self.current_distance - d1) / seg_len

        p1 = self.route_points[seg_idx]
        p2 = self.route_points[seg_idx + 1]

        new_lon = p1[0] + (p2[0] - p1[0]) * frac
        new_lat = p1[1] + (p2[1] - p1[1]) * frac
        alt1 = p1[2]
        alt2 = p2[2]
        self.current_alt = round(alt1 + (alt2 - alt1) * frac, 1)

        self.heading = calculate_bearing(self.current_lon, self.current_lat, p2[0], p2[1])
        self.current_lon = round(new_lon, 6)
        self.current_lat = round(new_lat, 6)
        self.current_road_osm_id = extract_id(p1[3])

        self._compute_green_wave()

    def _compute_green_wave(self) -> List[Any]:
        """
        Calculates upcoming signalized junctions within min(300.0m, speed_mps * 25.0s).
        Arbitrates conflicts via ConflictArbiter if provided.
        """
        speed_mps = max(5.0, (self.speed_kmh * 1000.0) / 3600.0)
        max_dist_by_time = speed_mps * GREEN_WAVE_ETA_SEC
        horizon_m = min(GREEN_WAVE_DISTANCE_M, max_dist_by_time)

        wave_ids = []
        seen = set()

        for idx in range(len(self.route_points)):
            pt_dist = self.route_distances[idx]
            dist_ahead = pt_dist - self.current_distance
            if 0.0 <= dist_ahead <= horizon_m:
                v_node = self.route_points[idx][5]
                if v_node in self.network.signals_by_node and v_node not in seen:
                    sig = self.network.signals_by_node[v_node]
                    osm_id = extract_id(sig.get("osm_id") or sig.get("signal_id"))
                    if osm_id:
                        seen.add(v_node)
                        if self.conflict_arbiter is not None:
                            eta_sec = dist_ahead / speed_mps
                            info = AmbulanceInfo(
                                vehicle_id=self.vehicle_id,
                                criticality_tier=self.criticality_tier,
                                eta_seconds=eta_sec,
                            )
                            if self.conflict_arbiter.request_preemption(osm_id, info):
                                wave_ids.append(osm_id)
                        else:
                            wave_ids.append(osm_id)

        if self.conflict_arbiter is not None:
            for prev_jid in self.green_wave_junction_ids:
                if prev_jid not in wave_ids:
                    self.conflict_arbiter.release(prev_jid, self.vehicle_id)

            adv = self.conflict_arbiter.get_speed_advisory(self.vehicle_id)
            if adv is not None:
                self.speed_advisory_kmh = adv

        self.green_wave_junction_ids = wave_ids
        self.preempt_junction_osm_id = wave_ids[0] if wave_ids else None
        return wave_ids

    def _check_signal_preemption(self):
        """Backward-compatible preemption call."""
        self._compute_green_wave()

    def get_telemetry_payload(self) -> Dict[str, Any]:
        """Returns the enhanced telemetry schema dict."""
        return {
            "vehicle_id": self.vehicle_id,
            "timestamp": round(time.time(), 3),
            "latitude": self.current_lat,
            "longitude": self.current_lon,
            "altitude": self.current_alt,
            "speed_kmh": round(self.speed_kmh, 1),
            "heading": self.heading,
            "current_road_osm_id": self.current_road_osm_id,
            "destination_hospital_id": self.destination_hospital_id,
            "priority_active": self.priority_active,
            "preempt_junction_osm_id": self.preempt_junction_osm_id,
            "green_wave_junction_ids": self.green_wave_junction_ids,
            "active_route_osm_ids": self.active_route_osm_ids,
            "speed_advisory_kmh": self.speed_advisory_kmh,
            "patient_criticality_tier": self.criticality_tier,
        }


class TelemetrySimulationServer:
    """
    100% free and offline simulation server broadcasting at 10Hz over WebSocket
    with decoupled 2Hz state frame broadcast.
    """

    def __init__(
        self,
        roads_file: Union[str, Path],
        signals_file: Union[str, Path],
        hospitals_file: Union[str, Path],
        host: str = "0.0.0.0",
        port: int = 8765,
        num_ambulances: int = 5,
        broadcast_rate_hz: float = 10.0,
        enable_state_broadcast: bool = False,
    ):
        self.host = host
        self.port = port
        self.broadcast_rate_hz = broadcast_rate_hz
        self.enable_state_broadcast = enable_state_broadcast
        self.network = RoadNetwork()
        self.network.load_from_geojson(roads_file, signals_file, hospitals_file)

        self.congestion_engine = CongestionEngine(self.network)
        self.congestion_engine.initialize()
        self.conflict_arbiter = ConflictArbiter()
        self.total_signal_overrides = 0
        self._seen_overrides: Set[Any] = set()

        self.ambulances: List[AmbulanceAgent] = []
        ambulance_ids = [
            f"AMB-108-{i:02d}" for i in range(1, num_ambulances + 1)
        ]
        for aid in ambulance_ids:
            tier = get_ambulance_criticality_tier(aid)
            self.ambulances.append(
                AmbulanceAgent(
                    aid,
                    self.network,
                    criticality_tier=tier,
                    conflict_arbiter=self.conflict_arbiter,
                )
            )

        self.connected_clients: Set[Any] = set()
        self._server = None
        self._running = False
        self._loop_task: Optional[asyncio.Task] = None
        self.tick_count: int = 0
        self.elapsed_sim_seconds: float = 0.0

    def get_state_payload(self) -> Dict[str, Any]:
        """Generate 2Hz decoupled state frame."""
        total_edges = 0
        clear_edges = 0
        cmap = self.congestion_engine.get_map()
        for amb in self.ambulances:
            for road_id in amb.active_route_osm_ids:
                total_edges += 1
                if cmap.get(str(road_id), 0.0) < 0.7:
                    clear_edges += 1
        clear_rate = (clear_edges / total_edges * 100.0) if total_edges > 0 else 100.0

        for amb in self.ambulances:
            for jid in amb.green_wave_junction_ids:
                if jid not in self._seen_overrides:
                    self._seen_overrides.add(jid)
                    self.total_signal_overrides += 1

        return {
            "frame_type": "state",
            "timestamp": round(time.time(), 3),
            "edge_congestion_map": cmap,
            "route_clear_rate": round(clear_rate, 1),
            "total_signal_overrides": self.total_signal_overrides,
        }

    async def register(self, websocket):
        self.connected_clients.add(websocket)
        logger.info(f"Client connected. Active clients: {len(self.connected_clients)}")
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("action") == "enable_state":
                        self.enable_state_broadcast = True
                except Exception:
                    pass
        except Exception:
            pass
        finally:
            self.connected_clients.discard(websocket)
            logger.info(f"Client disconnected. Active clients: {len(self.connected_clients)}")

    async def simulation_loop(self):
        """10Hz simulation loop broadcasting 10Hz kinematics and 2Hz decoupled state frame."""
        interval = 1.0 / self.broadcast_rate_hz
        logger.info(
            f"Starting simulation loop at {self.broadcast_rate_hz}Hz (interval: {interval*1000:.1f}ms)"
        )

        while self._running:
            start_time = time.perf_counter()
            self.tick_count += 1
            self.elapsed_sim_seconds += interval

            # Advance congestion engine roughly every 1s (every 10 ticks at 10Hz)
            if self.tick_count % int(self.broadcast_rate_hz) == 0:
                self.congestion_engine.tick(self.elapsed_sim_seconds)

            # Step all ambulances and dynamically evaluate congestion rerouting
            payloads = []
            for amb in self.ambulances:
                amb._check_route_congestion(self.congestion_engine)
                amb.step(interval)
                payloads.append(amb.get_telemetry_payload())

            if self.connected_clients:
                for payload in payloads:
                    message_str = json.dumps(payload)
                    websockets.broadcast(self.connected_clients, message_str)

                # Broadcast decoupled state frame at 2Hz (every 500ms = 5 ticks at 10Hz)
                if self.enable_state_broadcast and (self.tick_count % 5 == 0):
                    state_frame = self.get_state_payload()
                    websockets.broadcast(self.connected_clients, json.dumps(state_frame))

            elapsed = time.perf_counter() - start_time
            sleep_time = max(0.0, interval - elapsed)
            await asyncio.sleep(sleep_time)

    async def start(self):
        self._running = True
        self._server = await websockets.serve(self.register, self.host, self.port)
        self._loop_task = asyncio.create_task(self.simulation_loop())
        logger.info(f"Telemetry server listening on ws://{self.host}:{self.port}")

    async def stop(self):
        self._running = False
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        logger.info("Telemetry server stopped.")


def run_standalone():
    """CLI entrypoint to run the telemetry server."""
    base_dir = Path(__file__).resolve().parent.parent
    roads_path = base_dir / "Data" / "GeoJSON" / "bengaluru_roads.geojson"
    signals_path = base_dir / "Data" / "GeoJSON" / "bengaluru_traffic_signals.geojson"
    hospitals_path = base_dir / "Data" / "GeoJSON" / "bengaluru_hospitals.geojson"

    server = TelemetrySimulationServer(
        roads_file=roads_path,
        signals_file=signals_path,
        hospitals_file=hospitals_path,
        host="0.0.0.0",
        port=8765,
        num_ambulances=5,
        broadcast_rate_hz=10.0,
        enable_state_broadcast=True,
    )

    async def main():
        await server.start()
        try:
            while True:
                await asyncio.sleep(1)
        except (KeyboardInterrupt, asyncio.CancelledError):
            await server.stop()

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server terminated by user.")


if __name__ == "__main__":
    run_standalone()
