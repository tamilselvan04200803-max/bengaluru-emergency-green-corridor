"""
Unit and integration tests for telemetry_server.py.

Tests cover:
1. Graph construction from roads GeoJSON (NetworkX and Custom fallback).
2. Topological mapping of traffic signals and hospitals to road graph vertices.
3. Continuous shortest-path calculation (Dijkstra/A*).
4. Realistic ambulance movement dynamics (speed 40-60 km/h, heading, altitude, coordinate progression).
5. Signal preemption detection within 100m-150m along active route.
6. Telemetry payload schema compliance.
7. WebSocket server live broadcast at 10Hz and client connectivity.
"""

import asyncio
import json
import math
import os
import sys
import time
from pathlib import Path
import pytest
import websockets

# Ensure Scripts directory is on sys.path
SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from telemetry_server import (
    RoadNetwork,
    AmbulanceAgent,
    TelemetrySimulationServer,
    CustomGraph,
    haversine_distance,
    calculate_bearing,
    interpolate_coord,
    extract_id,
    HAS_NETWORKX,
)

ROADS_PATH = PROJECT_ROOT / "Data" / "GeoJSON" / "bengaluru_roads.geojson"
SIGNALS_PATH = PROJECT_ROOT / "Data" / "GeoJSON" / "bengaluru_traffic_signals.geojson"
HOSPITALS_PATH = PROJECT_ROOT / "Data" / "GeoJSON" / "bengaluru_hospitals.geojson"


@pytest.fixture
def loaded_network():
    network = RoadNetwork()
    network.load_from_geojson(ROADS_PATH, SIGNALS_PATH, HOSPITALS_PATH)
    return network


class TestGeospatialHelpers:
    def test_haversine_distance(self):
        # Known distance between Majestic and Seshadri junction (~730m)
        d = haversine_distance(77.5729, 12.9778, 77.5795, 12.9765)
        assert 700.0 < d < 760.0

        # Distance to self should be zero
        assert haversine_distance(77.5729, 12.9778, 77.5729, 12.9778) == 0.0

    def test_calculate_bearing(self):
        # Heading east-ish
        b = calculate_bearing(77.5729, 12.9778, 77.5795, 12.9765)
        assert 0.0 <= b <= 360.0
        assert 90.0 < b < 120.0

        # Pure north
        b_north = calculate_bearing(77.0, 12.0, 77.0, 13.0)
        assert abs(b_north - 0.0) < 0.1 or abs(b_north - 360.0) < 0.1

    def test_interpolate_coord(self):
        p1 = [77.0, 12.0, 900.0]
        p2 = [77.1, 12.2, 920.0]
        mid = interpolate_coord(p1, p2, 0.5)
        assert abs(mid[0] - 77.05) < 1e-5
        assert abs(mid[1] - 12.10) < 1e-5
        assert abs(mid[2] - 910.0) < 1e-5

    def test_extract_id(self):
        assert extract_id(12345) == 12345
        assert extract_id("98765432") == 98765432
        assert extract_id("way_seshadri_01") == "way_seshadri_01"
        assert extract_id(None) is None


class TestGraphConstruction:
    def test_load_roads_into_network(self, loaded_network: RoadNetwork):
        # Verify vertices and edges loaded
        assert len(loaded_network.node_coords) >= 15
        assert len(loaded_network.edges) >= 25
        assert "node_majestic" in loaded_network.node_coords
        assert "node_kr_circle" in loaded_network.node_coords

    def test_signals_mapping(self, loaded_network: RoadNetwork):
        # 15 traffic signals should be mapped
        assert len(loaded_network.signals_by_node) >= 10
        assert "node_majestic" in loaded_network.signals_by_node
        assert "node_mysore_bank" in loaded_network.signals_by_node

    def test_hospitals_mapping(self, loaded_network: RoadNetwork):
        # 5 hospitals mapped
        assert len(loaded_network.hospitals) >= 4
        assert "hosp_victoria_01" in loaded_network.hospitals
        assert "hosp_bowring_01" in loaded_network.hospitals

    def test_custom_fallback_graph(self):
        cg = CustomGraph()
        cg.add_edge("A", "B", weight=5.0)
        cg.add_edge("B", "C", weight=3.0)
        cg.add_edge("A", "C", weight=10.0)

        path = cg.shortest_path("A", "C", weight="weight")
        assert path == ["A", "B", "C"]

        with pytest.raises(ValueError):
            cg.shortest_path("A", "NON_EXISTENT")

    def test_shortest_path_routing(self, loaded_network: RoadNetwork):
        # Majestic to Victoria Hospital Gate
        path = loaded_network.find_shortest_path(
            "node_majestic", "node_victoria_hospital_gate"
        )
        assert len(path) >= 3
        assert path[0] == "node_majestic"
        assert path[-1] == "node_victoria_hospital_gate"

        # Majestic to Bowring Hospital
        path_bowring = loaded_network.find_shortest_path(
            "node_majestic", "node_bowring_hospital_gate"
        )
        assert path_bowring[0] == "node_majestic"
        assert path_bowring[-1] == "node_bowring_hospital_gate"


class TestAmbulanceSimulation:
    def test_ambulance_initialization(self, loaded_network: RoadNetwork):
        agent = AmbulanceAgent("AMB-108-01", loaded_network)
        assert agent.vehicle_id == "AMB-108-01"
        assert 40.0 <= agent.speed_kmh <= 60.0
        assert agent.priority_active is True
        assert agent.destination_hospital_id in loaded_network.hospitals
        assert len(agent.node_path) >= 2
        assert agent.total_route_length > 0.0

    def test_ambulance_telemetry_schema(self, loaded_network: RoadNetwork):
        agent = AmbulanceAgent("AMB-108-02", loaded_network)
        payload = agent.get_telemetry_payload()

        # Validate required schema fields
        expected_keys = {
            "vehicle_id",
            "timestamp",
            "latitude",
            "longitude",
            "altitude",
            "speed_kmh",
            "heading",
            "current_road_osm_id",
            "destination_hospital_id",
            "priority_active",
            "preempt_junction_osm_id",
        }
        assert expected_keys.issubset(payload.keys())
        assert payload["vehicle_id"] == "AMB-108-02"
        assert isinstance(payload["timestamp"], (int, float))
        assert 12.0 < payload["latitude"] < 13.5
        assert 77.0 < payload["longitude"] < 78.0
        assert isinstance(payload["altitude"], (int, float))
        assert 40.0 <= payload["speed_kmh"] <= 60.0
        assert 0.0 <= payload["heading"] <= 360.0
        assert payload["priority_active"] is True
        assert payload["destination_hospital_id"] is not None

    def test_ambulance_movement_progression(self, loaded_network: RoadNetwork):
        agent = AmbulanceAgent(
            "AMB-108-03",
            loaded_network,
            speed_kmh=50.0,
            start_node="node_majestic",
            destination_hospital_id="hosp_victoria_01",
        )
        initial_d = agent.current_distance
        initial_pos = (agent.current_lat, agent.current_lon)

        # Advance 1 second (~13.88 meters)
        agent.step(1.0)
        assert agent.current_distance > initial_d
        new_pos = (agent.current_lat, agent.current_lon)
        # Position must have moved
        moved_dist = haversine_distance(initial_pos[1], initial_pos[0], new_pos[1], new_pos[0])
        assert 10.0 <= moved_dist <= 16.0

    def test_signal_preemption_triggering(self, loaded_network: RoadNetwork):
        # Place ambulance on route towards Victoria Hospital via Mysore Bank
        agent = AmbulanceAgent(
            "AMB-PREEMPT-TEST",
            loaded_network,
            speed_kmh=50.0,
            start_node="node_majestic",
            destination_hospital_id="hosp_victoria_01",
        )
        preempts = []
        # Step for 200 seconds in 0.5s intervals (~7m per step)
        for _ in range(300):
            agent.step(0.5)
            p = agent.get_telemetry_payload()
            if p["preempt_junction_osm_id"] is not None:
                preempts.append(p["preempt_junction_osm_id"])

        # Must have encountered at least one upcoming signal along the route
        assert len(preempts) > 0


class TestWebSocketServerIntegration:
    @pytest.mark.asyncio
    async def test_websocket_broadcast_10hz_timing_and_schema(self):
        test_port = 8777
        server = TelemetrySimulationServer(
            roads_file=ROADS_PATH,
            signals_file=SIGNALS_PATH,
            hospitals_file=HOSPITALS_PATH,
            host="127.0.0.1",
            port=test_port,
            num_ambulances=3,
            broadcast_rate_hz=10.0,
        )

        await server.start()

        received_messages = []
        try:
            async with websockets.connect(f"ws://127.0.0.1:{test_port}") as ws:
                t0 = time.perf_counter()
                # Receive 30 messages (3 ambulances * 10 ticks = 1 second)
                for _ in range(30):
                    msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    received_messages.append((time.perf_counter(), json.loads(msg)))
                duration = time.perf_counter() - t0

            # 30 messages from 3 ambulances is ~10 ticks. At 10Hz, ~1.0 second.
            assert len(received_messages) == 30
            assert 0.7 <= duration <= 2.0, f"Expected ~1s for 10 ticks, got {duration:.2f}s"

            # Validate each received payload against schema
            for _, payload in received_messages:
                assert "vehicle_id" in payload
                assert payload["vehicle_id"].startswith("AMB-108-")
                assert "latitude" in payload
                assert "longitude" in payload
                assert "speed_kmh" in payload
                assert "heading" in payload
                assert "preempt_junction_osm_id" in payload
                assert payload["priority_active"] is True

        finally:
            await server.stop()
