# Verified Engineering Solutions

## Stage 6: MapLibre GL JS + Three.js 3D Digital Twin Integration

### 1. MapLibre GL JS 4.x CDN & OpenFreeMap Liberty Style URLs
- **Symptom:** Initial Stage 6 draft returned HTTP 404 for `https://tiles.openfreemap.org/styles/liberty/js/lib.js` and `.../vector.json`, and passed a `<canvas>` element as MapLibre's `container`.
- **Root Cause:** OpenFreeMap hosts the style JSON at `https://tiles.openfreemap.org/styles/liberty` (not `/vector.json`) and does not serve MapLibre JS/CSS bundles; MapLibre requires a `<div>` container (`#map-container`).
- **Fix:** Load MapLibre GL JS `4.7.1` CSS/JS from `unpkg.com`, use `<div id="map-container">` in `index.html`, apply dark smart-city paint styling on `style.load` (with `building-3d` fill-extrusion enabled from `minzoom: 11.5`), and register canvas-drawn icons (`hospital-cross-badge`, `landmark-diamond-badge`) with `['Noto Sans Bold']` glyphs so zero missing sprite/font 404s occur.
- **Verification:** Browser network check confirmed `41 / 41` HTTP `200` and `0` console/WebGL errors.

### 2. MapLibre `CustomLayerInterface` Attachment & Repaint Scheduling (`js/vehicle_layer.js`)
- **Symptom:** 3D vehicles failed to appear initially (`attachLayer` never ran), and calling `map.triggerRepaint()` inside `render()` starved tile decoding at `1 FPS`.
- **Root Cause:** `MapRenderer.initMap()` resolved on `load`, after which `isStyleLoaded()` was temporarily false while sources/layers were added, causing `VehicleLayer.init()` to wait on a `load` event that had already fired. Additionally, calling `triggerRepaint()` inside `render()` creates a tight repaint loop that blocks worker tile decoding on software WebGL.
- **Fix:** Attach `vehicle-fleet-layer` immediately when `map.loaded()` or `map.getStyle()` is present; call `this.renderer.resetState()` on every `render(gl, matrix)` call; remove `triggerRepaint()` from `render()` and throttle idle `update()` repaints to ~8 Hz (`!map.isMoving()`). Raise `InstancedMesh` capacity to `250` per archetype (`PASSENGER_CAR`, `AUTO_RICKSHAW`, `BMTC_BUS`, `TWO_WHEELER`), scale via `MercatorCoordinate.meterInMercatorCoordinateUnits()`, and render a multi-part 3D ambulance with alternating 4 Hz red/blue roof strobes.
- **Verification:** Confirmed in `Chase Ambulance` browser view (`step_76_shot_1_v5_chase_ambulance.png`): extruded 3D buildings, dark vector streets, 3D ambulance with glowing lightbar, and mixed BMTC buses, yellow auto-rickshaws, passenger cars, and two-wheelers visible with `0` WebGL errors.

### 3. Dynamic Hospital Badges & Live Corridor/Signal Sync (`js/map_renderer.js`, `js/app.js`)
- **Symptom:** Hardcoded St. Martha's/Mallya hospital list missed NIMHANS/Jayadeva/Manipal, all corridor lines rendered red, and `Green Waves Active` / `Signal Overrides` stayed `0`.
- **Root Cause:** `MapRenderer` checked `!Number.isFinite(cEntry.travelTimeSec)` where `getCongestionMap()` entries omit `travelTimeSec` (`undefined`), and `js/app.js` never called `controller.setDestination(destNode, destinationHospital)` on `SmartRoutingController`.
- **Fix:** Extract hospital badges dynamically from `NETWORK_DATA` (`hospitals` + `node_nimhans`, `node_jayadeva`, `node_manipal_hospital`), gate `landmark-badges-layer` to `minzoom: 13.5` to prevent overlap at city zoom, check `cEntry.travelTimeSec !== undefined` before `Number.isFinite`, call `controller.setDestination(...)` in `js/app.js`, and count active `isPreempted || PREEMPT_GREEN` signals in the header stat.
- **Verification:** Confirmed all 6 primary hospitals visible with zero label overlap (`step_40.png`), emerald corridors + cyan green-wave beam + live `Green Waves Active: 1`, `Signal Overrides: 1`, `Route Clear Rate: 6.7%`.

### 4. `Run A/B/C/D Experiment` & Single-Column Telemetry Card (`js/ui.js`, `index.html`, `css/styles.css`)
- **Symptom:** Clicking `Run A/B/C/D Experiment` threw `TypeError: Cannot read properties of null (reading 'GEO')` at `js/experiment.js:90`, and `renderMetrics()` overwrote `#speedometerGauge.innerText` (destroying the radial SVG gauge).
- **Root Cause:** Local `let CONFIG = o.CONFIG || null` in `experiment.js` shadowed global `CONFIG` (`typeof CONFIG !== 'undefined'` evaluated against the local `let`), and `ui.js` passed invalid node/hospital names (`'Koramangala'`, `'Manipal Hospital'`).
- **Fix:** Pass `{ CONFIG, NETWORK: NETWORK_DATA, SIGNALS: SIGNALS_DATA }` as `overrides` to `ExperimentHarness.runComparison()`, use verified `NETWORK_DATA` scenarios (`node_majestic` -> `hosp_victoria_01`), guard `speedometerGauge.innerText` to `isNode` only, read real `SimulationEngine` fields in `renderLiveTelemetry()`, and replace the 3-card grid with a single-column live telemetry card with zero hardcoded estimates or overlapping drawers.
- **Verification:** Browser run produced `Mode A: DNF_TIMEOUT` vs `Mode D: ARRIVED (700.6s)`, `Speed Gain: +33.9 km/h`, and all 207 JS tests (`test_runner_cli.js` 61/61, `test_routing.js` 27/27, `test_stage3_simulation.js` 7/7, `test_stage4_experiment.js` 8/8, plus M1–Tier5 suites) pass with 0 regressions.
