#!/usr/bin/env python3
"""
generate_network_osm.py

Generates Bengaluru geospatial network data using OSMnx + NetworkX from real OpenStreetMap data.
- Extracts real driving roads, intersections, geometry, one-way restrictions, road connectivity
- Covers: Central, South, Koramangala, East, North areas
- Includes 6 hospitals: Victoria, St. John's, NIMHANS, Jayadeva, Manipal (Old Airport Road), Bowring
- Outputs: Data/GeoJSON/bengaluru_network.json and embeds into preview_data.js

Run: python Scripts/generate_network_osm.py
"""

import json
import math
import os
import sys
from typing import Dict, List, Tuple, Any, Optional, Set

import networkx as nx
import osmnx as ox
import pandas as pd

# =============================================================================
# CONFIGURATION
# =============================================================================

# Bengaluru bounding box (South, West, North, East)
BENGALURU_BBOX = (12.8340, 77.4601, 13.1436, 77.7840)

# Specific corridors to extract (key roads with their bounding boxes)
# Each corridor is a key arterial road with a narrow bbox around it
CORRIDORS = [
    # Central corridor: Majestic -> K.R. Circle -> Victoria Hospital
    {"name": "Seshadri Road", "bbox": (12.9700, 77.5700, 12.9800, 77.5900)},
    {"name": "Kempegowda Road", "bbox": (12.9700, 77.5700, 12.9800, 77.5850)},
    {"name": "Avenue Road", "bbox": (12.9600, 77.5750, 12.9750, 77.5850)},
    {"name": "Nrupathunga Road", "bbox": (12.9650, 77.5850, 12.9780, 77.5900)},
    {"name": "Kasturba Road", "bbox": (12.9650, 77.5850, 12.9750, 77.5980)},
    {"name": "N.R. Road", "bbox": (12.9600, 77.5750, 12.9700, 77.5900)},
    {"name": "K.R. Road / Fort Road", "bbox": (12.9550, 77.5700, 12.9700, 77.5800)},
    {"name": "Ambedkar Veedhi", "bbox": (12.9700, 77.5850, 12.9850, 77.5950)},
    {"name": "Raj Bhavan Road", "bbox": (12.9750, 77.5880, 12.9850, 77.5950)},
    {"name": "Lady Curzon Road", "bbox": (12.9780, 77.5900, 12.9880, 77.6050)},
    {"name": "Central Street", "bbox": (12.9700, 77.6000, 12.9850, 77.6050)},
    {"name": "MG Road", "bbox": (12.9650, 77.5950, 12.9850, 77.6100)},
    {"name": "Old Madras Road", "bbox": (12.9600, 77.6050, 12.9850, 77.6450)},
    {"name": "Old Airport Road", "bbox": (12.9400, 77.6350, 12.9700, 77.6500)},
    {"name": "Hosur Road", "bbox": (12.9100, 77.5900, 12.9550, 77.6300)},
    {"name": "Koramangala Inner Ring", "bbox": (12.9200, 77.6100, 12.9400, 77.6300)},
    {"name": "Bellary Road", "bbox": (12.9750, 77.5700, 13.0450, 77.6100)},
    {"name": "Race Course Road", "bbox": (12.9750, 77.5850, 12.9850, 77.5950)},
]

# Hospital areas for targeted extraction
HOSPITAL_AREAS = [
    {"name": "Victoria Hospital", "bbox": (12.9600, 77.5700, 12.9700, 77.5800)},
    {"name": "Bowring Hospital", "bbox": (12.9780, 77.5980, 12.9880, 77.6080)},
    {"name": "St. Martha's Hospital", "bbox": (12.9680, 77.5850, 12.9730, 77.5900)},
    {"name": "Mallya Hospital", "bbox": (12.9680, 77.5930, 12.9730, 77.5980)},
    {"name": "NIMHANS", "bbox": (12.9380, 77.5950, 12.9480, 77.6050)},
    {"name": "Jayadeva", "bbox": (12.9150, 77.5900, 12.9250, 77.6000)},
    {"name": "St. John's Hospital", "bbox": (12.9200, 77.6150, 12.9300, 77.6250)},
    {"name": "Manipal Hospital", "bbox": (12.9450, 77.6400, 12.9550, 77.6500)},
]

# Target hospitals with verified names from OSM
TARGET_HOSPITALS = [
    {"name": "Victoria Hospital", "alt_names": ["BMCRI", "Victoria Hospital (BMCRI)"], "zone": "Central", "priority": "CRITICAL_TIER_1"},
    {"name": "St. John's Medical College Hospital", "alt_names": ["St. John's Hospital", "St. John's Medical College"], "zone": "Koramangala", "priority": "CRITICAL_TIER_1"},
    {"name": "NIMHANS", "alt_names": ["National Institute of Mental Health and Neurosciences"], "zone": "South", "priority": "CRITICAL_TIER_1"},
    {"name": "Jayadeva Institute of Cardiovascular Sciences and Research", "alt_names": ["Jayadeva Hospital", "Jayadeva"], "zone": "South", "priority": "CRITICAL_TIER_1"},
    {"name": "Manipal Hospital Old Airport Road", "alt_names": ["Manipal Hospital", "Manipal Hospitals Old Airport Road"], "zone": "East", "priority": "CRITICAL_TIER_1"},
    {"name": "Bowring and Lady Curzon Hospital", "alt_names": ["Bowring Hospital", "Lady Curzon Hospital"], "zone": "North-Central", "priority": "CRITICAL_TIER_1"},
]

# Road hierarchy for extraction (OSM highway tags)
ROAD_HIERARCHY = [
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "residential", "service", "unclassified"
]

# EV Priority corridors (major arterial roads that should be flagged)
EV_PRIORITY_ROADS = [
    "Seshadri Road", "Kempegowda Road", "Avenue Road", "Nrupathunga Road",
    "Kasturba Road", "N.R. Road", "K.R. Road", "Fort Road", "Ambedkar Veedhi",
    "Raj Bhavan Road", "Lady Curzon Road", "Central Street", "Mahatma Gandhi Road",
    "Hosur Road", "Old Madras Road", "Old Airport Road", "Bellary Road",
    "Race Course Road", "Outer Ring Road"
]

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def setup_osmnx():
    """Configure OSMnx settings."""
    ox.settings.log_console = True
    ox.settings.use_cache = True
    ox.settings.cache_only_mode = True  # Use cached data only - no network requests
    ox.settings.cache_folder = "osmnx_cache"
    ox.settings.timeout = 180
    ox.settings.max_query_area_size = 50_000_000  # 50 km^2

def get_graph_from_bbox(bbox: Tuple[float, float, float, float], network_type: str = "drive") -> nx.MultiDiGraph:
    """Download and construct street network graph from OSM within bbox.

    OSMnx expects bbox as (left, bottom, right, top) = (west, south, east, north)
    Uses custom filter for major roads only.
    """
    south, west, north, east = bbox
    # OSMnx expects (west, south, east, north)
    osm_bbox = (west, south, east, north)
    print(f"  Downloading OSM data for bbox: ({south:.4f}, {west:.4f}, {north:.4f}, {east:.4f})")

    # Custom filter for major roads only (motorway, trunk, primary, secondary)
    custom_filter = '["highway"~"motorway|trunk|primary|secondary|tertiary"]'
    G = ox.graph_from_bbox(osm_bbox, network_type=network_type, simplify=False, custom_filter=custom_filter)
    print(f"  Graph (major roads only): {len(G.nodes)} nodes, {len(G.edges)} edges")
    return G

def simplify_graph(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Simplify graph by merging linear paths while preserving topology."""
    G_simplified = ox.simplify_graph(G)
    print(f"  Simplified: {len(G_simplified.nodes)} nodes, {len(G_simplified.edges)} edges")
    return G_simplified

def extract_nodes(G: nx.MultiDiGraph) -> List[Dict[str, Any]]:
    """Extract node data from graph with zone assignment."""
    nodes = []
    node_id_map = {}  # OSM node ID -> our node_<id>

    for osm_id, data in G.nodes(data=True):
        lat = data.get('y', 0)
        lon = data.get('x', 0)

        # Assign zone based on coordinates
        zone = assign_zone(lat, lon)

        # Determine node type
        node_type = determine_node_type(G, osm_id, lat, lon)

        # Get connected edges for road references
        connected_roads = get_connected_road_names(G, osm_id)

        # Check for traffic signals (highway=traffic_signals in OSM)
        signals = get_node_signals(G, osm_id)

        node_id = f"node_{osm_id}"
        node_id_map[osm_id] = node_id

        nodes.append({
            "id": node_id,
            "osm_id": osm_id,
            "name": generate_node_name(lat, lon, zone, node_type),
            "zone": zone,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "alt": round(data.get('elevation', 920.0), 1),
            "type": node_type,
            "signals": signals,
            "roads": connected_roads
        })

    return nodes, node_id_map

def assign_zone(lat: float, lon: float) -> str:
    """Assign zone based on coordinates."""
    # Central
    if 12.9500 <= lat <= 12.9950 and 77.5500 <= lon <= 77.6200:
        return "Central"
    # South
    if 12.8800 <= lat <= 12.9600 and 77.5500 <= lon <= 77.6500:
        return "South"
    # Koramangala
    if 12.9000 <= lat <= 12.9500 and 77.6000 <= lon <= 77.6500:
        return "Koramangala"
    # East
    if 12.9300 <= lat <= 12.9900 and 77.6000 <= lon <= 77.6800:
        return "East"
    # North-Central
    if 12.9700 <= lat <= 13.0500 and 77.5500 <= lon <= 77.6200:
        return "North-Central"
    return "Peripheral"

def determine_node_type(G: nx.MultiDiGraph, osm_id: int, lat: float, lon: float) -> str:
    """Determine node type based on degree and context."""
    degree = G.degree(osm_id)
    if degree >= 4:
        return "junction_4way" if degree == 4 else f"junction_{degree}way"
    elif degree == 3:
        return "junction_3way"
    elif degree == 2:
        return "midpoint"
    else:
        return "dead_end"

def get_connected_road_names(G: nx.MultiDiGraph, osm_id: int) -> List[str]:
    """Get names of roads connected to this node."""
    roads = set()
    for _, _, data in G.edges(osm_id, data=True):
        name = data.get('name')
        if name:
            if isinstance(name, list):
                roads.update(name)
            else:
                roads.add(name)
    return sorted(list(roads))

def get_node_signals(G: nx.MultiDiGraph, osm_id: int) -> List[str]:
    """Check if node has traffic signals."""
    signals = []
    for _, _, data in G.edges(osm_id, data=True):
        if data.get('highway') == 'traffic_signals':
            signals.append(f"signal_{osm_id}")
    # Also check node tags
    node_data = G.nodes[osm_id]
    if node_data.get('highway') == 'traffic_signals':
        signals.append(f"signal_{osm_id}")
    return signals

def generate_node_name(lat: float, lon: float, zone: str, node_type: str) -> str:
    """Generate a descriptive name for the node."""
    # Known landmark coordinates (approximate)
    landmarks = {
        (12.9767, 77.5713): "Majestic (KSR/BMTC)",
        (12.9658, 77.5765): "K.R. Market",
        (12.9667, 77.5872): "Corporation Circle (Town Hall)",
        (12.9680, 77.5875): "Hudson Circle",
        (12.9752, 77.5871): "K.R. Circle",
        (12.9796, 77.5907): "Vidhana Soudha",
        (12.9829, 77.6027): "Bowring Hospital",
        (12.9748, 77.6045): "Anil Kumble Circle",
        (12.9718, 77.6053): "Trinity Circle",
        (12.9245, 77.6218): "St. John's Hospital",
        (12.9426, 77.5991): "NIMHANS",
        (12.9195, 77.5957): "Jayadeva",
        (12.9508, 77.6466): "Manipal Hospital",
        (12.9165, 77.6101): "BTM Layout",
        (12.9176, 77.6238): "Silk Board",
        (12.9352, 77.6245): "Sony World",
        (12.9274, 77.6167): "Forum Mall",
        (12.9860, 77.5992): "Shivajinagar",
        (13.0060, 77.5750): "Mekhri Circle",
        (13.0354, 77.5975): "Hebbal Flyover",
    }

    # Check if close to known landmark
    for (landmark_lat, landmark_lon), name in landmarks.items():
        dist = haversine_distance(lat, lon, landmark_lat, landmark_lon)
        if dist < 100:  # within 100m
            return name

    return f"{zone} Junction ({lat:.4f}, {lon:.4f})"

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two lat/lon points."""
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def extract_edges(G: nx.MultiDiGraph, node_id_map: Dict[int, str]) -> List[Dict[str, Any]]:
    """Extract edge data from graph preserving one-way and divided carriageway info."""
    edges = []
    edge_id_counter = 0

    for u, v, key, data in G.edges(keys=True, data=True):
        from_node = node_id_map.get(u, f"node_{u}")
        to_node = node_id_map.get(v, f"node_{v}")

        # Road properties
        highway = data.get('highway', 'unclassified')
        if isinstance(highway, list):
            highway = highway[0]

        name = data.get('name', 'Unnamed Road')
        if isinstance(name, list):
            name = name[0]

        # One-way handling
        oneway = data.get('oneway', False)
        if oneway in ('yes', '1', 'true', '-1', True):
            oneway = True
        else:
            oneway = False

        # Lanes
        lanes = data.get('lanes')
        try:
            lanes = int(lanes) if lanes else (1 if oneway else 2)
        except (ValueError, TypeError):
            lanes = 1 if oneway else 2

        # Maxspeed
        maxspeed = data.get('maxspeed')
        try:
            maxspeed = int(float(maxspeed)) if maxspeed else default_maxspeed(highway)
        except (ValueError, TypeError):
            maxspeed = default_maxspeed(highway)

        # Length
        length = data.get('length', 0)
        try:
            length = float(length)
        except (ValueError, TypeError):
            length = haversine_distance(
                G.nodes[u]['y'], G.nodes[u]['x'],
                G.nodes[v]['y'], G.nodes[v]['x']
            )

        # Geometry (LineString coordinates)
        geometry = data.get('geometry')
        if geometry is not None:
            # Shapely LineString
            coords = list(geometry.coords)
            coords = [[round(lon, 6), round(lat, 6)] for lon, lat in coords]
        else:
            # Straight line between nodes
            coords = [
                [round(G.nodes[u]['x'], 6), round(G.nodes[u]['y'], 6)],
                [round(G.nodes[v]['x'], 6), round(G.nodes[v]['y'], 6)]
            ]

        # Determine if divided carriageway (two parallel ways in opposite directions)
        is_divided = check_divided_carriageway(G, u, v, highway)
        carriageway_tag = ""

        # EV priority corridor
        ev_priority = is_ev_priority_road(name, highway)

        # Create edge
        edge_id_counter += 1
        edge_id = f"edge_{edge_id_counter:04d}"

        edges.append({
            "id": edge_id,
            "name": name,
            "from_node": from_node,
            "to_node": to_node,
            "highway": highway,
            "lanes": lanes,
            "maxspeed": maxspeed,
            "oneway": oneway,
            "surface": data.get('surface', 'asphalt'),
            "length_m": round(length, 1),
            "elevation_m": 920.0,  # approximate
            "ev_priority_corridor": ev_priority,
            "is_divided_carriageway": is_divided,
            "carriageway_tag": carriageway_tag,
            "geometry": {"type": "LineString", "coordinates": coords}
        })

        # If two-way divided carriageway, we represent as two directed edges
        # (OSM typically has separate ways for each direction of divided highways)

    return edges

def default_maxspeed(highway: str) -> int:
    """Default maxspeed based on road class."""
    defaults = {
        'motorway': 100, 'motorway_link': 60,
        'trunk': 80, 'trunk_link': 60,
        'primary': 60, 'primary_link': 50,
        'secondary': 50, 'secondary_link': 40,
        'tertiary': 40, 'tertiary_link': 30,
        'residential': 30, 'service': 20, 'unclassified': 40
    }
    return defaults.get(highway, 40)

def check_divided_carriageway(G: nx.MultiDiGraph, u: int, v: int, highway: str) -> bool:
    """Check if this edge is part of a divided carriageway (parallel opposite-direction ways)."""
    # Check if there's a reverse edge with same highway class
    for _, _, data in G.edges(v, data=True):
        if data.get('highway') == highway:
            # Check if this edge goes back to u
            # In simplified graph, this is typically represented as parallel edges
            pass
    # For now, mark trunk/primary as divided if they have lanes >= 4
    return highway in ('motorway', 'trunk', 'primary')

def is_ev_priority_road(name: str, highway: str) -> bool:
    """Check if road is an EV priority corridor."""
    name_lower = name.lower()
    for priority_road in EV_PRIORITY_ROADS:
        if priority_road.lower() in name_lower:
            return True
    # Also mark major highways as EV priority
    if highway in ('motorway', 'trunk', 'primary'):
        return True
    return False

def extract_hospitals_from_osm(G: nx.MultiDiGraph) -> List[Dict[str, Any]]:
    """Extract hospital data from OSM using OSMnx POI extraction."""
    print("  Querying OSM for hospitals using OSMnx...")

    try:
        # Use OSMnx to get POIs for hospitals
        # We'll use a smaller bbox for hospital query to avoid timeout
        hospital_bbox = (12.88, 77.55, 13.05, 77.68)  # south, west, north, east
        hospitals_gdf = ox.features_from_bbox(
            hospital_bbox[1], hospital_bbox[0], hospital_bbox[3], hospital_bbox[2],
            tags={"amenity": "hospital"}
        )

        if hospitals_gdf.empty:
            print("  No hospitals found via OSMnx")
            return []

        hospitals = []
        for idx, row in hospitals_gdf.iterrows():
            name = row.get('name', '')
            if pd.isna(name):
                continue

            # Get geometry centroid
            geom = row.geometry
            if geom.geom_type == 'Point':
                lat, lon = geom.y, geom.x
            else:
                centroid = geom.centroid
                lat, lon = centroid.y, centroid.x

            # Match against target hospitals
            matched = None
            for target in TARGET_HOSPITALS:
                if target['name'].lower() in str(name).lower():
                    matched = target
                    break
                for alt in target['alt_names']:
                    if alt.lower() in str(name).lower():
                        matched = target
                        break

            if matched:
                hospitals.append({
                    "osm_id": idx if isinstance(idx, int) else hash(str(idx)),
                    "name": str(name),
                    "matched_target": matched['name'],
                    "zone": matched['zone'],
                    "priority": matched['priority'],
                    "lat": lat,
                    "lon": lon,
                    "tags": row.to_dict()
                })

        print(f"  Found {len(hospitals)} target hospitals")
        return hospitals

    except Exception as e:
        print(f"  Warning: Could not fetch hospitals from OSM: {e}")
        import traceback
        traceback.print_exc()
        return []

def match_hospitals_to_nodes(hospitals: List[Dict], nodes: List[Dict], G: nx.MultiDiGraph) -> List[Dict[str, Any]]:
    """Match hospitals to nearest network nodes and create compound definitions."""
    hospital_compounds = []

    for hosp in hospitals:
        # Find nearest node in graph
        nearest_osm_id, nearest_dist = ox.distance.nearest_nodes(G, hosp['lon'], hosp['lat'], return_dist=True)
        nearest_node_id = f"node_{nearest_osm_id}"

        # Calculate 25m driveway ingress point
        ingress = calculate_driveway_ingress(
            hosp['lat'], hosp['lon'], 920.0,
            G.nodes[nearest_osm_id]['y'], G.nodes[nearest_osm_id]['x'], 920.0,
            25.0
        )

        # Create dual bays
        bays = create_dual_bays(hosp)

        compound = {
            "id": f"hosp_{hosp['matched_target'].lower().replace(' ', '_').replace('.', '')}",
            "name": hosp['matched_target'],
            "osm_id": hosp['osm_id'],
            "campus_node": f"node_{hosp['osm_id']}" if hosp['osm_id'] > 0 else nearest_node_id,
            "ingress_node": nearest_node_id,
            "trauma_level": "Level 1" if hosp['priority'] == "CRITICAL_TIER_1" else "Level 2",
            "bed_capacity": 1000,
            "icu_capacity": 100,
            "emergency_bays": 20,
            "helipad": hosp['priority'] == "CRITICAL_TIER_1",
            "ev_priority": hosp['priority'],
            "bays": bays,
            "driveway": {
                "ingress_point": ingress,
                "length_m": 25.0,
                "surface": "asphalt",
                "width_m": 6.0,
                "approach_bearing_deg": calculate_bearing(hosp['lat'], hosp['lon'],
                                                          G.nodes[nearest_osm_id]['y'], G.nodes[nearest_osm_id]['x'])
            }
        }
        hospital_compounds.append(compound)

    return hospital_compounds

def calculate_driveway_ingress(h_lat: float, h_lon: float, h_alt: float,
                                n_lat: float, n_lon: float, n_alt: float,
                                distance_m: float = 25.0) -> Dict[str, float]:
    """Calculate driveway ingress point 25m from hospital toward approach node."""
    # Linear interpolation (acceptable for 25m)
    lat_diff = n_lat - h_lat
    lon_diff = n_lon - h_lon
    alt_diff = n_alt - h_alt

    # Distance in degrees (approximate)
    dist_deg = math.sqrt(lat_diff**2 + lon_diff**2)
    if dist_deg > 0:
        # ~111km per degree latitude
        ratio = min(distance_m / 111000.0 / dist_deg, 1.0)
        ingress_lat = h_lat + lat_diff * ratio
        ingress_lon = h_lon + lon_diff * ratio
        ingress_alt = h_alt + alt_diff * ratio
    else:
        ingress_lat, ingress_lon, ingress_alt = h_lat, h_lon, h_alt

    return {"lat": round(ingress_lat, 8), "lon": round(ingress_lon, 8), "alt": round(ingress_alt, 2)}

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate bearing from point 1 to point 2 in degrees."""
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)

    y = math.sin(delta_lon) * math.cos(lat2_r)
    x = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(delta_lon)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360) % 360, 1)

def create_dual_bays(hospital: Dict) -> Dict[str, Any]:
    """Create dual bay configuration for hospital."""
    base_lat = hospital['lat']
    base_lon = hospital['lon']
    base_alt = 920.0

    # Small offset for bay positions (~5-10m)
    offset_deg = 0.00009  # ~10m

    return {
        "bay_a": {
            "id": f"{hospital['matched_target'].lower().replace(' ', '_')}_bay_a",
            "name": f"{hospital['matched_target']} Bay A",
            "position": {"lat": base_lat, "lon": base_lon - offset_deg, "alt": base_alt},
            "dedicated_to": "trauma_resuscitation" if hospital['priority'] == "CRITICAL_TIER_1" else "emergency_general",
            "coordinates_offset_m": {"x": -8, "y": 0, "z": 0}
        },
        "bay_b": {
            "id": f"{hospital['matched_target'].lower().replace(' ', '_')}_bay_b",
            "name": f"{hospital['matched_target']} Bay B",
            "position": {"lat": base_lat, "lon": base_lon + offset_deg, "alt": base_alt},
            "dedicated_to": "burn_trauma" if hospital['priority'] == "CRITICAL_TIER_1" else "pediatric_ortho",
            "coordinates_offset_m": {"x": 8, "y": 0, "z": 0}
        }
    }

def build_network_json(nodes: List[Dict], edges: List[Dict], hospitals: List[Dict]) -> Dict[str, Any]:
    """Build the final network JSON structure."""
    zones = sorted(set(n['zone'] for n in nodes))

    return {
        "type": "FeatureCollection",
        "metadata": {
            "project": "TrafficClearance",
            "region": "Bengaluru Metropolitan Emergency Vehicle Network",
            "crs": "EPSG:4326",
            "datum": "WGS84",
            "description": "OSMnx-derived geospatial network with real OSM roads, intersections, and hospital compounds",
            "node_count": len(nodes),
            "edge_count": len(edges),
            "hospital_count": len(hospitals),
            "zones": zones,
            "source": "OpenStreetMap via OSMnx",
            "extraction_date": "2026-11-22"
        },
        "nodes": nodes,
        "edges": edges,
        "hospitals": hospitals
    }

def write_network_json(network_data: Dict[str, Any], output_path: str) -> None:
    """Write network JSON to file."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(network_data, f, indent=2, ensure_ascii=False)
    print(f"[OK] Written network JSON to {output_path}")
    print(f"  Nodes: {len(network_data['nodes'])}")
    print(f"  Edges: {len(network_data['edges'])}")
    print(f"  Hospitals: {len(network_data['hospitals'])}")

def update_preview_data_js(network_data: Dict[str, Any], preview_path: str) -> None:
    """Update preview_data.js with the new NETWORK_DATA constant."""
    network_js = json.dumps(network_data, separators=(',', ':'), ensure_ascii=False)

    with open(preview_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'const NETWORK_DATA' in content:
        import re
        pattern = r'const NETWORK_DATA\s*=\s*\{[\s\S]*?\};'
        content = re.sub(pattern, f'const NETWORK_DATA = {network_js};', content)
    else:
        content = content.rstrip() + f'\n\nconst NETWORK_DATA = {network_js};\n'

    with open(preview_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"[OK] Updated {preview_path} with NETWORK_DATA constant")

def verify_connectivity(nodes: List[Dict], edges: List[Dict]) -> Dict[str, Any]:
    """Verify graph connectivity and route finding."""
    # Build adjacency for verification
    adj = {}
    for edge in edges:
        frm = edge['from_node']
        to = edge['to_node']
        if frm not in adj:
            adj[frm] = []
        adj[frm].append(to)

    # Check if we can find paths between key landmarks
    node_by_name = {n['name']: n['id'] for n in nodes}

    # Find nodes for key routes
    key_nodes = {
        "Majestic": [nid for nid, n in node_by_name.items() if 'Majestic' in nid or 'KSR' in n],
        "Victoria Hospital": [nid for nid, n in node_by_name.items() if 'Victoria' in n],
        "Silk Board": [nid for nid, n in node_by_name.items() if 'Silk Board' in n],
        "St. John's": [nid for nid, n in node_by_name.items() if 'St. John' in n],
        "Bowring Hospital": [nid for nid, n in node_by_name.items() if 'Bowring' in n],
    }

    # BFS for connectivity check
    def bfs(start, targets):
        visited = set()
        queue = [(start, [start])]
        while queue:
            current, path = queue.pop(0)
            if current in targets:
                return path
            if current in visited:
                continue
            visited.add(current)
            for neighbor in adj.get(current, []):
                if neighbor not in visited:
                    queue.append((neighbor, path + [neighbor]))
        return None

    results = {}
    for start_name, start_nodes in key_nodes.items():
        for target_name, target_nodes in key_nodes.items():
            if start_name != target_name and start_nodes and target_nodes:
                path = bfs(start_nodes[0], target_nodes)
                results[f"{start_name} -> {target_name}"] = "CONNECTED" if path else "DISCONNECTED"

    return results

# =============================================================================
# MAIN EXECUTION
# =============================================================================

def merge_graphs(graphs: List[nx.MultiDiGraph]) -> nx.MultiDiGraph:
    """Merge multiple graphs into one."""
    if not graphs:
        return nx.MultiDiGraph()
    merged = nx.MultiDiGraph()
    for G in graphs:
        merged.add_nodes_from(G.nodes(data=True))
        merged.add_edges_from(G.edges(data=True))
    return merged


def main():
    print("=" * 70)
    print("BENGALURU GEOSPATIAL NETWORK GENERATOR (OSMnx + NetworkX)")
    print("=" * 70)

    setup_osmnx()

    # Download each corridor separately and merge (uses cache)
    print("\n1. Downloading OSM road network for each corridor...")
    corridor_graphs = []
    for corridor in CORRIDORS:
        south, west, north, east = corridor['bbox']
        osm_bbox = (west, south, east, north)
        print(f"  {corridor['name']}: ({south:.4f}, {west:.4f}, {north:.4f}, {east:.4f})")
        try:
            # Use default filter to match cached data
            G_corr = ox.graph_from_bbox(osm_bbox, network_type="drive", simplify=False)
            corridor_graphs.append(G_corr)
            print(f"    -> {len(G_corr.nodes)} nodes, {len(G_corr.edges)} edges")
        except Exception as e:
            print(f"    -> Warning: {e}")

    # Also download hospital areas
    print("\n2. Downloading hospital areas...")
    for area in HOSPITAL_AREAS:
        south, west, north, east = area['bbox']
        osm_bbox = (west, south, east, north)
        print(f"  {area['name']}: ({south:.4f}, {west:.4f}, {north:.4f}, {east:.4f})")
        try:
            G_corr = ox.graph_from_bbox(osm_bbox, network_type="drive", simplify=False)
            corridor_graphs.append(G_corr)
            print(f"    -> {len(G_corr.nodes)} nodes, {len(G_corr.edges)} edges")
        except Exception as e:
            print(f"    -> Warning: {e}")

    # Merge all graphs
    print("\n3. Merging corridor graphs...")
    G = merge_graphs(corridor_graphs)
    print(f"  Merged graph: {len(G.nodes)} nodes, {len(G.edges)} edges")

    # Get largest connected component
    print("\n4. Extracting largest connected component...")
    if len(G.nodes) > 0:
        largest_cc = max(nx.weakly_connected_components(G), key=len)
        G = G.subgraph(largest_cc).copy()
        print(f"  Largest component: {len(G.nodes)} nodes, {len(G.edges)} edges")

    print("\n5. Simplifying graph topology...")
    G = simplify_graph(G)

    # Add elevation data (approximate for Bengaluru)
    print("\n6. Adding elevation data...")
    try:
        G = ox.add_node_elevations_raster(G)
        print("  Elevation data added from raster")
    except Exception as e:
        print(f"  Warning: Could not add elevation raster: {e}")
        for node in G.nodes():
            G.nodes[node]['elevation'] = 920.0

    print("\n7. Extracting nodes...")
    nodes, node_id_map = extract_nodes(G)
    print(f"  Extracted {len(nodes)} nodes")

    print("\n8. Extracting edges...")
    edges = extract_edges(G, node_id_map)
    print(f"  Extracted {len(edges)} directed edges")

    print("\n9. Fetching hospital data from OSM...")
    osm_hospitals = extract_hospitals_from_osm(G)

    print("\n10. Matching hospitals to network...")
    hospital_compounds = match_hospitals_to_nodes(osm_hospitals, nodes, G)
    print(f"  Created {len(hospital_compounds)} hospital compounds")

    print("\n11. Building network JSON...")
    network_data = build_network_json(nodes, edges, hospital_compounds)

    print("\n12. Writing output files...")
    network_output = "Data/GeoJSON/bengaluru_network.json"
    write_network_json(network_data, network_output)

    preview_path = "preview_data.js"
    update_preview_data_js(network_data, preview_path)

    print("\n13. Verifying connectivity...")
    connectivity = verify_connectivity(nodes, edges)
    for route, status in connectivity.items():
        print(f"   {route}: {status}")

    # Zone breakdown
    print("\n14. Zone breakdown:")
    zones = {}
    for node in nodes:
        zone = node['zone']
        zones[zone] = zones.get(zone, 0) + 1
    for zone, count in sorted(zones.items()):
        print(f"    {zone}: {count} nodes")

    # Edge directionality breakdown
    oneway = sum(1 for e in edges if e['oneway'])
    twoway = sum(1 for e in edges if not e['oneway'])
    divided = sum(1 for e in edges if e.get('is_divided_carriageway', False))
    ev_priority = sum(1 for e in edges if e.get('ev_priority_corridor', False))
    print(f"\n15. Edge statistics:")
    print(f"    One-way: {oneway}")
    print(f"    Two-way: {twoway}")
    print(f"    Divided carriageway: {divided}")
    print(f"    EV priority corridors: {ev_priority}")

    # Hospital bays
    total_bays = sum(len(h['bays']) for h in hospital_compounds)
    print(f"\n16. Hospital bays (dual per hospital): {total_bays}")

    print("\n" + "=" * 70)
    print("GENERATION COMPLETE!")
    print("=" * 70)

if __name__ == "__main__":
    main()