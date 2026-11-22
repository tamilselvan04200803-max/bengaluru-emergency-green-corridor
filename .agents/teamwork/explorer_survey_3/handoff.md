# Handoff Report: Explorer 3 (Backend, Simulation, Kinematics & Traffic Logic)

## 1. Observation

### 1.1 Existing WebSocket Server & Telemetry Protocols
- **Server Implementation**: `Scripts/telemetry_server.py` implements `TelemetrySimulationServer` (lines 833–984) using Python `websockets` library. Default endpoint is `ws://0.0.0.0:8765` (lines 844–845), natively reachable at `ws://127.0.0.1:8765`.
- **Command Line Entry Point**: `run_standalone()` at `Scripts/telemetry_server.py:985–1018`, spinning up an `asyncio` event loop with `TelemetrySimulationServer(roads_file=..., signals_file=..., hospitals_file=..., host="0.0.0.0", port=8765, num_ambulances=5, broadcast_rate_hz=10.0, enable_state_broadcast=True)`.
- **Validation Test Suite**: Running `pytest Scripts/` executed 40 unit and integration tests across `Scripts/test_extractors.py`, `Scripts/test_green_wave_engine.py`, and `Scripts/test_telemetry_server.py`. Result: **40 passed in 2.42s** (exit code 0).
- **10Hz Telemetry Broadcast Schema** (`Scripts/telemetry_server.py:812–830`):
  ```python
  {
      "vehicle_id": self.vehicle_id,                   # e.g. "AMB-108-01"
      "timestamp": round(time.time(), 3),              # Unix epoch seconds (float)
      "latitude": self.current_lat,                    # WGS84 Lat (~12.96 to 12.98)
      "longitude": self.current_lon,                  # WGS84 Lon (~77.57 to 77.62)
      "altitude": self.current_alt,                    # Altitude meters MSL (~914-925m)
      "speed_kmh": round(self.speed_kmh, 1),           # Current speed (40.0 - 60.0 km/h)
      "heading": self.heading,                         # Azimuth bearing in deg [0..360)
      "current_road_osm_id": self.current_road_osm_id, # OSM way ID
      "destination_hospital_id": self.destination_hospital_id, # e.g. "hosp_victoria_01"
      "priority_active": self.priority_active,         # Boolean true
      "preempt_junction_osm_id": self.preempt_junction_osm_id, # First junction in green wave
      "green_wave_junction_ids": self.green_wave_junction_ids, # List of upcoming junctions
      "active_route_osm_ids": self.active_route_osm_ids, # Planned road segment OSM IDs
      "speed_advisory_kmh": self.speed_advisory_kmh,   # Speed advisory if arbitrated
      "patient_criticality_tier": self.criticality_tier # 1=Critical, 2=Urgent, 3=Standard
  }
  ```
- **2Hz Decoupled State Frame Schema** (`Scripts/telemetry_server.py:885–909`):
  ```python
  {
      "frame_type": "state",
      "timestamp": round(time.time(), 3),
      "edge_congestion_map": cmap,                     # Dict[str, float] with values [0.0..1.0]
      "route_clear_rate": round(clear_rate, 1),       # Percentage of corridor uncongested (float)
      "total_signal_overrides": self.total_signal_overrides # Cumulative count of preemptions (int)
  }
  ```

### 1.2 Routing, Congestion & Clearance Horizon Math
- **Graph Topology**: Constructed in `RoadNetwork` (`Scripts/telemetry_server.py:241–446`) with dual support for `networkx.DiGraph` and custom fallback `CustomGraph` using Dijkstra (`shortest_path()`, lines 206–238). Edge weight represents travel time in seconds:
  $$\text{weight} = \frac{\text{length\_m}}{\text{speed\_mps}} \times (1.0 + \text{congestion})$$
- **Congestion Simulation**: `CongestionEngine` (`Scripts/telemetry_server.py:448–505`) updates edge weights each second with time-of-day rush hour multiplier ($0.8$ between 08:00–10:00 & 17:00–20:00; $0.3$ otherwise).
- **Dynamic A\* Rerouting**: Evaluated in `AmbulanceAgent._check_route_congestion()` (`Scripts/telemetry_server.py:677–716`). If any upcoming edge on the active route exceeds congestion threshold $> 0.85$, a new shortest path to the destination hospital is dynamically materialized.
- **Traffic Clearance Horizon**: Defined in `AmbulanceAgent._compute_green_wave()` (`Scripts/telemetry_server.py:761–806`):
  $$\text{speed\_mps} = \max\left(5.0, \frac{\text{speed\_kmh} \times 1000}{3600}\right)$$
  $$\text{max\_dist\_by\_time} = \text{speed\_mps} \times 25.0\,\text{s}$$
  $$\text{horizon\_m} = \min(300.0\,\text{m}, \text{max\_dist\_by\_time})$$
- **Multi-Ambulance Conflict Arbitration**: Implemented in `ConflictArbiter` (`Scripts/telemetry_server.py:137–187`). Preemption conflicts on contested junctions are resolved by:
  1. `patient_criticality_tier` (Tier 1 > Tier 2 > Tier 3).
  2. Estimated Time of Arrival ($\text{ETA} = \frac{\text{distance}}{\text{speed\_mps}}$), where shorter ETA wins.
  3. Deterministic lexical tiebreaker on `vehicle_id`.
  4. Loser receives speed advisory: $30.0\,\text{km/h}$.

### 1.3 Client-Side Implementations
- **Web Preview (`preview.html` & `preview_data.js`)**:
  - Contains a 2D Leaflet map (`preview.html:230–241`) centered at `[12.97237, 77.58703]`.
  - Connects to `ws://127.0.0.1:8765` (`preview.html:329–359`), rendering 2D ambulance icons, hospital icons, and traffic signal circle markers (turning green on preemption).
  - Displays top statistics bar (`stat-ambulances`, `stat-clearance`, `stat-preempted`, `stat-fps`) and sidebar cards for 5 ambulances.
  - **Does NOT render 3D graphics, Three.js, WebGL, or civilian vehicles.**
- **Unreal Engine 5.4 C++ Source (`Source/TrafficClearance/`)**:
  - `AmbulanceActor.cpp/.h`: Spline dead-reckoning (`CurrentDistanceAlongSpline += SpeedCmPerSec * DeltaTime`), exponential distance error decay (`DistanceErrorDecaySpeed = 6.0f`), terrain clearance offset clamping (`TerrainClearanceOffsetCm = 15.0f`), post-junction restoration threshold ($30\,\text{m} = 3000\,\text{cm}$ past junction and dot product $< 0$).
  - `AmbulanceFleetManager.cpp/.h`: Subscribes to `UTelemetryWebSocketSubsystem`, dynamically instantiates and routes telemetry to `AAmbulanceActor` instances, indexes `ATrafficJunctionActor` by OSM ID.
  - `TrafficJunctionActor.cpp/.h`: Autonomous state cycle (Red 45s, Green 40s, Amber 5s). On preemption: switches to `PriorityOverride` (green corridor). On deactivation: transitions through `Amber` safety phase before resuming normal cycle.
  - `TrafficSwarmManager.cpp/.h`: Instanced Static Mesh (ISM) rendering for 200 civilian vehicles along road splines. Implements Parting Wave yield: triggers when ambulance is within $80\,\text{m}$ ($8000\,\text{cm}$) behind vehicle along spline; laterally offsets $+120\,\text{cm}$ towards shoulder; clears when ambulance is $> 25\,\text{m}$ ($2500\,\text{cm}$) past. Queues at red/amber signals if within $3\,\text{m}$ ($300\,\text{cm}$) of spline end.

---

## 2. Logic Chain

1. **Premise 1**: The user's `ORIGINAL_REQUEST.md` mandates a *“high-fidelity, interactive Web-Based 3D (Three.js) Digital Twin application of Bengaluru's Emergency Green Corridor traffic clearance system... runs smoothly in browser at 60 FPS without external build steps or complex native installations.”*
2. **Premise 2**: The repository currently contains:
   - A complete, robust Python backend (`Scripts/telemetry_server.py`) serving WebSocket telemetry at 10Hz.
   - Comprehensive C++ simulation logic designed for Unreal Engine 5.4 (`Source/TrafficClearance/`).
   - A basic 2D Leaflet preview (`preview.html`).
3. **Inference 1 (Backend & Telemetry)**: The Python WebSocket server (`ws://127.0.0.1:8765`) is production-ready, highly tested (40 tests passing), and satisfies all backend telemetry requirements. However, in a web application context, relying strictly on an active external Python daemon risks broken UX if the user opens the web page directly. The web application must ingest from `ws://127.0.0.1:8765` when available, and smoothly fall back to an internal client-side 10Hz simulation loop if offline.
4. **Inference 2 (Gap in Requirement R2 — Ambulance Control & Kinematics)**:
   - *Autonomous Mode*: The web application must ingest 10Hz kinematics and translate GPS coordinates to 3D Three.js world space ($X, Y, Z$). While `AmbulanceActor.cpp` has dead-reckoning on splines, Three.js requires realistic 3D ambulance mesh rendering with authentic pitch (tilt on road grades/acceleration) and roll (centripetal tilt on turns).
   - *Manual Driving Mode*: Completely absent in the repository. Keyboard WASD/Arrow keys with vehicle physics (acceleration, top speed, braking, reverse, friction, steering angle) must be implemented.
   - *Camera Switching*: Completely absent. Need a multi-mode camera controller: Chase Cam (third-person dynamic follow), Cockpit Cam (first-person hood view), and Aerial Cam (top-down bird's-eye view).
   - *Siren & Strobes*: Completely absent. Need Web Audio API synthesizer for realistic emergency dual-tone siren (yelp/wail) and flashing dual-color red/blue LED strobes with real-time 3D point lights.
5. **Inference 3 (Gap in Requirement R3 — Chaotic Traffic & Parting Wave AI)**:
   - *Civilian Traffic*: The web frontend currently has 0 civilian vehicles. Must spawn 60–120 dynamic civilian vehicles across the extruded road network.
   - *Vehicle Heterogeneity*: Bengaluru's traffic is uniquely chaotic with 4 distinct vehicle classes: Auto-Rickshaws (green/yellow 3-wheelers), BMTC Buses (large transit buses), Two-Wheelers (scooters/motorcycles lane-filtering), and Passenger Cars (cabs/sedans).
   - *Raycast/Cone Sensor & Parting Wave*: Ambulance needs a forward 3D cone sensor ($60\text{--}80\,\text{m}$ distance, $35^\circ\text{--}45^\circ$ FOV). When siren/priority is active, vehicles inside the cone must steer toward the shoulder/curb ($1.2\text{--}1.8\,\text{m}$ lateral displacement), slowing down to create an open central lane. Vehicles return to normal paths once the ambulance passes.
   - *Signal Preemption & Queue Clearance*: 3D signal poles with glowing Red/Amber/Green lights must switch to green when the ambulance approaches within the calculated clearance horizon ($\min(300\,\text{m}, \text{speed} \times 25\,\text{s})$), prompting queued civilian vehicles at the intersection to accelerate and flush the junction before arrival.
6. **Inference 4 (Gap in Requirement R4 — Benchmark & Impact Analytics Dashboard)**:
   - Neither the Python backend, UE5 code, nor `preview.html` computes parallel Baseline vs AI Green Corridor benchmarks.
   - Need a real-time analytics engine calculating:
     - **Baseline Travel Time**: Uncoordinated traffic model with stochastic red light delays ($35\text{--}50\,\text{s}$ per signal) and congestion-throttled speeds ($12\text{--}15\,\text{km/h}$).
     - **AI Green Corridor Travel Time**: Dynamic pre-empted corridor with zero signal stops and unhindered transit speeds ($45\text{--}55\,\text{km/h}$).
     - **Delta Metrics**: Exact minutes saved (and % savings), average speed improvement ($+200\text{--}250\%$), and intersection halt reduction ($5\text{--}6$ stops $\to$ $0$ stops).
     - **Live HUD Display**: Modern sci-fi / command-center HUD overlay with speedometers, split-time comparison gauges, telemetry connection status, and manual/autonomous mode toggles.

---

## 3. Caveats

1. **Browser Only vs Dual-Engine Architecture**: The original codebase was designed as an Unreal Engine 5.4 C++ project with Cesium for Unreal. Running UE5 requires native compilation, Epic Games Launcher, and a powerful GPU. The user's `ORIGINAL_REQUEST.md` explicitly specifies a standalone Web-Based 3D (Three.js) application running directly in the browser at 60 FPS without external build steps or native installations. Thus, all C++ simulation mechanics must be ported to browser-executable JavaScript/Three.js.
2. **Dual-Mode Telemetry Operation**: If the Python WebSocket server is not running on port 8765, the web application must not fail or freeze; it must detect connection status and seamlessly switch to an embedded client-side simulation while attempting background reconnection.
3. **GeoJSON Coordinate Projection**: `bengaluru_roads.geojson` coordinates are in EPSG:4326 (WGS84). To render in Three.js, coordinates must be projected to a local Cartesian meter grid centered at `[12.97237, 77.58703]` (approx. K.R. Circle / Cubbon Park origin).
4. **Performance Constraint**: Simulating 100+ dynamic civilian vehicles with raycast detection, 3D extruded buildings, weather particle systems, and dual-mode ambulance kinematics must maintain 60 FPS on standard WebGL hardware by using efficient InstancedMesh or lightweight Three.js geometries and spatial bucketing for raycast queries.

---

## 4. Conclusion

The backend and algorithmic foundations of the project (`Scripts/telemetry_server.py`) are fully functional, architecturally sound, and mathematically rigorous. The 10Hz telemetry protocol, 2Hz decoupled state frames, dynamic A* rerouting, traffic clearance horizon ($\min(300\text{m}, v \times 25\text{s})$), and multi-vehicle conflict arbitration are already fully realized in Python with passing test coverage.

However, **there is a total void of 3D Web/Three.js implementation in the repository**. The web layer is currently only a 2D Leaflet HTML page (`preview.html`). To satisfy Requirements R2, R3, and R4, the implementation phase must build:
1. **R2**: A comprehensive Three.js 3D ambulance system featuring autonomous WebSocket telemetry ingestion (`ws://127.0.0.1:8765`), client-side autonomous simulation fallback, authentic pitch/roll suspension kinematics, manual WASD driving with realistic vehicle physics, 3-mode camera toggle (Chase, Cockpit, Aerial), and an interactive Web Audio dual-tone siren with flashing red/blue strobe lighting.
2. **R3**: A chaotic Bengaluru civilian traffic engine featuring 4 distinct vehicle archetypes (Auto-rickshaws, BMTC buses, two-wheelers, cars), a forward cone/raycast sensor on the ambulance triggering dynamic lateral Parting Wave yielding, and 3D signalized junctions executing early green-wave preemption with queue flushing.
3. **R4**: An integrated Heads-Up Display (HUD) and comparative analytics engine computing live Baseline vs AI Green Corridor travel times, exact minutes saved, average response speed boost, and intersection halt count reductions.

---

## 5. Verification Method

To independently verify the observations and findings in this report:

1. **Verify Backend Tests**:
   Execute the pytest suite from the project root:
   ```powershell
   pytest Scripts/
   ```
   *Expected Result*: 40 passed in <3 seconds.

2. **Verify Standalone WebSocket Server**:
   Launch the telemetry server and monitor stream:
   ```powershell
   # Terminal 1: Launch WebSocket server
   python Scripts/telemetry_server.py

   # Terminal 2: Run monitor stream client
   python Scripts/monitor_stream.py
   ```
   *Expected Result*: Terminal 2 connects to `ws://127.0.0.1:8765`, receives 10Hz telemetry payloads with `green_wave_junction_ids`, `patient_criticality_tier`, and 2Hz decoupled state frames with `route_clear_rate`.

3. **Verify Existing 2D Web Preview**:
   Inspect `preview.html` in browser or view source:
   - Notice it uses `leaflet.js` and Leaflet 2D DOM layers (`preview.html:8–11, 230–241`).
   - Confirm absence of Three.js, WebGL canvas, 3D meshes, WASD keyboard input, audio oscillators, or civilian traffic.

4. **Verify C++ Simulation Reference Logic**:
   - Inspect `Source/TrafficClearance/TrafficSwarmManager.cpp:199–234` for Parting Wave yield thresholds ($8000\,\text{cm}$ trigger, $2500\,\text{cm}$ clear, $120\,\text{cm}$ shoulder offset).
   - Inspect `Source/TrafficClearance/TrafficJunctionActor.cpp:96–151` for signal preemption and Amber safety recovery phase.
   - Inspect `Source/TrafficClearance/AmbulanceActor.cpp:223–251` for post-junction clearance ($3000\,\text{cm}$ and negative dot product).
