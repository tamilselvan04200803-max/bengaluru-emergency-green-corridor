# Handoff Report: Explorer 1 (Project Structure & Environment Survey)

## 1. Observation

### 1.1 Directory & File Layout
A comprehensive scan of `c:\Users\tamil\Downloads\traffic-clearance-system` reveals 4 primary directories, 1 configuration folder, and root entry files:

```
c:\Users\tamil\Downloads\traffic-clearance-system\
├── Config/
│   ├── DefaultEngine.ini                   # UE5 rendering, Nanite, Lumen, LWC, Cesium config
│   └── DefaultGame.ini                     # Project metadata & simulation parameters
├── Data/
│   └── GeoJSON/
│       ├── bengaluru_roads.geojson         # 19 LineString road corridors with lanes, speeds, heights
│       ├── bengaluru_hospitals.geojson     # 5 Point hospital POIs with beds, trauma tiers, helipads
│       └── bengaluru_traffic_signals.geojson # 15 Point signal nodes with ITMS lead times & cycle specs
├── Scripts/
│   ├── telemetry_server.py                 # Production-grade 10Hz kinematics + 2Hz state WS server (1,019 lines)
│   ├── monitor_stream.py                   # WebSocket stream consumer client for terminal diagnostics
│   ├── osm_extractor.py                    # Overpass API extraction pipeline with fallback endpoints
│   ├── pbf_extractor.py                    # Osmium PBF extraction pipeline
│   ├── requirements.txt                    # Python dependencies
│   ├── test_extractors.py                  # Unit tests for GIS parsers
│   ├── test_green_wave_engine.py           # Unit tests for CongestionEngine & GreenWaveCalculator
│   └── test_telemetry_server.py            # Unit tests for routing and WebSocket broadcast
├── Source/
│   ├── TrafficClearance.Target.cs
│   ├── TrafficClearanceEditor.Target.cs
│   └── TrafficClearance/                   # 21 C++ source/header files (UE5 C++ module)
│       ├── AmbulanceActor.h/.cpp           # Spline dead-reckoning, preemption trigger
│       ├── AmbulanceFleetManager.h/.cpp    # Multi-ambulance arbitration, junction preemption dispatch
│       ├── GeoCoordinateTransformer.h/.cpp # WGS84 to local Cartesian coordinate conversions
│       ├── GeoJSONParser.h/.cpp            # High-speed GeoJSON deserializer
│       ├── HospitalPOIActor.h/.cpp         # Hospital actor with emergency capacity
│       ├── RoadSplineNetworkGenerator.h/.cpp # Spline generation with terrain raycast draping
│       ├── TelemetryWebSocketSubsystem.h/.cpp # WebSocket client subsystem for UE5
│       ├── TrafficClearance.Build.cs       # Module dependencies (Cesium, Json, ProcMesh)
│       ├── TrafficJunctionActor.h/.cpp     # Signal state machine (Red, Amber, Green, PriorityOverride)
│       └── TrafficSwarmManager.h/.cpp      # Instanced Static Mesh civilian traffic & Parting Wave AI
├── TrafficClearance.uproject               # Unreal Engine 5.4 project descriptor
├── README.md                               # System overview, reference landmarks, architecture
├── SETUP_GUIDE.md                          # UE5 installation & Python GIS setup documentation
├── preview.html                            # Standalone 2D Leaflet web viewer (446 lines)
└── preview_data.js                         # Bundled JS object mirror of GeoJSON datasets (23.8 KB)
```

### 1.2 Execution Environment Telemetry
Tool commands executed against the host environment:
1. **Python Environment**:
   - Command: `python --version`
   - Output: `Python 3.13.7`
   - Test execution: `pytest Scripts/ -v`
   - Result: `40 passed in 1.82s` (100% pass rate across test_extractors.py, test_green_wave_engine.py, test_telemetry_server.py).
   - Available packages: `websockets`, `shapely`, `geopandas`, `requests`, `pytest`, `hypothesis`, `typeguard`, `anyio`.

2. **Node.js & Package Manager**:
   - Command: `node --version; npm --version; python --version`
   - Output:
     - Node: `v24.14.1`
     - npm execution: `npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system. For more information, see about_Execution_Policies at https:/go.microsoft.com/fwlink/?LinkID=135170.`
   - Finding: Running npm commands directly in Windows PowerShell triggers execution policy errors (`PSSecurityException`). No `package.json`, Vite, Webpack, or npm configuration exists in the repository.

3. **Existing Web Implementations**:
   - `preview.html`: 2D Leaflet map connecting to `ws://127.0.0.1:8765`, visualizing road lines, hospital points, signal indicators, and ambulance locations.
   - `preview_data.js`: Direct JS variables `ROADS_DATA`, `SIGNALS_DATA`, `HOSPITALS_DATA`.
   - **No 3D WebGL / Three.js implementation currently exists** in the repository.

4. **Existing Simulation Server**:
   - `Scripts/telemetry_server.py`:
     - Serves WebSocket on `ws://0.0.0.0:8765`.
     - Broadcasts 10Hz kinematics: `vehicle_id`, `latitude`, `longitude`, `speed_kmh`, `heading`, `destination_hospital_id`, `patient_criticality_tier`, `green_wave_junction_ids`, `speed_advisory_kmh`.
     - Broadcasts 2Hz state frames: `edge_congestion_map`, `route_clear_rate`, `total_signal_overrides`.
     - Fully operational and tested.

5. **Reference Simulation Algorithms (from C++ code)**:
   - Parting Wave Yield (`TrafficSwarmManager.cpp:216-232`):
     - Trigger condition: Ambulance is approaching behind vehicle on the same spline segment within `YieldTriggerDistanceCm = 8000 cm` (80 meters).
     - Action: Civilian vehicle lerps laterally toward the road shoulder (`LateralOffsetCm` interp to `ShoulderOffsetCm` = 350 cm).
     - Clear condition: Ambulance has passed and is past `PastClearDistanceCm = 2500 cm` (25 meters).
   - Signal Preemption (`TrafficJunctionActor.h:13-19`, `AmbulanceActor.cpp:156-180`):
     - Ahead-of-vehicle horizon: calculated via `min(300.0m, speed_mps * 25.0s)` in Python server.
     - Signals transition to `PriorityOverride` (Green wave for corridor, Red for side traffic).
   - Swarm Performance:
     - `TrafficSwarmManager.cpp:177-180`: Uses `BatchUpdateInstancesTransforms` on `InstancedStaticMeshComponent` to avoid individual actor draw calls and achieve high frame rates.

---

## 2. Logic Chain

1. **Premise 1 (Zero-Build Requirement)**: Acceptance criterion AC1 states: *"3D application runs smoothly in browser at 60 FPS without external build steps or complex installations."*
2. **Premise 2 (Environment Constraints)**: Windows PowerShell security policy restricts `.ps1` execution, causing standard `npm` invocations to fail without administrative policy override. Furthermore, requiring Vite, Webpack, or npm installs introduces unnecessary developer friction.
3. **Premise 3 (Modern Web Capabilities)**: Modern browsers natively support ES modules (`<script type="module">`), WebGL, Canvas API, Web Audio API, and WebSocket connections without any compilation step. Three.js can be imported directly via standard CDN (e.g., `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` or `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`) or vendored locally into a `/js/vendor/` folder.
4. **Premise 4 (60 FPS Performance Feasibility)**:
   - High polygon counts from 200+ civilian vehicles would stall standard Three.js `Mesh` rendering if created as individual objects due to draw call overhead.
   - However, using `THREE.InstancedMesh` with dynamic `instanceMatrix` updates (matching the architectural design of `UInstancedStaticMeshComponent` in `TrafficSwarmManager.cpp`) collapses 200+ vehicle instances into a single WebGL draw call.
   - Road geometry can be generated as a merged buffer geometry (surface + lane marking stripes + sidewalk curbs) from the 19 LineString features in `bengaluru_roads.geojson`.
   - Extruded 3D building masses can be procedurally generated around the corridor polygons with height variation (15m to 70m) and custom facade materials.
   - Rain weather can be rendered efficiently using a `THREE.Points` particle system (single draw call for 5,000+ rain streaks).
   - Audio siren simulation can be generated purely in software via `AudioContext` oscillator ramps (Web Audio API) without loading external `.mp3`/`.wav` assets.
5. **Premise 5 (Serving Model)**:
   - Static files (`index.html`, styles, JS modules, GeoJSON data) can be served with Python's built-in zero-dependency HTTP server: `python -m http.server 8000`.
   - The telemetry simulation server can run simultaneously via `python Scripts/telemetry_server.py` on port 8765, or a unified lightweight runner can start both.
   - Furthermore, the client web app can include an offline/standalone simulation playback fallback (similar to `preview.html:348-353`) so the 3D application functions even if the WebSocket server is not running!

---

## 3. Caveats

1. **Unreal Engine 5.4 C++ vs Web Application**:
   - The repository currently contains UE5 C++ source files (`Source/TrafficClearance/`) and a `.uproject` file.
   - The user's request (ORIGINAL_REQUEST.md) explicitly calls for a **Web-Based 3D (Three.js) Digital Twin application**. The C++ code serves as the algorithmic and architectural reference (parting wave mechanics, signal states, coordinate transformations), while the new deliverable is the interactive WebGL/Three.js application.
2. **Building Footprints in GeoJSON**:
   - `Data/GeoJSON/` currently holds `bengaluru_roads.geojson`, `bengaluru_hospitals.geojson`, and `bengaluru_traffic_signals.geojson`.
   - Dedicated building parcel polygons are not yet stored as a standalone GeoJSON file in `Data/GeoJSON/`. Realistic building masses can either be procedurally generated along the corridor parcels matching Bengaluru landmark parcels (Vidhana Soudha, Victoria Hospital, St. Martha's, UB City, Bowring) or generated into `bengaluru_buildings.geojson`.
3. **Network Mode for CDNs**:
   - If the runtime browser environment has external internet access, Three.js and OrbitControls load instantly via CDN. If fully offline, vendoring Three.js locally in the project repository ensures 100% offline self-containment.

---

## 4. Conclusion

1. **Current State**: The repository is in an intact, operational hybrid state:
   - Full Python GIS & WebSocket server stack is verified, with all 40 pytest tests passing in 1.82s.
   - Clean GeoJSON datasets for roads (19 corridors), hospitals (5 hubs), and traffic signals (15 junctions) exist in `Data/GeoJSON/` and `preview_data.js`.
   - A 2D Leaflet web preview exists in `preview.html`.
   - No 3D Three.js application has been constructed yet.
2. **Recommended Web Architecture**:
   - Construct a zero-build, high-performance Three.js application (`index.html`, `js/app.js`, `css/styles.css`):
     - **3D Geospatial Scene**: Bengaluru local Cartesian coordinate frame centered at `12.97237° N, 77.58703° E, 920.0m MSL`.
     - **Road & Building Extrusion**: Procedural multi-lane roads with lane markings and curbs; 3D extruded building masses with window/facade shaders and landmark footprints.
     - **Civilian Vehicle Swarm AI**: 200+ vehicles rendered via `THREE.InstancedMesh` with 60 FPS update loop, red-light halting, and Parting Wave outward yielding.
     - **Ambulance Kinematics & Controls**: Dual-mode (autonomous WebSocket client + keyboard WASD manual driving), chase/cockpit/orbit cameras, Web Audio siren synthesizer, flashing LED emergency beacons.
     - **Traffic Signal Actuators**: 15 3D junction signal posts with dynamic preemption transitions.
     - **Atmosphere & Weather**: Day/night sun position lighting and toggleable rain particle simulation with wet-surface reflections.
     - **Impact Dashboard**: Real-time HUD showing Baseline vs AI Green Corridor travel times, minutes saved, average speed improvement, and junction halt reductions.
3. **Execution Mode**:
   - Served effortlessly via `python -m http.server 8000` with WebSocket telemetry on `ws://127.0.0.1:8765`.
   - Includes standalone autonomous internal simulation fallback when WebSocket is inactive.

---

## 5. Verification Method

To verify these observations and conclusions independently:

1. **Verify Python Environment & Test Suite**:
   ```powershell
   cd c:\Users\tamil\Downloads\traffic-clearance-system
   pytest Scripts/ -v
   ```
   *Expected outcome*: 40 passed in < 3 seconds.

2. **Verify Telemetry WebSocket Server**:
   ```powershell
   python Scripts/telemetry_server.py
   # In a separate terminal:
   python Scripts/monitor_stream.py
   ```
   *Expected outcome*: Stream of 10Hz kinematics (`AMB-108-01` through `AMB-108-05`) and 2Hz decoupled state frames.

3. **Verify Existing 2D Preview**:
   ```powershell
   python -m http.server 8000
   ```
   Open `http://localhost:8000/preview.html` in any browser to observe the 2D Leaflet baseline.
