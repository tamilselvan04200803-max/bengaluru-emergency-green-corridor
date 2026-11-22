import asyncio
import json
import websockets

async def test_client():
    uri = "ws://127.0.0.1:8765"
    print(f"Connecting to {uri}...")
    async with websockets.connect(uri) as ws:
        print("Connected to Bengaluru Telemetry Dispatcher!")
        kinematic_count = 0
        state_count = 0
        while kinematic_count < 10 or state_count < 2:
            raw = await ws.recv()
            data = json.loads(raw)
            if data.get("frame_type") == "state":
                state_count += 1
                clear_rate = data.get("route_clear_rate", 0)
                overrides = data.get("total_signal_overrides", 0)
                num_edges = len(data.get("edge_congestion_map", {}))
                print(f"[STATE 2Hz #{state_count}] Clear Rate: {clear_rate}% | Active Signal Overrides: {overrides} | Congested Edges Tracked: {num_edges}")
            else:
                kinematic_count += 1
                vid = data.get("vehicle_id")
                tier = data.get("patient_criticality_tier")
                spd = data.get("speed_kmh")
                lat = data.get("latitude")
                lon = data.get("longitude")
                wave = data.get("green_wave_junction_ids", [])
                print(f"[TELEMETRY 10Hz #{kinematic_count:02d}] {vid} (Tier {tier}) -> Spd: {spd} km/h | Coords: ({lat:.5f}, {lon:.5f}) | GreenWave Junctions: {wave}")

if __name__ == "__main__":
    asyncio.run(test_client())
