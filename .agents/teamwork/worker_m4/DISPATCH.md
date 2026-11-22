## 2026-10-14T14:50:25Z
## Milestone 4 Implementation Dispatch: Worker M4 (Comparative Benchmark & Impact Analytics HUD)
- Working directory: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m4
- Original User Request: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\ORIGINAL_REQUEST.md
- Scope Document: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\orchestrator_1\PROJECT.md
- Reference Specifications:
  - User Directive: Live "AI Green Corridor: ON vs. OFF (Baseline)" toggle, side-by-side Baseline vs AI ETA, Red-Light Halts Avoided, Total Minutes Saved, Golden Hour Survival Odds Preserved (+8% per minute saved).
  - c:\Users\tamil\Downloads\traffic-clearance-system\TEST_READY.md and `tests/test_suite.js` (Tests T1.4.1-T1.4.5, T2.4.1-T2.4.5, T4.1-T4.5).
  - Existing modules: `js/config.js`, `js/projection.js`, `js/signals.js`, `js/ambulance.js`, `js/traffic.js`, `js/app.js`.

### File Ownership:
Worker M4 exclusively authors and updates:
- `c:\Users\tamil\Downloads\traffic-clearance-system\js\benchmark.js` (NEW)
- `c:\Users\tamil\Downloads\traffic-clearance-system\js\ui.js` (NEW)
- Modifies `c:\Users\tamil\Downloads\traffic-clearance-system\index.html` (adds scripts `js/benchmark.js`, `js/ui.js`, HUD comparison cards, AI toggle button)
- Modifies `c:\Users\tamil\Downloads\traffic-clearance-system\css\styles.css` (styles for comparative HUD, split gauges, AI toggle switch, golden hour odds)
- Modifies `c:\Users\tamil\Downloads\traffic-clearance-system\js\app.js` (wires BenchmarkEngine, HUDManager, and AI Green Corridor ON/OFF dynamic toggle)

### Key Functional Requirements:
1. **Parallel Benchmark Simulation Engine (`js/benchmark.js`)**:
   - Implements `BenchmarkEngine`:
     - Tracks real-time distance along corridor route.
     - **Baseline Model**: Simulates uncoordinated traffic conditions with stochastic red light delays (35s-50s per red signal), congestion drag ($12\text{--}18\text{ km/h}$ average speed), and accumulating intersection halts ($4\text{--}6$ stops per route).
     - **AI Green Corridor Model**: Dynamic preemption with zero signal stops and unhindered transit speeds ($45\text{--}60\text{ km/h}$).
     - Calculates live metrics:
       - `baselineTimeSec` & `aiCorridorTimeSec`
       - `baselineEtaStr` & `aiEtaStr` (MM:SS)
       - `minutesSaved` ($= (T_{\text{base}} - T_{\text{ai}}) / 60$)
       - `percentTimeSaved` ($= (T_{\text{base}} - T_{\text{ai}}) / T_{\text{base}} \times 100$)
       - `speedImprovementPercent` ($= (V_{\text{ai}} - V_{\text{base}}) / V_{\text{base}} \times 100$)
       - `baselineHalts` vs `aiHalts` (0 halts)
       - `haltsAvoided` ($= \text{baselineHalts} - \text{aiHalts}$)
       - `goldenHourOddsPreserved` ($= \min(99.0, \max(0.0, \text{minutesSaved} \times 8.0))$ — +8% survival odds preserved per minute saved).
     - Guard against division-by-zero, negative values, and route resets (satisfying Tests T2.4.1-T2.4.5).
     - Structured JSON export capability (`exportBenchmarkData()`) for post-run analysis.

2. **Interactive Command HUD Dashboard (`js/ui.js` & `css/styles.css`)**:
   - Glassmorphism dark-theme command deck and top telemetry ribbon.
   - **Interactive "AI Green Corridor: ON vs. OFF" Toggle Button**:
     - When toggled **ON**: Preemption and parting wave yield are ACTIVE. Ambulance travels uninhibited; signals turn green; civilian vehicles yield to shoulder; HUD shows green corridor status.
     - When toggled **OFF (Baseline)**: Preemption and parting wave yield are DISABLED. Signals cycle normally (ambulance encounters red lights); civilian vehicles DO NOT yield (ambulance encounters traffic blockages); HUD shows baseline demonstration mode.
   - Side-by-side comparison cards:
     - Left card: Baseline (Red-themed, cycling delays, halt counter, uncoordinated ETA).
     - Right card: AI Green Corridor (Green-themed, 0 halts, preemption active, accelerated ETA).
     - Center display: Total Minutes Saved gauge and Golden Hour Survival Odds Preserved metric.
   - Live speedometer, gear/speed indicator, mode status badge (`AUTONOMOUS` vs `MANUAL DRIVE`), weather badge (`CLEAR` vs `RAIN`), and telemetry connection status indicator.

3. **Application Integration (`index.html` & `js/app.js`)**:
   - Ensure zero-build native browser execution.
   - Wire all keyboard shortcuts (`M, S, R, N, 1, 2, 3, 4`, and `G` or HUD button for Green Corridor toggle).
   - Ensure 60 FPS performance without memory leaks.

4. **Testing & Verification**:
   - Execute `node tests/test_runner_cli.js` (all 61 tests must pass).
   - Author dedicated unit tests in `tests/test_milestone4.js` validating benchmark calculations, golden hour formula, and toggle effects.
   - Write handoff report to `c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m4\handoff.md`.
