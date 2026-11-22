/**
 * tests/test_milestone3.js
 * Verification Test Suite for Milestone 3:
 * - Heterogeneous Bengaluru Traffic Swarm (4 Classes)
 * - High-Performance InstancedMesh Batch Rendering (<5 draw calls)
 * - Forward Clearance Cone Sensor Math (80m, 0.7 rad FOV)
 * - Parting Wave Outward Shoulder Yielding (+/- 1.8m)
 * - Road Curb Boundary Clamping
 * - Acoustic Yield Gating (Siren Active vs Inactive)
 * - Post-Passage Restoration (>25m past)
 * - Traffic Signal Interaction & Early Preemption Queue Flushing
 * - Zero Traffic Density Boundary & Maximum Saturation (200 vehicles)
 */

const { TrafficSwarmManager, CivilianVehicle, VEHICLE_CLASSES, CONSTANTS } = require('../js/traffic.js');
const { AmbulanceManager } = require('../js/ambulance.js');
const SignalManager = require('../js/signals.js');
const GeoProjection = require('../js/projection.js');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// Load preview_data.js into global context for node testing
const previewDataPath = path.resolve(__dirname, '..', 'preview_data.js');
if (fs.existsSync(previewDataPath)) {
  const code = fs.readFileSync(previewDataPath, 'utf8');
  vm.runInThisContext(code);
}

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
console.log('MILESTONE 3: BENGALURU TRAFFIC SWARM & PRE-EMPTIVE CLEARANCE AI VERIFICATION');
console.log('='.repeat(80));

// --- Suite 1: Vehicle Archetype Heterogeneity ---
console.log('\n--- [ARCHETYPES] Heterogeneous Vehicle Classes ---');

runTest('Archetypes: 4 Distinct Bengaluru Vehicle Classes Defined', () => {
  const expectedClasses = ['AUTO_RICKSHAW', 'BMTC_BUS', 'TWO_WHEELER', 'PASSENGER_CAR'];
  expectedClasses.forEach(c => {
    assert(VEHICLE_CLASSES[c] !== undefined, `Vehicle class ${c} must be defined`);
  });
  assert(Object.keys(VEHICLE_CLASSES).length === 4, 'Must have exactly 4 classes');
});

runTest('Archetypes: Auto-Rickshaw Specifications & Dimensions', () => {
  const auto = VEHICLE_CLASSES.AUTO_RICKSHAW;
  assert(auto.wheels === 3, 'Auto must have 3 wheels');
  assertNear(auto.lengthM, 2.8, 0.01, 'Auto length must be 2.8m');
  assertNear(auto.widthM, 1.4, 0.01, 'Auto width must be 1.4m');
  assert(auto.heightM >= 1.7, 'Auto height must be >= 1.7m');
  assert(auto.defaultColor === 0xffcc00, 'Auto top must be iconic yellow');
});

runTest('Archetypes: BMTC Transit Bus Specifications & Dimensions', () => {
  const bus = VEHICLE_CLASSES.BMTC_BUS;
  assert(bus.wheels === 6, 'Bus must have 6 wheels');
  assertNear(bus.lengthM, 11.0, 0.01, 'Bus length must be 11.0m');
  assertNear(bus.widthM, 2.6, 0.01, 'Bus width must be 2.6m');
  assert(bus.heightM >= 3.0, 'Bus height must be >= 3.0m');
  assert(bus.defaultColor === 0x0044aa, 'BMTC bus must be royal blue');
});

runTest('Archetypes: Two-Wheeler Specifications & Dimensions', () => {
  const bike = VEHICLE_CLASSES.TWO_WHEELER;
  assert(bike.wheels === 2, 'Two-wheeler must have 2 wheels');
  assertNear(bike.lengthM, 1.9, 0.01, 'Two-wheeler length must be 1.9m');
  assertNear(bike.widthM, 0.8, 0.01, 'Two-wheeler width must be 0.8m');
  assert(bike.accelMps2 > 4.0, 'Two-wheeler has high acceleration for filtering');
});

runTest('Archetypes: Passenger Car Specifications & Dimensions', () => {
  const car = VEHICLE_CLASSES.PASSENGER_CAR;
  assert(car.wheels === 4, 'Car must have 4 wheels');
  assertNear(car.lengthM, 4.2, 0.01, 'Car length must be 4.2m');
  assertNear(car.widthM, 1.8, 0.01, 'Car width must be 1.8m');
  assert(car.palette && car.palette.length >= 3, 'Car must have varied color palette');
});

// --- Suite 2: Forward Clearance Cone Sensor Math ---
console.log('\n--- [CLEARANCE CONE] Forward Sensor Detection ---');

runTest('Sensor: Clearance Cone Parameters Contract', () => {
  assert(CONSTANTS.CLEARANCE_RANGE_M === 80.0, 'Cone range must be 80.0m');
  assertNear(CONSTANTS.CLEARANCE_FOV_RAD, 0.70, 0.01, 'Cone FOV must be 0.70 rad (~40 deg)');
  assert(CONSTANTS.PARTING_WAVE_SHIFT_M === 1.8, 'Parting wave shift must be 1.8m');
  assert(CONSTANTS.RESTORE_THRESHOLD_M === 25.0, 'Restore threshold must be 25.0m');
});

runTest('Sensor: Target Vehicle Directly in Front of Ambulance Evaluates True', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const vehicles = manager.getVehicles();
  assert(vehicles.length > 0, 'Swarm must have spawned vehicles');

  const v = vehicles[0];
  v.position = { x: 0.0, y: 0.0, z: -40.0 }; // 40m ahead of ambulance

  const cone = {
    position: { x: 0.0, y: 0.0, z: 0.0 },
    forward: { x: 0.0, y: 0.0, z: -1.0 }, // Facing North
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: true
  };

  const detected = v.isInsideClearanceCone(cone);
  assert(detected === true, 'Vehicle 40m directly ahead must be inside clearance cone');
});

runTest('Sensor: Target Vehicle Outside 80m Range Evaluates False', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];
  v.position = { x: 0.0, y: 0.0, z: -95.0 }; // 95m ahead (>80m range)

  const cone = {
    position: { x: 0.0, y: 0.0, z: 0.0 },
    forward: { x: 0.0, y: 0.0, z: -1.0 },
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: true
  };

  const detected = v.isInsideClearanceCone(cone);
  assert(detected === false, 'Vehicle beyond 80m must evaluate false');
});

runTest('Sensor: Target Vehicle Outside FOV Half-Angle Evaluates False', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];
  // 40m ahead, 30m to the right -> angle = atan(30/40) ~ 0.64 rad > 0.35 rad half-angle
  v.position = { x: 30.0, y: 0.0, z: -40.0 };

  const cone = {
    position: { x: 0.0, y: 0.0, z: 0.0 },
    forward: { x: 0.0, y: 0.0, z: -1.0 },
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: true
  };

  const detected = v.isInsideClearanceCone(cone);
  assert(detected === false, 'Vehicle outside 0.35 rad half-angle must evaluate false');
});

runTest('Sensor: Target Vehicle at Exact Cone Boundary Evaluates True (Test T2.3.4)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];
  // Exact boundary: 80.0m range, 0.35 rad half-angle
  v.position = {
    x: 80.0 * Math.sin(0.35),
    y: 0.0,
    z: -80.0 * Math.cos(0.35)
  };

  const cone = {
    position: { x: 0.0, y: 0.0, z: 0.0 },
    forward: { x: 0.0, y: 0.0, z: -1.0 },
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: true
  };

  const detected = v.isInsideClearanceCone(cone);
  assert(detected === true, 'Vehicle on exact boundary must evaluate true');
});

// --- Suite 3: Parting Wave Lateral Yielding & Acoustic Gating ---
console.log('\n--- [PARTING WAVE] Lateral Yielding & Acoustic Gating ---');

runTest('Parting Wave: Outward Steering to Road Shoulder when Siren Active', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];

  // Align ambulance behind vehicle along its actual forward heading vector
  const ambHeadingRad = v.headingRad;
  const ambFwd = { x: Math.sin(ambHeadingRad), y: 0.0, z: -Math.cos(ambHeadingRad) };
  const ambPos = {
    x: v.position.x - ambFwd.x * 30.0,
    y: v.position.y,
    z: v.position.z - ambFwd.z * 30.0
  };

  const cone = {
    position: ambPos,
    forward: ambFwd,
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: true
  };

  assert(v.lateralOffset === 0.0, 'Initially at lane center');

  // Run update for multiple steps to simulate steering lerp
  for (let step = 0; step < 60; step++) {
    v.update(0.016, cone, null, null);
  }

  assert(v.isYielding === true, 'Vehicle state must be yielding');
  assert(Math.abs(v.lateralOffset) > 1.0, `Vehicle must steer outward (offset: ${v.lateralOffset.toFixed(2)}m)`);
  assert(Math.abs(v.lateralOffset) <= 1.85, 'Lateral yield must be bounded by 1.8m shift');
});

runTest('Parting Wave: Acoustic Gating (Siren Inactive -> No Yield) (Test T3.2)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];

  const ambPos = { x: v.position.x, y: v.position.y, z: v.position.z + 30.0 };
  const ambHeadingRad = v.headingRad;
  const ambFwd = { x: Math.sin(ambHeadingRad), y: 0.0, z: -Math.cos(ambHeadingRad) };

  const coneSilent = {
    position: ambPos,
    forward: ambFwd,
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: false // SIREN OFF
  };

  for (let step = 0; step < 40; step++) {
    v.update(0.016, coneSilent, null, null);
  }

  assert(v.isYielding === false, 'Vehicle must NOT yield when siren is inactive');
  assertNear(v.lateralOffset, 0.0, 0.01, 'Lateral offset must stay 0.0m with siren off');
});

runTest('Parting Wave: Path Restoration Post-Ambulance Passage (>25m Past) (Test T1.3.4)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];

  // First induce yielding
  v.lateralOffset = 1.8;
  v.isYielding = true;

  // Now ambulance is 30m ahead of vehicle (ambulance has passed vehicle)
  const ambFwd = { x: 0.0, y: 0.0, z: -1.0 }; // Heading North
  const ambPos = { x: v.position.x, y: v.position.y, z: v.position.z - 30.0 }; // Ahead in -Z

  const conePassed = {
    position: ambPos,
    forward: ambFwd,
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: true
  };

  for (let step = 0; step < 80; step++) {
    v.update(0.016, conePassed, null, null);
  }

  assert(v.isPastAmbulance === true, 'Vehicle flagged as past ambulance');
  assertNear(v.lateralOffset, 0.0, 0.05, 'Vehicle restores lateral offset to 0.0m lane center');
});

runTest('Parting Wave: Curb Boundary Clamping on 2-Lane Road (Test T3.8)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  
  // Find a 2-lane road in network
  let road2Lane = null;
  manager.roads.forEach(r => {
    if (r.lanes === 2 && !road2Lane) road2Lane = r;
  });

  if (!road2Lane) {
    road2Lane = {
      id: 'mock_2lane',
      lanes: 2,
      width: 7.0,
      totalLength: 200.0,
      segments: [{
        p1: { x: 0, y: 0, z: 0 },
        p2: { x: 0, y: 0, z: -200 },
        dx: 0, dy: 0, dz: -200,
        length: 200,
        fwdX: 0, fwdZ: -1,
        normX: 1, normZ: 0,
        headingRad: 0,
        startDist: 0, endDist: 200
      }]
    };
  }

  const v2 = new CivilianVehicle('v_2lane', 'PASSENGER_CAR', road2Lane, 0, 50.0);
  
  const cone = {
    position: { x: v2.position.x, y: 0, z: v2.position.z + 30 },
    forward: { x: 0, y: 0, z: -1 },
    range: 80.0,
    fovAngleRad: 0.70,
    sirenActive: true
  };

  for (let step = 0; step < 60; step++) {
    v2.update(0.016, cone, null, null);
  }

  const roadHalfWidth = road2Lane.width / 2.0; // 3.5m
  // Total lateral displacement from centerline
  const laneCenter = (v2.laneIndex + 0.5 - (road2Lane.lanes / 2.0)) * 3.5;
  const totalOffset = Math.abs(laneCenter + v2.lateralOffset);

  assert(totalOffset <= roadHalfWidth, `Offset ${totalOffset.toFixed(2)}m must not exceed road half-width ${roadHalfWidth}m`);
});

// --- Suite 4: Early Preemption & Queue Flushing ---
console.log('\n--- [PREEMPTION & QUEUES] Intersection Queue Flushing ---');

runTest('Signals: Approaching Red Light Decelerates to Stop Bar', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];

  // Position 20m from end of road
  v.distanceAlongRoad = Math.max(0, v.road.totalLength - 20.0);
  v.speedKmh = 40.0;
  v.speedMps = 40.0 / 3.6;

  const mockSignal = {
    id: 'signal_test_red',
    currentState: 'RED',
    isPreempted: false
  };

  for (let step = 0; step < 120; step++) {
    v.update(0.016, null, mockSignal, null);
  }

  assert(v.speedKmh < 15.0, `Vehicle must decelerate before red signal (speed: ${v.speedKmh.toFixed(1)} km/h)`);
});

runTest('Signals: Preemption Green Wave Flushes Intersection Queue (Test T3.5)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  const v = manager.getVehicles()[0];

  // Initially stopped at red signal
  v.distanceAlongRoad = Math.max(0, v.road.totalLength - 10.0);
  v.speedKmh = 0.0;
  v.speedMps = 0.0;
  v.isQueued = true;

  // Signal switches to PRIORITY_GREEN via advance preemption
  const mockSignalGreen = {
    id: 'signal_test_preempt',
    currentState: 'PRIORITY_GREEN',
    isPreempted: true
  };

  for (let step = 0; step < 30; step++) {
    v.update(0.016, null, mockSignalGreen, null);
  }

  assert(v.isFlushing === true, 'Vehicle flagged as flushing intersection');
  assert(v.speedKmh > 5.0, `Vehicle must accelerate out of flushed queue (speed: ${v.speedKmh.toFixed(1)} km/h)`);
  assert(v.isQueued === false, 'Vehicle no longer queued');
});

// --- Suite 5: Swarm Scaling & Extremes ---
console.log('\n--- [SCALING & EXTREMES] Density Limits & Null Safety ---');

runTest('Scaling: Zero Traffic Density Executes with 0 Errors (Test T2.3.1)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  manager.setVehicleCount(0);
  assert(manager.getVehicleCount() === 0, 'Vehicle count set to 0');

  let err = null;
  try {
    manager.update(0.016, null, null);
  } catch (e) {
    err = e;
  }
  assert(err === null, 'Update with zero vehicles must not throw');
});

runTest('Scaling: Maximum Congestion Saturation (200 Vehicles) (Test T2.3.2)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  manager.setVehicleCount(200);
  assert(manager.getVehicleCount() === 200, 'Must support 200 vehicles');

  let err = null;
  try {
    manager.update(0.016, null, null);
  } catch (e) {
    err = e;
  }
  assert(err === null, 'Update with 200 vehicles must execute cleanly');
});

runTest('Scaling: Dynamic Traffic Density Scaling (0.0 to 1.0)', () => {
  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(null, projection);
  manager.setTrafficDensity(0.5);
  assert(manager.getVehicleCount() === 100, '50% density produces 100 vehicles');
  manager.setTrafficDensity(0.25);
  assert(manager.getVehicleCount() === 50, '25% density produces 50 vehicles');
});

// --- Suite 6: InstancedMesh Rendering Integration ---
console.log('\n--- [RENDERING] Three.js InstancedMesh Batching ---');

runTest('Rendering: InstancedMeshes Created for 4 Archetypes (<5 Draw Calls)', () => {
  const mockScene = {
    add(obj) { this.children = this.children || []; this.children.push(obj); }
  };
  const mockThree = {
    Scene: function() {},
    Group: function() { this.children = []; this.add = function(c) { this.children.push(c); }; },
    Object3D: function() {
      this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.matrix = {};
      this.updateMatrix = function() {};
    },
    Color: function() { this.setHex = function() {}; },
    BoxGeometry: function() { this.translate = function() {}; },
    MeshStandardMaterial: function() {},
    InstancedMesh: function(geo, mat, count) {
      this.geo = geo;
      this.mat = mat;
      this.maxCount = count;
      this.count = 0;
      this.instanceMatrix = { setUsage() {}, needsUpdate: false };
      this.instanceColor = { needsUpdate: false };
      this.setMatrixAt = function(idx, mat) {};
      this.setColorAt = function(idx, color) {};
    },
    DynamicDrawUsage: 35048
  };

  global.THREE = mockThree;

  const projection = new GeoProjection();
  const manager = new TrafficSwarmManager(mockScene, projection);
  
  assert(manager.instancedMeshes.AUTO_RICKSHAW !== undefined, 'Auto InstancedMesh created');
  assert(manager.instancedMeshes.BMTC_BUS !== undefined, 'Bus InstancedMesh created');
  assert(manager.instancedMeshes.TWO_WHEELER !== undefined, 'Two-Wheeler InstancedMesh created');
  assert(manager.instancedMeshes.PASSENGER_CAR !== undefined, 'Car InstancedMesh created');

  const drawCalls = Object.keys(manager.instancedMeshes).length;
  assert(drawCalls === 4, `Must use exactly 4 draw calls (<5 draw calls target), got ${drawCalls}`);

  delete global.THREE;
});

console.log('\n' + '='.repeat(80));
console.log(`MILESTONE 3 VERIFICATION SUMMARY: ${passed}/${total} TESTS PASSED`);
console.log('='.repeat(80));

if (passed === total) {
  console.log('All Milestone 3 requirements and test contracts verified successfully.\n');
  process.exit(0);
} else {
  console.error(`Verification FAILED with ${total - passed} errors.\n`);
  process.exit(1);
}
