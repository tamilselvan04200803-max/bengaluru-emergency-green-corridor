# Original User Request

## Initial Request — 2026-10-14T09:47:05Z

Build a high-fidelity, interactive Web-Based 3D (Three.js) Digital Twin application of Bengaluru's Emergency Green Corridor traffic clearance system, featuring real-time 3D OSM building and road extrusion, keyboard and autonomous ambulance navigation, chaotic civilian vehicle AI with raycast-based parting wave yielding, dynamic pre-emptive traffic clearing thresholds, weather/lighting simulation, and quantitative benchmark comparisons demonstrating travel-time savings.

Working directory: c:\Users\tamil\Downloads\traffic-clearance-system
Integrity mode: demo

## Requirements

### R1. 3D Web Environment & Bengaluru Geospatial Reconstruction
- Render a continuous 3D web application using Three.js / WebGL.
- Generate realistic 3D building masses extruded directly from Bengaluru OSM GeoJSON footprints (bengaluru_roads.geojson, surrounding polygons) with custom facade materials and realistic heights.
- Render multi-lane road networks with lane markings, curbs, intersections, and 3D signal posts.
- Include a dynamic atmosphere controller supporting day/night transitions and toggleable rain/wet-asphalt shader effects.

### R2. Dual-Mode Ambulance Control & Kinematics
- Autonomous Mode: Ingest real-time 10Hz kinematics and route telemetry from the local WebSocket server (ws://127.0.0.1:8765), moving the 3D ambulance along the georeferenced network with authentic pitch/roll and blinking emergency beacon lights.
- Manual Driving Mode: Allow the user to drive the ambulance in 3D using keyboard controls (WASD / Arrow Keys) with chase camera, first-person cockpit, and top-down aerial view toggle.
- Emergency siren audio and visual strobes with interactive toggle.

### R3. Realistic Chaotic Bengaluru Traffic & Pre-emptive Clearance AI
- Populate the road grid with dynamic civilian traffic (cars, auto-rickshaws, buses, two-wheelers).
- Implement a forward raycast/cone sensor on the ambulance: when siren/priority is active, civilian vehicles within the clearance threshold detect the incoming ambulance and pull over to the road shoulder (Parting Wave yield).
- Implement early junction pre-emption: calculate traffic clearance horizon ahead of arrival so intersection queues clear before the ambulance reaches the conflict point.

### R4. Comparative Benchmark & Impact Analytics Dashboard
- Provide an integrated heads-up display (HUD) comparing:
  - Baseline Travel Time (standard uncoordinated traffic and cycling red lights).
  - AI Green Corridor Travel Time (dynamic A* rerouting + multi-junction green wave).
  - Metrics displaying exact minutes saved, average response speed improvement, and intersection halt count reduction.

## Acceptance Criteria

### Visual & Interactive Fidelity
- [ ] 3D application runs smoothly in browser at 60 FPS without external build steps or complex native installations.
- [ ] 3D buildings and road geometry accurately align with Bengaluru coordinates (Majestic / Victoria / KR Market corridor).
- [ ] Keyboard controls permit smooth driving and manual camera switching (Chase / Free / Orbit).
- [ ] Rain weather particle system and day/night lighting controls function smoothly.

### Behavioral AI & Yield Verification
- [ ] Raycast sensor reliably causes civilian vehicles in front of the ambulance to steer outward to the lane boundary, leaving a clear center path.
- [ ] Traffic signals switch to green in advance based on the arrival threshold and restore to normal cycle after passage.

### Quantitative Validation
- [ ] Live benchmark comparison board calculates and displays travel time saved with Green Wave vs. Baseline uncoordinated traffic.
- [ ] The simulation proves measurable reduction in emergency transit duration.

## Follow-up — 2026-10-14T14:16:27Z

Server restarted. Please resume orchestrating the 3D application milestones. Milestone 1 is implemented and verified (61/61 test cases passing). Please proceed with Milestone 2 (Dual-Mode Ambulance Kinematics, Web Audio Siren, WASD controls), Milestone 3 (Civilian Swarm AI & Parting Wave), and Milestone 4 (Comparative Benchmark HUD).

## Follow-up — 2026-10-14T14:44:17Z

USER DIRECTIVE FOR MILESTONE 4 (Comparative Impact Analytics HUD):
When implementing Milestone 4 (Worker M4), you MUST include:
1. A live "AI Green Corridor: ON vs. OFF (Baseline)" toggle button directly on the HUD so presenters can demonstrate in real time what happens when an ambulance drives through Bengaluru traffic WITHOUT signal preemption and WITHOUT parting wave yielding (ambulance getting stuck behind BMTC buses, queued civilian vehicles, and cycling red lights) vs. WITH the AI Green Corridor active.
2. Live side-by-side comparative metrics on the HUD displaying:
   - Baseline ETA vs. AI Green Wave ETA
   - Red-Light Halts Avoided counter
   - Total Minutes Saved counter
   - Golden Hour Survival Odds Preserved metric (calculated at +8% per minute saved)

Ensure this is reflected in Milestone 4 design, tests, and HUD UI elements.
