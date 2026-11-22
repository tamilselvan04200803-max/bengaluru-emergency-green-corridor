/**
 * tests/test_milestone2.js
 * Verification Test Suite for Milestone 2:
 * - Procedural 3D Ambulance & Kinematics (js/ambulance.js)
 * - Multi-Mode Camera Controller (js/camera.js)
 * - Web Audio API Siren Synthesizer (js/audio.js)
 */

const { SirenSynthesizer } = require('../js/audio.js');
const CameraController = require('../js/camera.js');
const { AmbulanceManager } = require('../js/ambulance.js');

function assert(cond, msg) {
  if (!cond) throw new Error(`[FAIL] ${msg}`);
}

function assertNear(actual, expected, tol = 0.001, msg = '') {
  const diff = Math.abs(actual - expected);
  if (diff > tol) {
    throw new Error(`[FAIL] ${msg} — Expected: ${expected} ±${tol}, Actual: ${actual}`);
  }
}

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('='.repeat(80));
console.log('MILESTONE 2: AMBULANCE, CAMERA & AUDIO SUBSYSTEM VERIFICATION');
console.log('='.repeat(80));

// --- Suite 1: Web Audio Siren Synthesizer ---
console.log('\n--- [AUDIO] Siren Synthesizer Tests ---');

runTest('Siren: Initial Frequency Range & Wail/Yelp Constants', () => {
  const siren = new SirenSynthesizer();
  const freqs = siren.getFrequencies();
  assert(freqs.minFreqHz === 750, 'Min frequency must be 750 Hz');
  assert(freqs.maxFreqHz === 1150, 'Max frequency must be 1150 Hz');
  assert(freqs.currentMode === 'wail', 'Default mode must be wail');
});

runTest('Siren: Toggle, Play, and Stop State Machine', () => {
  const siren = new SirenSynthesizer();
  assert(!siren.isActive(), 'Initially inactive');
  siren.start();
  assert(siren.isActive(), 'Active after start');
  siren.stop();
  assert(!siren.isActive(), 'Inactive after stop');
  siren.toggle();
  assert(siren.isActive(), 'Active after toggle');
  siren.toggle();
  assert(!siren.isActive(), 'Inactive after second toggle');
});

runTest('Siren: Mode Switching (Wail <-> Yelp) and Volume Clamping', () => {
  const siren = new SirenSynthesizer();
  siren.setMode('yelp');
  assert(siren.mode === 'yelp', 'Mode set to yelp');
  siren.setMode('wail');
  assert(siren.mode === 'wail', 'Mode set to wail');
  siren.setVolume(1.5);
  assert(siren.targetVolume === 1.0, 'Volume clamped to 1.0');
  siren.setVolume(-0.5);
  assert(siren.targetVolume === 0.0, 'Volume clamped to 0.0');
});

// --- Suite 2: Multi-Mode Camera Controller ---
console.log('\n--- [CAMERA] Multi-Mode Camera Controller Tests ---');

runTest('Camera: Mode Setting & OrbitControls Toggling', () => {
  const mockCamera = {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    up: { x: 0, y: 1, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    lookAt(x, y, z) {}
  };
  const mockControls = { enabled: true, target: { x: 0, y: 0, z: 0 } };
  const target = {
    getPosition: () => ({ x: 100, y: 0, z: 200 }),
    getHeadingDeg: () => 90,
    getPitch: () => 0.05,
    getRoll: () => 0.15,
    getSpeedKmh: () => 60
  };

  const camCtrl = new CameraController(mockCamera, target, null, mockControls);
  assert(camCtrl.getMode() === 'orbit', 'Default mode orbit');
  assert(mockControls.enabled === true, 'Orbit controls enabled in orbit mode');

  camCtrl.setMode('chase');
  assert(camCtrl.getMode() === 'chase', 'Switched to chase mode');
  assert(mockControls.enabled === false, 'Orbit controls disabled in chase mode');

  camCtrl.setMode('cockpit');
  assert(camCtrl.getMode() === 'cockpit', 'Switched to cockpit mode');

  camCtrl.setMode('aerial');
  assert(camCtrl.getMode() === 'aerial', 'Switched to aerial mode');
});

runTest('Camera: Cockpit Suspension Roll Coupling (Test T3.6 compliance)', () => {
  const mockCamera = {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    up: { x: 0, y: 1, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    lookAt(x, y, z) {}
  };
  const vehicleRollRad = 0.15;
  const target = {
    getPosition: () => ({ x: 0, y: 0, z: 0 }),
    getHeadingDeg: () => 0,
    getPitch: () => 0,
    getRoll: () => vehicleRollRad,
    getSpeedKmh: () => 40
  };

  const camCtrl = new CameraController(mockCamera, target);
  camCtrl.setMode('cockpit');
  camCtrl.update(0.016);

  const roll = camCtrl.getCockpitRoll();
  assert(roll > 0.10 && roll <= vehicleRollRad, `Cockpit roll ${roll} must be coupled within (0.10, ${vehicleRollRad}]`);
});

runTest('Camera: Rapid Mode Cycling (30 switches) Stability', () => {
  const mockCamera = {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    up: { x: 0, y: 1, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    lookAt(x, y, z) {}
  };
  const target = {
    getPosition: () => ({ x: 0, y: 0, z: 0 }),
    getHeadingDeg: () => 0,
    getPitch: () => 0,
    getRoll: () => 0,
    getSpeedKmh: () => 0
  };

  const camCtrl = new CameraController(mockCamera, target);
  for (let i = 0; i < 30; i++) {
    camCtrl.cycleMode();
    camCtrl.update(0.016);
  }
  assert(typeof camCtrl.getMode() === 'string', 'Camera controller remains stable after rapid mode cycling');
});

// --- Suite 3: Ambulance Kinematics & Controls ---
console.log('\n--- [AMBULANCE] Kinematics & Controls Tests ---');

runTest('Ambulance: Initialization & Anchor at Majestic Station', () => {
  const mockProjection = {
    latLonAltToCartesian: (lat, lon, alt) => ({ x: -2360.0, y: 2.0, z: -689.0 })
  };
  const amb = new AmbulanceManager(null, mockProjection);
  const pos = amb.getPosition();
  assertNear(pos.x, -2360.0, 1.0, 'Majestic X anchor');
  assertNear(pos.z, -689.0, 1.0, 'Majestic Z anchor');
  assert(amb.isManualMode() === false, 'Starts in Autonomous mode');
  amb.dispose();
});

runTest('Ambulance: Manual Driving Acceleration & Top Speed Governor (100 km/h)', () => {
  const mockProjection = { latLonAltToCartesian: () => ({ x: 0, y: 0, z: 0 }) };
  const amb = new AmbulanceManager(null, mockProjection);
  amb.toggleMode(); // Switch to manual
  assert(amb.isManualMode() === true, 'Manual mode active');

  // Accelerate for 100 ticks
  amb.keys.w = true;
  for (let i = 0; i < 100; i++) {
    amb.update(0.1);
  }

  assert(amb.getSpeedKmh() <= 100.0, `Speed ${amb.getSpeedKmh()} must be <= 100.0 km/h (governor)`);
  assert(amb.getSpeedKmh() >= 99.5, `Speed ${amb.getSpeedKmh()} should reach top speed ~100 km/h`);
  amb.dispose();
});

runTest('Ambulance: Conflicting Inputs (W + S simultaneous) Enforces Braking Priority', () => {
  const mockProjection = { latLonAltToCartesian: () => ({ x: 0, y: 0, z: 0 }) };
  const amb = new AmbulanceManager(null, mockProjection);
  amb.toggleMode();

  // Accelerate to 50 km/h first
  amb.keys.w = true;
  for (let i = 0; i < 20; i++) amb.update(0.1);
  const speedBefore = amb.getSpeedKmh();
  assert(speedBefore > 20.0, 'Vehicle reached forward speed');

  // Press W + S simultaneously
  amb.keys.w = true;
  amb.keys.s = true;
  amb.update(0.1);

  assert(amb.accelerationMps2 < 0, `Acceleration ${amb.accelerationMps2} must be negative (braking priority)`);
  assert(amb.getSpeedKmh() < speedBefore, 'Vehicle must decelerate under simultaneous inputs');
  amb.dispose();
});

runTest('Ambulance: Steering Clamping strictly at 35 degrees', () => {
  const mockProjection = { latLonAltToCartesian: () => ({ x: 0, y: 0, z: 0 }) };
  const amb = new AmbulanceManager(null, mockProjection);
  amb.toggleMode();

  // Full right steer
  amb.keys.d = true;
  for (let i = 0; i < 20; i++) amb.update(0.1);
  assertNear(amb.steeringAngleDeg, 35.0, 0.01, 'Right steering clamped to 35 deg');

  // Full left steer
  amb.keys.d = false;
  amb.keys.a = true;
  for (let i = 0; i < 40; i++) amb.update(0.1);
  assertNear(amb.steeringAngleDeg, -35.0, 0.01, 'Left steering clamped to -35 deg');
  amb.dispose();
});

runTest('Ambulance: Centripetal Roll Clamping to [-pi/8, pi/8]', () => {
  const mockProjection = { latLonAltToCartesian: () => ({ x: 0, y: 0, z: 0 }) };
  const amb = new AmbulanceManager(null, mockProjection);
  amb.toggleMode();

  // High speed sharp turn to induce maximum roll
  amb.keys.w = true;
  for (let i = 0; i < 40; i++) amb.update(0.1); // ~80-100 km/h
  amb.keys.d = true;
  for (let i = 0; i < 30; i++) amb.update(0.05);

  const roll = amb.getRoll();
  const maxRoll = Math.PI / 8.0;
  assert(Math.abs(roll) <= maxRoll + 0.001, `Roll ${roll} rad must be clamped within [-pi/8, pi/8]`);
  amb.dispose();
});

runTest('Ambulance: Forward Clearance Cone Sensor Parameters (80m, 0.7 rad)', () => {
  const mockProjection = { latLonAltToCartesian: () => ({ x: 0, y: 0, z: 0 }) };
  const amb = new AmbulanceManager(null, mockProjection);
  const cone = amb.getClearanceCone();

  assert(cone.range === 80.0, 'Clearance cone range must be 80.0m');
  assertNear(cone.fovAngleRad, 0.70, 0.01, 'Clearance cone FOV must be 0.70 rad (~40 deg)');
  assert(cone.forward && typeof cone.forward.x === 'number', 'Forward unit vector defined');
  assert(cone.sirenActive === true, 'Siren active by default on clearance cone');
  amb.dispose();
});

runTest('Ambulance: Autonomous 10Hz Telemetry Ingestion', () => {
  const mockProjection = {
    latLonAltToCartesian: (lat, lon, alt) => ({ x: 250.0, y: 3.0, z: -150.0 })
  };
  const amb = new AmbulanceManager(null, mockProjection);
  amb.setAutonomousTelemetry({
    vehicle_id: 'AMB-108-01',
    latitude: 12.9752,
    longitude: 77.5871,
    altitude: 922.5,
    speed_kmh: 54.0,
    heading: 180.0,
    priority_active: true,
    destination_hospital_id: 'hosp_victoria_01'
  });

  assertNear(amb.getSpeedKmh(), 54.0, 0.1, 'Speed updated from telemetry');
  assertNear(amb.getHeadingDeg(), 180.0, 0.1, 'Heading updated from telemetry');
  assert(amb.priorityActive === true, 'Priority active from telemetry');
  amb.dispose();
});

runTest('Ambulance: Offline Fallback Autonomous Waypoint Traversal', () => {
  const mockProjection = {
    latLonAltToCartesian: () => ({ x: 0, y: 0, z: 0 })
  };
  const amb = new AmbulanceManager(null, mockProjection);
  assert(!amb.isWsConnected, 'Offline state');

  const startPos = { ...amb.getPosition() };
  // Update internal autonomous simulation for 10 frames
  for (let i = 0; i < 10; i++) {
    amb.update(0.1);
  }

  const endPos = amb.getPosition();
  const moved = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
  assert(moved > 0.1, `Ambulance must autonomously move along waypoints when offline (moved ${moved}m)`);
  assert(amb.getSpeedKmh() > 0, 'Autonomous speed increases toward cruising speed');
  amb.dispose();
});

console.log('\n' + '='.repeat(80));
console.log(`MILESTONE 2 TEST RESULTS: ${passed}/${total} PASSED`);
console.log('='.repeat(80));
