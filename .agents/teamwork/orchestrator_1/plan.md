# Plan: Bengaluru Emergency Green Corridor 3D Digital Twin

## Objective
Build a high-fidelity, interactive Web-Based 3D (Three.js) Digital Twin application of Bengaluru's Emergency Green Corridor traffic clearance system, featuring real-time 3D OSM building and road extrusion, keyboard and autonomous ambulance navigation, chaotic civilian vehicle AI with raycast-based parting wave yielding, dynamic pre-emptive traffic clearing thresholds, weather/lighting simulation, and quantitative benchmark comparisons demonstrating travel-time savings.

## Phases

### Phase 0: Survey & Project Scoping
- Spawn 3 parallel Explorers to survey the project repository:
  - Explorer 1: Project structure, existing scripts, dependencies, build/run configs.
  - Explorer 2: Existing geospatial assets (`bengaluru_roads.geojson`, polygons, coordinates, Majestic / Victoria / KR Market corridor data).
  - Explorer 3: Existing simulation / backend code (WebSocket servers, traffic algorithms, telemetry, existing ports like 8765).
- Synthesize findings into `PROJECT.md` at root:
  - Architecture & Data Flow
  - Feature Inventory (all requirements mapped to milestones)
  - Milestone Breakdown (M1 to M5)
  - Interface Contracts
  - Code Layout

### Phase 1: Dual-Track Execution
- **Track 1: E2E Testing Track**
  - Spawn E2E Testing Orchestrator / Sub-orchestrator.
  - Build opaque-box test runner and test cases (Tiers 1-4: Feature coverage, Boundary/corner, Cross-feature, Real-world scenarios).
  - Produce `TEST_INFRA.md` and publish `TEST_READY.md`.
- **Track 2: Implementation Track**
  - M1: 3D Web Environment & Geospatial Reconstruction
  - M2: Dual-Mode Ambulance Control & Kinematics
  - M3: Bengaluru Traffic AI & Pre-emptive Clearance
  - M4: Benchmark HUD & Analytics Dashboard
  - M5: Final Milestone: 100% E2E test pass + Phase 2 Adversarial Coverage Hardening

### Phase 2: System Integration & Delivery
- Final audit and verification.
- Synthesize handoff report and notify Sentinel.
