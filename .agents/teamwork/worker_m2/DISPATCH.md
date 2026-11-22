## Milestone 2 Implementation Dispatch: Worker M2 (Dual-Mode Ambulance Kinematics & Control)
- Working directory: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m2
- Original User Request: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\ORIGINAL_REQUEST.md
- Scope Document: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\orchestrator_1\PROJECT.md
- Reference Specifications:
  - c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\explorer_survey_3\handoff.md (Sections 1.1, 1.2, 4.1 for Telemetry Schema, Kinematics, Pitch/Roll, and Fallback)
  - c:\Users\tamil\Downloads\traffic-clearance-system\TEST_READY.md and c:\Users\tamil\Downloads\traffic-clearance-system\tests\test_suite.js (Tests T1.2.1-T1.2.6, T2.2.1-T2.2.6, T3.1-T3.7, T4.1-T4.4)
  - c:\Users\tamil\Downloads\traffic-clearance-system\js\config.js (AMBULANCE and TELEMETRY parameters)
  - c:\Users\tamil\Downloads\traffic-clearance-system\js\projection.js (GeoProjection coordinate transformer)

### File Ownership:
Worker M2 is responsible for authoring and integrating:
- `c:\Users\tamil\Downloads\traffic-clearance-system\js\ambulance.js`
- `c:\Users\tamil\Downloads\traffic-clearance-system\js\camera.js`
- `c:\Users\tamil\Downloads\traffic-clearance-system\js\audio.js`
- Updating `c:\Users\tamil\Downloads\traffic-clearance-system\index.html` (script references for camera.js, audio.js, ambulance.js)
- Updating `c:\Users\tamil\Downloads\traffic-clearance-system\js\app.js` (wiring ambulance controller, camera modes, audio toggle, and telemetry HUD into the game loop)

### Key Functional Requirements:
1. **3D Ambulance Model & Kinematics (`js/ambulance.js`)**:
   - Detailed procedural 3D ambulance mesh (white chassis, red emergency cross decals, front cab, rear box, wheels, front/rear bumpers, side mirrors, and roof lightbar).
   - Authentic pitch tilt (nose dips on braking/deceleration, rises on acceleration) and centripetal roll tilt (leans into turns based on angular velocity and lateral acceleration, clamped to $[-\pi/8, \pi/8]$).
   - Dual-mode operation:
     - **Autonomous Mode**: Ingests real-time 10Hz kinematics from WebSocket `ws://127.0.0.1:8765`. If WebSocket disconnects or is unavailable, smoothly falls back to client-side autonomous navigation along the georeferenced road network with dead-reckoning.
     - **Manual WASD Mode**: Full vehicle physics with responsive keyboard driving (KeyW/ArrowUp = accelerate, KeyS/ArrowDown = brake/reverse, KeyA/ArrowLeft = steer left up to $35^\circ$, KeyD/ArrowRight = steer right, Space = handbrake). Enforces braking priority when W+S are pressed simultaneously. Speed strictly governed to $100\text{ km/h}$.
   - Emergency Beacon Strobes: Alternating red (`#ff0033`) and blue (`#0066ff`) flashing LED strobes on roof lightbar with synchronized 3D point lights.
   - Forward Clearance Cone: Calculates forward cone sensor `getClearanceCone()` (range $80.0\text{m}$, FOV $0.7\text{ rad}$) for civilian traffic clearance.

2. **Multi-Mode Camera Controller (`js/camera.js`)**:
   - **Chase Mode** (Key 1 / Button): Dynamic third-person follow camera positioned behind and above the ambulance ($d = 14\text{m}$, $h = 4.5\text{m}$) with smooth damping and look-ahead targeting.
   - **Cockpit Mode** (Key 2 / Button): First-person hood/windshield view coupled with chassis pitch and roll.
   - **Aerial Mode** (Key 3 / Button): Top-down bird's-eye view ($h = 75\text{m}$) tracking vehicle position with north-up or heading-up orientation.
   - **Orbit Mode** (Key 4 / Button): Free orbit inspection camera via OrbitControls.

3. **Web Audio Siren Synthesizer (`js/audio.js`)**:
   - Software synthesizer using Web Audio API (`AudioContext`, dual oscillators, gain nodes, and LFO frequency sweep).
   - Simulates authentic emergency dual-tone siren ($750\text{Hz} \leftrightarrow 1150\text{Hz}$ frequency modulation, wail/yelp cycle).
   - Interactive toggle (`S` key or HUD button). Mutes cleanly when deactivated with zero popping.

4. **Integration & Verification**:
   - Connect controls to Command Deck buttons in `index.html` and keyboard shortcuts (`W, A, S, D`, `1, 2, 3, 4`, `M` for mode toggle, `E` or `H` for siren).
   - Run tests: `node tests/test_runner_cli.js` (must pass 100%) and verify Milestone 2 functionality.
   - Write handoff report to: `c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m2\handoff.md`.


## 2026-10-14T14:18:44Z
[Message] timestamp=2026-10-14T14:18:44Z sender=b8f029d8-2be3-4c83-8446-e9fc38428980 priority=MESSAGE_PRIORITY_HIGH content=You are Worker M2 (Dual-Mode Ambulance Kinematics & Control Worker).
Your working directory is: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m2
Read ORIGINAL_REQUEST.md at: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\orchestrator_1\PROJECT.md
Read your dispatch instructions at: c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m2\DISPATCH.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task:
1. Implement and integrate Milestone 2 core modules:
   - `c:\Users\tamil\Downloads\traffic-clearance-system\js\ambulance.js`: Procedural 3D ambulance mesh, authentic pitch/roll kinematics, dual-mode (10Hz WebSocket client + client-side autonomous fallback navigation), manual WASD driving physics (acceleration, braking, steering clamped to 35 deg, speed cap 100 km/h, braking priority), blinking red/blue emergency LED strobes, forward clearance cone sensor (80m, 0.7 rad FOV).
   - `c:\Users\tamil\Downloads\traffic-clearance-system\js\camera.js`: Multi-mode camera controller supporting Chase (3rd person), Cockpit (1st person hood view), Aerial (top-down), and Orbit modes.
   - `c:\Users\tamil\Downloads\traffic-clearance-system\js\audio.js`: Web Audio API procedural dual-tone emergency siren synthesizer (750Hz <-> 1150Hz wail/yelp) with interactive toggle and smooth gain transitions.
   - Update `index.html` and `js/app.js` to instantiate, wire, and render the ambulance, camera controller, audio siren, and UI controls.
2. Ensure compatibility with both browser runtime (via zero-build script tags) and Node.js test environments (via isomorphic UMD/export wrappers).
3. Run tests using command line: `node tests/test_runner_cli.js` (all 61 tests must pass) and verify ambulance kinematics, camera modes, and audio synthesis.
4. Author your detailed handoff report to: `c:\Users\tamil\Downloads\traffic-clearance-system\.agents\teamwork\worker_m2\handoff.md`.
5. Use send_message to report completion back to the orchestrator.
