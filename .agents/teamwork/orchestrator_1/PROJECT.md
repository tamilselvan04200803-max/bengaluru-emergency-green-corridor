# Project: Bengaluru Emergency Green Corridor 3D Digital Twin

## Architecture
The application is a browser-native, zero-build 3D WebGL / Three.js Digital Twin of Bengaluru's central emergency corridor (Majestic - K.R. Circle - Corporation - K.R. Market - Victoria Hospital - Bowring Hospital - MG Road).

### System Topology
```
[Python Telemetry Server] (ws://127.0.0.1:8765)
     │ (10Hz Kinematics + 2Hz State Frames)
     ▼
[WebSocket Client Subsystem / Offline Fallback Engine]
     │
     ├──> [Ambulance Kinematics & Dual-Mode Controller]
     │         ├── Autonomous Waypoint Following & Dead Reckoning
     │         ├── Manual WASD Vehicle Dynamics & Camera Modes (Chase/Cockpit/Aerial)
     │         ├── Web Audio Siren Synthesizer & Emissive Strobes
     │         └── Forward Cone/Raycast Clearance Sensor (60-80m)
     │
     ├──> [Bengaluru Geospatial 3D Environment]
     │         ├── ENU Coordinate Projection (Lat: 12.9715987°, Lon: 77.5945627°, Alt: 920.0m)
     │         ├── Procedural 3D Multi-Lane Roads (2/4/6 lanes, markings, curbs, sidewalks)
     │         ├── Extruded 3D Building Masses with Procedural Facade Materials
     │         ├── 15 Signalized Intersections (ITMS_BENGALURU_V2) & 3D Signal Posts
     │         └── Dynamic Atmosphere (Day/Dusk/Night Cycle + Rain Particles / Wet Asphalt)
     │
     ├──> [Civilian Swarm AI Engine]
     │         ├── THREE.InstancedMesh Batch Rendering (60 FPS with 100+ vehicles)
     │         ├── Heterogeneous Bengaluru Vehicles (Autos, BMTC Buses, 2-Wheelers, Cars)
     │         ├── Parting Wave Outward Yielding (Lateral Lerp to Road Shoulder)
     │         └── Early Junction Preemption & Queue Flushing
     │
     └──> [Impact Analytics & HUD Dashboard]
               ├── Parallel Real-Time Simulation (Baseline vs AI Green Corridor)
               ├── Quantitative Gauges: Minutes Saved, % Speed Improvement, Halts Reduced
               └── Interactive Control Deck (Modes, Cameras, Siren, Atmosphere)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Browser-Native Three.js Framework | Zero-build HTML5/WebGL application running at 60 FPS | M1 | ORIGINAL_REQUEST § R1, AC1 |
| 2 | Geospatial Coordinate Transformation | Precise ENU Cartesian projection centered on K.R. Circle origin | M1 | ORIGINAL_REQUEST § R1 |
| 3 | Procedural 3D Multi-Lane Road Network | 19 corridor roads extruded with 2/4/6 lanes, lane stripes, curbs, sidewalks | M1 | ORIGINAL_REQUEST § R1 |
| 4 | 3D Building Mass Extrusion | Extruded urban building polygons & corridor landmarks with facade materials | M1 | ORIGINAL_REQUEST § R1 |
| 5 | 3D Traffic Signal Posts | 15 signalized posts at ITMS junctions with 3-state emissive indicators | M1 | ORIGINAL_REQUEST § R1 |
| 6 | Atmosphere & Lighting Controller | Dynamic day/dusk/night cycle with directional sun & ambient lighting | M1 | ORIGINAL_REQUEST § R1, AC1 |
| 7 | Weather Simulation & Wet Asphalt | Toggleable rain particle system with wet-asphalt shader reflections | M1 | ORIGINAL_REQUEST § R1, AC1 |
| 8 | 3D Ambulance Model & Kinematics | Detailed emergency vehicle model with authentic suspension pitch & roll | M2 | ORIGINAL_REQUEST § R2 |
| 9 | Autonomous WebSocket Telemetry Ingestion | Ingest 10Hz kinematics and route state from ws://127.0.0.1:8765 | M2 | ORIGINAL_REQUEST § R2 |
| 10 | Autonomous Standalone Fallback | Client-side autonomous navigation loop when WebSocket is inactive | M2 | Survey findings (Explorer 1, 3) |
| 11 | Manual WASD Driving Physics | Responsive keyboard driving physics (acceleration, steering, braking, reverse) | M2 | ORIGINAL_REQUEST § R2, AC1 |
| 12 | Multi-Mode Camera Controller | Chase cam (3rd person), Cockpit cam (1st person), Aerial cam (top-down) | M2 | ORIGINAL_REQUEST § R2, AC1 |
| 13 | Web Audio Siren Synthesizer | Procedural dual-tone emergency siren (wail/yelp) via Web Audio API | M2 | ORIGINAL_REQUEST § R2 |
| 14 | Emergency Beacon Strobe Lighting | Flashing red/blue visual strobes with synchronized 3D point lights | M2 | ORIGINAL_REQUEST § R2 |
| 15 | High-Performance Swarm Rendering | InstancedMesh rendering for 100+ vehicles maintaining 60 FPS | M3 | ORIGINAL_REQUEST § R3, AC1 |
| 16 | Heterogeneous Bengaluru Traffic Classes | Autos (3-wheelers), BMTC Buses, Two-Wheelers, Passenger Cars | M3 | ORIGINAL_REQUEST § R3 |
| 17 | Forward Raycast/Cone Clearance Sensor | 60-80m forward cone detecting civilian vehicles along active path | M3 | ORIGINAL_REQUEST § R3, AC2 |
| 18 | Parting Wave Lateral Yielding | Civilian vehicles dynamically steer outward to road shoulder/curb | M3 | ORIGINAL_REQUEST § R3, AC2 |
| 19 | Early Junction Preemption & Horizon Math | Traffic clearance horizon min(300m, v * 25s) triggering advance green wave | M3 | ORIGINAL_REQUEST § R3, AC2 |
| 20 | Junction Queue Flushing | Queued civilian vehicles flush intersection before ambulance arrival | M3 | ORIGINAL_REQUEST § R3, AC2 |
| 21 | Parallel Baseline vs AI Simulation Model | Real-time uncoordinated vs green corridor travel time calculation | M4 | ORIGINAL_REQUEST § R4, AC3 |
| 22 | Quantitative Metrics Engine | Exact minutes saved, average speed boost %, intersection halt count reduction | M4 | ORIGINAL_REQUEST § R4, AC3 |
| 23 | Interactive Command HUD Dashboard | Sci-fi command center HUD with speedometers, split gauges, mode/weather controls | M4 | ORIGINAL_REQUEST § R4 |
| 24 | E2E Test Suite & Test Runner | 4-Tier test suite (55+ automated tests) validating all requirements | M5 (Test Track) | Project Dual Track |
| 25 | Adversarial Coverage Hardening | White-box stress testing and edge-case verification | M5 | Project Dual Track Phase 2 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | 3D Geospatial Engine & Environment | Three.js framework, ENU projection, procedural 3D roads, building masses, 3D signal posts, atmosphere, rain/wet-asphalt shaders | none | DONE |
| M2 | Dual-Mode Ambulance Kinematics & Control | 3D ambulance, 10Hz WS client + offline fallback, WASD physics, 3 camera modes, Web Audio siren, LED strobes | M1 | DONE |
| M3 | Bengaluru Traffic Swarm & Pre-emptive Clearance AI | InstancedMesh civilian swarm (4 classes), cone sensor, parting wave shoulder yield, early signal preemption & queue flushing | M1, M2 | DONE |
| M4 | Comparative Benchmark & Impact Analytics HUD | Parallel baseline vs AI travel times, minutes saved, speed improvement, halt reduction counter, interactive HUD controls | M1, M2, M3 | DONE |
| M5 | System Integration, 100% E2E Test Pass & Hardening | Pass 100% E2E test suite (Tiers 1-4) published by Test Track, followed by Phase 2 adversarial coverage hardening | M1, M2, M3, M4, TEST_READY.md | IN_PROGRESS |

## Interface Contracts

### 1. Geospatial Transformer ↔ Scene & Vehicles
- `GeoProjection.latLonAltToCartesian(lat, lon, alt)` -> `{ x: float, y: float, z: float }`
- Reference Origin: `Lat: 12.9715987, Lon: 77.5945627, Alt: 920.0`
- Units: Meters (1 Three.js unit = 1 meter). $X$: East, $Z$: -North, $Y$: Elevation.

### 2. Telemetry Ingestion / Fallback Engine ↔ Ambulance Controller
- Ingested Telemetry Payload:
  ```json
  {
    "vehicle_id": "string",
    "latitude": "float",
    "longitude": "float",
    "altitude": "float",
    "speed_kmh": "float",
    "heading": "float",
    "priority_active": "boolean",
    "preempt_junction_osm_id": "string",
    "green_wave_junction_ids": ["string"],
    "active_route_osm_ids": ["string"],
    "patient_criticality_tier": "int"
  }
  ```
- Method: `AmbulanceController.setAutonomousTelemetry(data)`
- Fallback Method: `AmbulanceController.updateInternalSimulation(deltaSeconds)`

### 3. Ambulance Raycast/Cone Sensor ↔ Civilian Swarm AI
- `AmbulanceController.getClearanceCone()` -> `{ position: THREE.Vector3, forward: THREE.Vector3, range: 80.0, fovAngleRad: 0.7 }`
- `TrafficSwarmManager.update(deltaSeconds, ambulanceCone, signalStates)`
- Yield behavior: vehicles inside cone lerp `lateralOffset` toward `+1.8m` or `-1.8m` (road shoulder), restoring to `0.0m` when ambulance passes.

### 4. Ambulance Position ↔ Traffic Signal Preemption Manager
- `SignalManager.updatePreemption(ambulancePosition, ambulanceSpeedKmh, activeRouteJunctions)`
- Clearance horizon: $d = \min(300.0, v_{mps} \times 25.0)$
- Signal transition: approaching signals switch to `PriorityOverride (Green)`, cross traffic to `Red`. On passage ($> 30\text{m}$ past junction), transition through `Amber (3s)` back to regular cycle.

### 5. Benchmark Engine ↔ HUD Analytics Dashboard
- `BenchmarkEngine.getMetrics()` ->
  ```json
  {
    "baselineTimeSec": 645.2,
    "aiCorridorTimeSec": 218.4,
    "minutesSaved": 7.1,
    "percentTimeSaved": 66.1,
    "speedImprovementPercent": 195.4,
    "baselineHalts": 5,
    "aiHalts": 0,
    "currentSpeedKmh": 54.2
  }
  ```

## Code Layout
The web application is self-contained in the repository root, runnable zero-build:
```
c:\Users\tamil\Downloads\traffic-clearance-system\
├── index.html                    # 3D Digital Twin primary entry point
├── css/
│   └── styles.css                # HUD, gauges, glassmorphism UI styling
├── js/
│   ├── app.js                    # Main application loop, Three.js bootstrap, FPS counter
│   ├── config.js                 # Geo origin, vehicle parameters, corridor bounding box
│   ├── projection.js             # WGS84 to Three.js Cartesian coordinate projection
│   ├── environment.js            # Roads, curbs, extruded buildings, signal meshes
│   ├── atmosphere.js             # Sun lighting, day/night cycle, rain particles & wet shader
│   ├── ambulance.js              # 3D ambulance model, WASD physics, 10Hz WS / fallback, siren, strobes
│   ├── camera.js                 # Chase, cockpit, aerial camera modes
│   ├── audio.js                  # Web Audio API procedural dual-tone siren synthesizer
│   ├── traffic.js                # InstancedMesh civilian traffic swarm (4 classes), parting wave AI
│   ├── signals.js                # 15 ITMS signal controllers, clearance horizon & preemption
│   ├── benchmark.js              # Parallel baseline vs AI travel time & savings analytics
│   └── ui.js                     # HUD dashboard, speedometers, toggle controls, status monitors
├── tests/
│   ├── e2e_test_runner.html      # Browser-based automated test harness
│   └── test_suite.js             # Tiers 1-4 automated assertions (55+ test cases)
└── Data/GeoJSON/                 # Verified geospatial data
```
