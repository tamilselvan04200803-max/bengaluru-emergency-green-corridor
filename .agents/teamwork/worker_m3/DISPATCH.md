## Milestone 3 Implementation Dispatch: Worker M3 (Bengaluru Traffic Swarm & Pre-emptive Clearance AI)
- Working directory: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m3
- Original User Request: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\ORIGINAL_REQUEST.md
- Scope Document: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\orchestrator_1\PROJECT.md
- Reference Specifications:
  - c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\explorer_survey_3\handoff.md (Sections 1.3 & 4.2 for Parting Wave thresholds: 80m trigger, 25m clear, 1.2m-1.8m shoulder offset, and ISM batch rendering)
  - c:\Users\tamil\Downloads\traffic-clearance-system\TEST_READY.md and `tests/test_suite.js` (Tests T1.3.1-T1.3.7, T2.3.1-T2.3.5, T3.1-T3.5, T3.8)
  - c:\Users\tamil\Downloads\traffic-clearance-system\js\config.js (Road and vehicle parameters)
  - c:\Users\tamil\Downloads\traffic-clearance-system\js\signals.js (Signal states and preemption manager)
  - c:\Users\tamil\Downloads\traffic-clearance-system\js\ambulance.js (`getClearanceCone()` interface)

### File Ownership:
Worker M3 exclusively owns and authors:
- `c:\Users\tamil\Downloads\traffic-clearance-system\js\traffic.js`
- Modifies `c:\Users\tamil\Downloads\traffic-clearance-system\index.html` (adds `<script src="js/traffic.js"></script>`)
- Modifies `c:\Users\tamil\Downloads\traffic-clearance-system\js\app.js` (wires `TrafficManager` into the scene and animation loop)

### Key Functional Requirements:
1. **Civilian Vehicle Heterogeneity (`js/traffic.js`)**:
   - 4 distinct Bengaluru vehicle classes:
     - **Auto-Rickshaws**: Iconic yellow/green 3-wheelers (compact, nimble).
     - **BMTC Transit Buses**: Large blue/white city buses (slow, heavy footprint).
     - **Two-Wheelers**: Scooters and motorcycles (lane-filtering, quick acceleration).
     - **Passenger Cars**: Sedans/hatchbacks/cabs (standard dimensions).
   - Each class has custom dimensions, speeds, and colors.

2. **High-Performance Swarm Rendering (60 FPS)**:
   - Use `THREE.InstancedMesh` for each vehicle archetype (or merged archetype geometries) to render 80–150+ civilian vehicles across the road network in $<5$ draw calls.
   - Vehicles travel along road splines/waypoints with realistic following distances and red-light stopping behavior.

3. **Parting Wave Clearance AI**:
   - Ingests `ambulance.getClearanceCone()` (range $80.0\text{m}$, FOV $0.7\text{ rad}$, priority active).
   - When siren/priority is active, vehicles inside the cone detect the approaching ambulance and steer outward toward the road shoulder/curb ($\pm 1.8\text{m}$ lateral offset lerp) and decelerate, opening a clear center path.
   - When the ambulance passes ($>25.0\text{m}$ behind vehicle), vehicles smoothly restore their lateral offset to $0.0\text{m}$ (center of lane).
   - If siren is OFF, vehicles do NOT yield (acoustic gating).

4. **Early Junction Preemption & Queue Flushing**:
   - Coordinates with `SignalManager.updatePreemption()` using the clearance horizon $d = \min(300.0, v \times 25.0)$.
   - Queued civilian vehicles at approaching junctions detect green signal preemption and accelerate out of the intersection before the ambulance reaches the conflict point.

5. **Testing & Verification**:
   - Execute `node tests/test_runner_cli.js` (all 61 tests must pass).
   - Write a dedicated verification script `tests/test_milestone3.js` verifying traffic classes, cone detection, parting wave yielding, restoration, and queue flushing.
   - Write handoff report to: `c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m3\handoff.md`.


## 2026-10-14T14:33:14Z
Task dispatch received: Implement js/traffic.js, update index.html, update js/app.js, tests/test_milestone3.js, run node tests/test_runner_cli.js, author handoff.md, send_message to parent b8f029d8-2be3-4c83-8446-e9fc38428980.
