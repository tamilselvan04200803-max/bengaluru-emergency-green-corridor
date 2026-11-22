# Bengaluru Emergency Green Corridor 3D Digital Twin — Test Infrastructure & Methodology

## 1. Executive Summary

This document defines the automated, opaque-box End-to-End (E2E) test infrastructure for the **Bengaluru Emergency Green Corridor 3D Digital Twin** application. The test architecture enforces strict adherence to the system requirements outlined in `ORIGINAL_REQUEST.md` and the interface contracts in `PROJECT.md`.

The test harness requires **zero external build steps** and runs natively both in the browser (via `tests/e2e_test_runner.html`) and headlessly in terminal/CI environments (via `node tests/test_runner_cli.js`).

---

## 2. 4-Tier Test Architecture

The test suite is structured into four distinct, progressive tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TIER 4: REAL-WORLD SCENARIOS                     │
│ Complete corridor runs (Majestic -> Victoria / Bowring, Rush Hour)    │
├────────────────────────────────────────────────────────────────────────┤
│                   TIER 3: CROSS-FEATURE INTERACTIONS                   │
│ Multi-system coupling (WASD + Siren + Rain + Parting Wave + Signals)   │
├────────────────────────────────────────────────────────────────────────┤
│                     TIER 2: BOUNDARY & CORNER CASES                    │
│ Extremes (0/max speed, WS drop, coordinate bounds, pitch/roll clamps)  │
├────────────────────────────────────────────────────────────────────────┤
│                       TIER 1: FEATURE COVERAGE                         │
│ Base functionality (R1 Environment, R2 Ambulance, R3 Swarm, R4 HUD)   │
└────────────────────────────────────────────────────────────────────────┘
```

### Tier 1: Feature Coverage (Base Functional Contracts)
Validates individual functional components against their core requirements:
- **R1: 3D Geospatial Reconstruction & Environment**
  - ENU projection from reference origin $(12.9715987^\circ\text{N}, 77.5945627^\circ\text{E}, 920.0\text{m})$.
  - Parsing and extrusion of 19 corridor road segments with IRC widths ($7\text{m}, 14\text{m}, 21\text{m}$).
  - Procedural 3D building mass generation with realistic heights ($12\text{m}$ to $55\text{m}$).
  - 15 ITMS signalized junctions with 3-state emissive post indicators.
  - Atmosphere controller (Day/Dusk/Night transitions) and rain/wet-asphalt shader triggers.
- **R2: Dual-Mode Ambulance Controls & Kinematics**
  - 10Hz autonomous WebSocket telemetry ingestion and coordinate translation.
  - Dynamic kinematic suspension simulation (acceleration pitch and centripetal roll).
  - Manual WASD vehicle dynamics (acceleration, braking, steering limits, reverse).
  - Multi-mode camera controller (Chase, Cockpit, Aerial views).
  - Web Audio API procedural dual-tone siren synthesizer ($750\text{ Hz} \leftrightarrow 1150\text{ Hz}$).
  - Visual emergency beacon strobes with synchronized point lights.
- **R3: Civilian Traffic Swarm & Pre-emptive Clearance AI**
  - Heterogeneous Bengaluru traffic classes (Auto-rickshaws, BMTC buses, 2-wheelers, cars).
  - Forward clearance cone sensor ($80\text{m}$ range, $0.7\text{ rad}$ field of view).
  - Parting wave lateral yielding to road shoulder ($\pm 1.8\text{m}$) when siren is active.
  - Shoulder restoration to lane center ($0.0\text{m}$) once ambulance passes ($>25\text{m}$).
  - Early junction pre-emption clearance horizon $d = \min(300.0, v_{\text{mps}} \times 25.0)$.
  - Preemption signal override to green corridor, and 3-second amber safety recovery.
- **R4: Comparative Benchmark HUD & Impact Analytics**
  - Parallel simulation of uncoordinated baseline traffic vs AI Green Corridor.
  - Quantitative metrics calculation: minutes saved, percentage reduction, speed boost %, halts reduced.
  - Live HUD dashboard DOM element structure, gauges, and update frequencies.

### Tier 2: Boundary & Corner Cases (Robustness & Resilience)
Validates extreme operational conditions and stress points:
- Coordinate projection at exact bounding box extremities (Majestic, Trinity Circle, Tipu Palace, Raj Bhavan).
- Zero and extreme elevation tolerances (sea level to high altitude).
- Sub-meter waypoint deduplication to prevent degenerate geometry ribbons.
- Stationary ($0\text{ km/h}$) ambulance state without false negatives or division-by-zero.
- Maximum speed capping ($100\text{ km/h}$) and engine governor enforcement.
- Abrupt WebSocket server disconnect with seamless offline waypoint fallback.
- Conflicting simultaneous keyboard inputs (accelerate + brake).
- Extreme angular velocities clamped to safe pitch/roll thresholds ($< \pi/6$).
- Zero civilian traffic density handling and swarm saturation ($200+$ vehicles).
- Ambulance reversed heading away from junction (preemption suppression).
- Immediate run reset and zero-elapsed time initialization without `NaN` or `Infinity`.

### Tier 3: Cross-Feature Interactions (Integration & Coupled State)
Validates synchronized interactions across multiple subsystems:
- WASD manual driving coupled with active siren, dynamically steering the clearance cone and driving parting wave yield.
- Siren inactive state: verifying civilian vehicles do not yield without acoustic/priority activation.
- Monsoon night emergency run: Night lighting + Rain particle system + Wet asphalt reflections + Dual strobe lights.
- Dynamic speed variation adjusting the preemption horizon ($125\text{m}$ at low speed to $300\text{m}$ at high speed).
- Junction queue clearance: signals turn green, queued civilian vehicles flush the junction, and vehicles within cone part outward.
- Cockpit camera view under high-speed slalom with roll camera matrix synchronization.
- Mid-transit WebSocket drop with zero visual snapping or benchmark interruption.
- Parting wave outward displacement clamped safely on narrow 2-lane roads (Avenue Road) vs 6-lane boulevards.
- Dynamic route congestion rerouting triggering benchmark ETA re-calculation.
- Dual ambulance conflict arbitration allocating priority to higher tier / lower ETA.

### Tier 4: Real-World Scenarios (End-to-End Corridor Missions)
Validates complete transit runs from origin to destination:
- **Scenario 4.1: Majestic Station to Victoria Hospital Emergency Trauma**
  - Route: Majestic $\to$ Seshadri Road $\to$ K.R. Circle $\to$ Nrupathunga Road $\to$ Corporation Circle $\to$ N.R. Road $\to$ K.R. Market $\to$ Victoria Hospital.
  - Transit length $\approx 3.8\text{ km}$ across 6 signalized junctions.
  - Quantitative assertion: $>65\%$ transit time saved, 0 halts vs 5 baseline halts.
- **Scenario 4.2: Majestic Station to Bowring & Lady Curzon Hospital**
  - Route: Majestic $\to$ Seshadri Road $\to$ K.R. Circle $\to$ Dr. B.R. Ambedkar Veedhi $\to$ Raj Bhavan $\to$ Central Street $\to$ Bowring Hospital.
  - Transit length $\approx 4.2\text{ km}$ across 5 signalized junctions.
  - Quantitative assertion: Travel time reduced from $\approx 16\text{ min}$ to $\le 5.2\text{ min}$.
- **Scenario 4.3: Peak Morning Rush-Hour Congestion Navigation (09:00 AM)**
  - Baseline congestion multiplier $0.8$, baseline speed throttled to $11\text{ km/h}$.
  - AI corridor activates early $300\text{m}$ horizon, flushing queues with $>+200\%$ speed boost.
- **Scenario 4.4: Monsoon Night Emergency Transit Run**
  - Night atmosphere + Monsoon rain + wet asphalt reflections.
  - Full corridor transit with verified sensor detection and safe shoulder yielding.
- **Scenario 4.5: Cumulative Benchmark Analytics & Telemetry Export**
  - Multi-run transit recording aggregate savings ($>20\text{ min}$ saved) and structured JSON telemetry export.

---

## 3. Authoritative Sources of Expected Output

Every test case in this suite derives its expected outputs directly from authoritative sources:

| Feature Area | Authoritative Source | Mathematical Derivation |
|--------------|----------------------|-------------------------|
| Geospatial ENU Projection | `Config/DefaultEngine.ini`, EPSG:4326 | $X = \Delta Lon \cdot \frac{\pi}{180} R \cos(Lat_0)$, $Z = -\Delta Lat \cdot \frac{\pi}{180} R$, $Y = Alt - 920.0$ ($R=6378137\text{m}$) |
| Road Geometry & Lanes | `Data/GeoJSON/bengaluru_roads.geojson` | 19 features, IRC widths: 2-lane ($7\text{m}$), 4-lane ($14\text{m}$), 6-lane ($21\text{m}$) |
| Signal Intersections | `Data/GeoJSON/bengaluru_traffic_signals.geojson` | 15 ITMS junctions, actuation lead times (20–45s), cycle times (70–150s) |
| Hospitals & Emergency Gates | `Data/GeoJSON/bengaluru_hospitals.geojson` | 5 facilities (Victoria, Bowring, St. Martha's, Mallya, Vani Vilas) |
| Clearance Horizon | `Scripts/telemetry_server.py:761–806` | $d = \min(300.0, \max(5.0, v_{\text{mps}}) \times 25.0)$ |
| Parting Wave Yield | `Source/.../TrafficSwarmManager.cpp`, `PROJECT.md` | Range $80\text{m}$, FOV $0.7\text{ rad}$, lateral shift $\pm 1.8\text{m}$, clearance threshold $25\text{m}$ |
| Preemption & Amber Phase | `Source/.../TrafficJunctionActor.cpp`, `PROJECT.md` | Force green on approach, 3.0s amber safety phase on clearance ($>30\text{m}$) |
| Benchmark Analytics | `PROJECT.md § Interface Contracts` | $\text{minSaved} = \frac{T_{\text{base}} - T_{\text{ai}}}{60}$, $\%_{\text{saved}} = \frac{T_{\text{base}} - T_{\text{ai}}}{T_{\text{base}}} \times 100$, $\%_{\text{speed}} = \frac{v_{\text{ai}} - v_{\text{base}}}{v_{\text{base}}} \times 100$ |

---

## 4. Test Execution Instructions

### A. Browser-Based Execution (Visual Runner)
1. Open `tests/e2e_test_runner.html` directly in any modern Web browser (Chrome, Edge, Firefox, Safari):
   ```powershell
   # Windows PowerShell
   Start-Process chrome.exe "c:\Users\tamil\Downloads\traffic-clearance-system\tests\e2e_test_runner.html"
   ```
2. The runner will automatically execute all 61 test cases across Tiers 1–4.
3. Review pass/fail counts, execution time per test, interactive tier filters, and detailed failure diagnostics.
4. Click **"Export JSON Report"** to download the complete test run artifacts.

### B. Command-Line Execution (Headless CI Runner)
1. Run the headless Node.js test runner directly from the repository root:
   ```powershell
   node tests/test_runner_cli.js
   ```
2. The runner outputs formatted test logs with execution times and a summary table:
   ```
   ================================================================================
   BENGALURU EMERGENCY GREEN CORRIDOR 3D DIGITAL TWIN — E2E TEST RUNNER
   ================================================================================
   [TIER 1] 25 Tests Passed
   [TIER 2] 21 Tests Passed
   [TIER 3] 10 Tests Passed
   [TIER 4]  5 Tests Passed
   --------------------------------------------------------------------------------
   TOTAL: 61/61 PASSED (100%) | DURATION: ~35ms | STATUS: READY
   ================================================================================
   ```
3. Exits with code `0` on success, or code `1` if any test fails.

---

## 5. Test Suite File Index

- `TEST_INFRA.md` (this file): Test architecture, tier definitions, and derivation sources.
- `tests/test_suite.js`: Complete 61 test case definitions, assertion library, and contract oracles.
- `tests/e2e_test_runner.html`: Zero-build browser test harness with glassmorphism UI and diagnostics.
- `tests/test_runner_cli.js`: Headless Node.js command-line runner for continuous integration.
- `TEST_READY.md`: Formal test readiness declaration with requirement-to-test traceability matrix.
