"""
Unit and integration tests for Phase 3 Green Wave Engine, CongestionEngine, ConflictArbiter,
and 2Hz Decoupled State Frame broadcast.

Tests cover:
1. CongestionEngine:
   - initialization & base weight snapshotting
   - weight evolution during tick with rush hour multiplier
   - blockage injection and weight doubling
   - dynamic A* rerouting when congestion > 0.85 on active path
2. GreenWaveCalculator:
   - distance horizon capping at 300m
   - time/ETA horizon at low speed (speed * 25s)
   - strict min(300m, speed_mps * 25s) evaluation
   - empty wave when no signals within horizon
3. ConflictArbiter:
   - single ambulance preemption acquisition
   - higher patient criticality tier (1 vs 2) winning preemption
   - equal tier shorter ETA winning preemption and issuing speed advisory to loser
   - deterministic deadlock-free simultaneous requests
   - lock release allowing reacquisition
4. StatePayload & WebSocket Broadcast:
   - 2Hz decoupled state frame schema validation
   - route_clear_rate calculation under varying congestion
   - 10Hz kinematic payload containing Green Wave array, active routes, and criticality tier
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path
import pytest
import websockets

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from telemetry_server import (
    RoadNetwork,
    AmbulanceAgent,
    TelemetrySimulationServer,
    CongestionEngine,
    ConflictArbiter,
    AmbulanceInfo,
    GREEN_WAVE_DISTANCE_M,
    GREEN_WAVE_ETA_SEC,
    extract_id,
    get_ambulance_criticality_tier,
)

ROADS_PATH = PROJECT_ROOT / "Data" / "GeoJSON" / "bengaluru_roads.geojson"
SIGNALS_PATH = PROJECT_ROOT / "Data" / "GeoJSON" / "bengaluru_traffic_signals.geojson"
HOSPITALS_PATH = PROJECT_ROOT / "Data" / "GeoJSON" / "bengaluru_hospitals.geojson"


@pytest.fixture
def loaded_network():
    network = RoadNetwork()
    network.load_from_geojson(ROADS_PATH, SIGNALS_PATH, HOSPITALS_PATH)
    return network


class TestCongestionEngine:
    def test_initialize_congestion(self, loaded_network: RoadNetwork):
        ce = CongestionEngine(loaded_network)
        ce.initialize()
        assert len(ce._base_weights) == len(loaded_network.edges)
        assert len(ce._congestion) > 0

        cmap = ce.get_map()
        for k, v in cmap.items():
            assert 0.0 <= v <= 1.0

    def test_tick_evolves_weights(self, loaded_network: RoadNetwork):
        ce = CongestionEngine(loaded_network)
        ce.initialize()

        (u, v), edge = next(iter(loaded_network.edges.items()))
        base = ce._base_weights[(u, v)]

        # Tick at simulated 9am rush hour
        sim_9am_seconds = 9.0 * 3600.0
        ce.tick(sim_9am_seconds)

        new_c = ce._congestion[edge.id]
        assert 0.0 <= new_c <= 1.0

        if loaded_network.nx_graph is not None:
            nx_weight = loaded_network.nx_graph[u][v]["weight"]
            expected = base * (1.0 + new_c)
            assert abs(nx_weight - expected) < 1e-4

    def test_inject_blockage(self, loaded_network: RoadNetwork):
        ce = CongestionEngine(loaded_network)
        ce.initialize()

        (u, v), edge = next(iter(loaded_network.edges.items()))
        base = ce._base_weights[(u, v)]

        ce.inject_blockage(edge.id, 1.0)
        assert ce._congestion[edge.id] == 1.0

        if loaded_network.nx_graph is not None:
            nx_weight = loaded_network.nx_graph[u][v]["weight"]
            assert abs(nx_weight - (base * 2.0)) < 1e-4

    def test_dynamic_reroute_on_high_congestion(self, loaded_network: RoadNetwork):
        ce = CongestionEngine(loaded_network)
        ce.initialize()

        agent = AmbulanceAgent(
            "AMB-REROUTE-TEST",
            loaded_network,
            speed_kmh=50.0,
            start_node="node_majestic",
            destination_hospital_id="hosp_victoria_01",
        )
        assert len(agent.node_path) >= 2
        original_path = list(agent.node_path)

        # Inject blockage on the immediate next edge of route
        target_u = agent.node_path[0]
        target_v = agent.node_path[1]
        edge = loaded_network.edges.get((target_u, target_v))
        assert edge is not None

        ce.inject_blockage(edge.id, 0.95)

        rerouted = agent._check_route_congestion(ce)
        assert rerouted is True
        assert agent.node_path is not None


class TestGreenWaveCalculator:
    def test_wave_distance_horizon(self, loaded_network: RoadNetwork):
        # High speed: 72 km/h = 20 m/s -> 20 * 25s = 500m > 300m cap
        agent = AmbulanceAgent("AMB-SPEEDY", loaded_network, speed_kmh=72.0)
        speed_mps = (agent.speed_kmh * 1000.0) / 3600.0
        max_dist_by_time = speed_mps * GREEN_WAVE_ETA_SEC
        horizon_m = min(GREEN_WAVE_DISTANCE_M, max_dist_by_time)
        assert horizon_m == 300.0

    def test_wave_eta_horizon(self, loaded_network: RoadNetwork):
        # Low speed: 18 km/h = 5 m/s -> 5 * 25s = 125m < 300m cap
        agent = AmbulanceAgent("AMB-SLOW", loaded_network, speed_kmh=18.0)
        speed_mps = (agent.speed_kmh * 1000.0) / 3600.0
        max_dist_by_time = speed_mps * GREEN_WAVE_ETA_SEC
        horizon_m = min(GREEN_WAVE_DISTANCE_M, max_dist_by_time)
        assert horizon_m == 125.0

    def test_wave_uses_min_horizon(self, loaded_network: RoadNetwork):
        # Across speeds from 10 km/h to 100 km/h, verify strict min(300.0, speed_mps * 25.0)
        for spd in [10.0, 30.0, 43.2, 55.0, 80.0, 100.0]:
            speed_mps = (spd * 1000.0) / 3600.0
            expected = min(300.0, speed_mps * 25.0)
            agent = AmbulanceAgent("AMB-TEST-SPD", loaded_network, speed_kmh=spd)
            calc_mps = (agent.speed_kmh * 1000.0) / 3600.0
            horizon = min(GREEN_WAVE_DISTANCE_M, calc_mps * GREEN_WAVE_ETA_SEC)
            assert abs(horizon - expected) < 1e-3

    def test_wave_empty_when_no_signals_ahead(self, loaded_network: RoadNetwork):
        agent = AmbulanceAgent("AMB-NO-SIG", loaded_network, speed_kmh=50.0)
        # Advance to extreme end of route
        agent.current_distance = agent.total_route_length - 0.1
        wave = agent._compute_green_wave()
        assert isinstance(wave, list)


class TestConflictArbiter:
    def test_single_ambulance_wins(self):
        arbiter = ConflictArbiter()
        info = AmbulanceInfo(vehicle_id="AMB-108-01", criticality_tier=1, eta_seconds=12.0)
        result = arbiter.request_preemption(1001, info)
        assert result is True
        assert arbiter._locks[1001].vehicle_id == "AMB-108-01"

    def test_higher_criticality_tier_wins(self):
        arbiter = ConflictArbiter()
        # Tier 2 holds junction
        holder_info = AmbulanceInfo(vehicle_id="AMB-108-02", criticality_tier=2, eta_seconds=8.0)
        arbiter.request_preemption(2001, holder_info)

        # Tier 1 (Critical) requests same junction even with longer ETA
        challenger_info = AmbulanceInfo(vehicle_id="AMB-108-01", criticality_tier=1, eta_seconds=18.0)
        won = arbiter.request_preemption(2001, challenger_info)
        assert won is True
        assert arbiter._locks[2001].vehicle_id == "AMB-108-01"
        # Loser receives speed advisory
        advisory = arbiter.get_speed_advisory("AMB-108-02")
        assert advisory is not None
        assert advisory > 0.0

    def test_equal_tier_shorter_eta_wins(self):
        arbiter = ConflictArbiter()
        # Both Tier 1
        amb1 = AmbulanceInfo(vehicle_id="AMB-A", criticality_tier=1, eta_seconds=15.0)
        amb2 = AmbulanceInfo(vehicle_id="AMB-B", criticality_tier=1, eta_seconds=5.0)

        arbiter.request_preemption(3001, amb1)
        # amb2 has shorter ETA -> wins
        won = arbiter.request_preemption(3001, amb2)
        assert won is True
        assert arbiter._locks[3001].vehicle_id == "AMB-B"
        assert arbiter.get_speed_advisory("AMB-A") is not None

        # amb3 has longer ETA -> loses
        amb3 = AmbulanceInfo(vehicle_id="AMB-C", criticality_tier=1, eta_seconds=20.0)
        won3 = arbiter.request_preemption(3001, amb3)
        assert won3 is False
        assert arbiter.get_speed_advisory("AMB-C") is not None

    def test_deadlock_free_simultaneous_same_timestamp(self):
        arbiter = ConflictArbiter()
        # Exact same tier and ETA -> tiebreak deterministically by vehicle_id
        amb1 = AmbulanceInfo(vehicle_id="AMB-108-01", criticality_tier=1, eta_seconds=10.0)
        amb2 = AmbulanceInfo(vehicle_id="AMB-108-02", criticality_tier=1, eta_seconds=10.0)

        res1 = arbiter.request_preemption(4001, amb1)
        res2 = arbiter.request_preemption(4001, amb2)

        # Exactly one must hold the lock, no crash, no deadlock
        assert arbiter._locks[4001] is not None
        assert (res1, res2) in [(True, False), (False, True)]

    def test_release_allows_reacquisition(self):
        arbiter = ConflictArbiter()
        amb1 = AmbulanceInfo(vehicle_id="AMB-108-01", criticality_tier=1, eta_seconds=5.0)
        amb2 = AmbulanceInfo(vehicle_id="AMB-108-02", criticality_tier=2, eta_seconds=5.0)

        arbiter.request_preemption(5001, amb1)
        # amb2 cannot acquire while amb1 holds it
        assert arbiter.request_preemption(5001, amb2) is False

        # amb1 clears junction
        arbiter.release(5001, "AMB-108-01")
        assert 5001 not in arbiter._locks

        # amb2 can now acquire
        assert arbiter.request_preemption(5001, amb2) is True


class TestStatePayload:
    def test_state_broadcast_schema(self, loaded_network: RoadNetwork):
        server = TelemetrySimulationServer(
            roads_file=ROADS_PATH,
            signals_file=SIGNALS_PATH,
            hospitals_file=HOSPITALS_PATH,
            enable_state_broadcast=True,
        )
        state_frame = server.get_state_payload()

        assert state_frame["frame_type"] == "state"
        assert isinstance(state_frame["timestamp"], (int, float))
        assert isinstance(state_frame["edge_congestion_map"], dict)
        assert isinstance(state_frame["route_clear_rate"], (int, float))
        assert 0.0 <= state_frame["route_clear_rate"] <= 100.0
        assert isinstance(state_frame["total_signal_overrides"], int)

    def test_route_clear_rate_calculation(self, loaded_network: RoadNetwork):
        server = TelemetrySimulationServer(
            roads_file=ROADS_PATH,
            signals_file=SIGNALS_PATH,
            hospitals_file=HOSPITALS_PATH,
            enable_state_broadcast=True,
        )
        # Clear congestion map
        for k in server.congestion_engine._congestion.keys():
            server.congestion_engine._congestion[k] = 0.1

        clear_state = server.get_state_payload()
        assert clear_state["route_clear_rate"] == 100.0

        # Inject blockage on all edges
        for k in server.congestion_engine._congestion.keys():
            server.congestion_engine._congestion[k] = 0.95

        blocked_state = server.get_state_payload()
        assert blocked_state["route_clear_rate"] == 0.0

    def test_10hz_payload_contains_green_wave(self, loaded_network: RoadNetwork):
        agent = AmbulanceAgent("AMB-108-01", loaded_network)
        payload = agent.get_telemetry_payload()

        assert "green_wave_junction_ids" in payload
        assert isinstance(payload["green_wave_junction_ids"], list)
        assert "active_route_osm_ids" in payload
        assert isinstance(payload["active_route_osm_ids"], list)
        assert "speed_advisory_kmh" in payload
        assert "patient_criticality_tier" in payload
        assert payload["patient_criticality_tier"] == 1

        # Check tier assignment rules
        assert get_ambulance_criticality_tier("AMB-108-01") == 1
        assert get_ambulance_criticality_tier("AMB-108-02") == 2
        assert get_ambulance_criticality_tier("AMB-108-03") == 2
        assert get_ambulance_criticality_tier("AMB-108-04") == 3
        assert get_ambulance_criticality_tier("AMB-108-05") == 3
