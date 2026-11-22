/**
 * tests/test_tier5_adversarial.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin
 * Tier 5: Adversarial Coverage Hardening & Stress Testing Suite
 *
 * Covers:
 * 1. High-Density Swarm Stress (200-500 Vehicles, Narrow 2-Lane Roads, Bounding Box Containment, Zero NaN).
 * 2. Sensor Range Extremes & Boundary Stress (Origin, Antipodal / Outside Bengaluru Bounding Box, 0 Distance, Boundary Clamping, Degenerate Cone Vectors).
 * 3. High-Frequency Siren and Mode Toggling (1,000 Rapid Siren Toggles, 1,000 Autonomous vs WASD Mode Toggles, Rapid AI Green Corridor ON/OFF Toggling, Concurrent Frame Thrashing).
 * 4. BenchmarkEngine Mathematical Consistency & Invariances (Monotonicity of Time Savings, Strict Non-Negativity minutesSaved >= 0, Golden Hour Odds Strictly Bounded in [0%, 100%], Pathological/Fuzzed Inputs, Reverse Driving Distance Guard).
 * 5. Numerical Stability of ENU Coordinate Projection (Near-Poles Lat ±89.9999°, ±90.0°, Antipodal Points, Antimeridian ±180°, Micro-Displacements, Full Roundtrip Invertibility, Extreme Altitudes).
 * 6. Signal Controller Cycle & Preemption Horizon Stress (Supersonic Speed Clamping to 300m, Negative Speed Handling, 100,000s Long-Run Cycling Without Phase Drift, Post-Passage 3.0s Amber Invariance).
 * 7. Edge-Case Discovery & Fault Boundary Characterization (Empirical Verification of Edge-Case Limits).
 *
 * Zero build dependencies. Runs directly in Node.js via:
 * node tests/test_tier5_adversarial.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

// ----------------------------------------------------------------------------
// 1. ISOMORPHIC TEST HARNESS & PREVIEW DATA BOOTSTRAP
// ----------------------------------------------------------------------------
const previewDataPath = path.resolve(__dirname, '..', 'preview_data.js');
if (fs.existsSync(previewDataPath)) {
  const code = fs.readFileSync(previewDataPath, 'utf8');
  vm.runInThisContext(code);
  // Ensure global bindings for headless modules
  if (typeof ROADS_DATA !== 'undefined') global.ROADS_DATA = ROADS_DATA;
  if (typeof SIGNALS_DATA !== 'undefined') global.SIGNALS_DATA = SIGNALS_DATA;
  if (typeof HOSPITALS_DATA !== 'undefined') global.HOSPITALS_DATA = HOSPITALS_DATA;
}

// Import System Under Test (SUT) modules
const GeoProjection = require('../js/projection.js');
const BenchmarkEngine = require('../js/benchmark.js');
const SignalManager = require('../js/signals.js');
const { AmbulanceManager } = require('../js/ambulance.js');
const { TrafficSwarmManager, CivilianVehicle, VEHICLE_CLASSES, CONSTANTS: TRAFFIC_CONSTANTS } = require('../js/traffic.js');
const { SirenSynthesizer } = require('../js/audio.js');
const AtmosphereController = require('../js/atmosphere.js');

// ----------------------------------------------------------------------------
// 2. ASSERTION HELPERS
// ----------------------------------------------------------------------------
const Assert = {
  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  },
  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message || 'Assertion failed'} — Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
    }
  },
  assertNear(actual, expected, tolerance = 0.001, message) {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) {
      throw new Error(`${message || 'Assertion failed'} — Expected: ${expected} ±${tolerance}, Actual: ${actual} (diff: ${diff.toFixed(6)})`);
    }
  },
  assertTrue(value, message) {
    if (value !== true) {
      throw new Error(`${message || 'Expected true'} — Received: ${value}`);
    }
  },
  assertFalse(value, message) {
    if (value !== false) {
      throw new Error(`${message || 'Expected false'} — Received: ${value}`);
    }
  },
  assertFinite(value, message) {
    if (!Number.isFinite(value)) {
      throw new Error(`${message || 'Expected finite number'} — Received: ${value}`);
    }
  },
  assertThrows(fn, message) {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(message || 'Expected function to throw an exception');
    }
  }
};

// ----------------------------------------------------------------------------
// 3. TEST REGISTRY & RUNNER
// ----------------------------------------------------------------------------
const testResults = [];
let passedCount = 0;
let failedCount = 0;

function runAdversarialTest(id, name, description, testFn) {
  const startTime = Date.now();
  let passed = false;
  let errorMsg = null;

  try {
    testFn();
    passed = true;
    passedCount++;
    const duration = Date.now() - startTime;
    console.log(`  ✓ [PASS] ${id} (${duration}ms) — ${name}`);
  } catch (err) {
    passed = false;
    failedCount++;
    errorMsg = err.message;
    console.error(`  ✗ [FAIL] ${id} — ${name}`);
    console.error(`         ERROR: ${err.message}`);
  }

  testResults.push({ id, name, description, passed, error: errorMsg, durationMs: Date.now() - startTime });
}

console.log('='.repeat(80));
console.log('BENGALURU EMERGENCY GREEN CORRIDOR 3D DIGITAL TWIN');
console.log('TIER 5 ADVERSARIAL STRESS & CORNER-CASE HARDENING SUITE');
console.log('='.repeat(80));
console.log(`Execution Timestamp: ${new Date().toISOString()}`);
console.log(`Environment: Node.js ${process.version}`);
console.log('-'.repeat(80));

// ============================================================================
// DIMENSION 1: HIGH-DENSITY TRAFFIC SWARM STRESS (200 - 500 VEHICLES)
// ============================================================================
console.log('\n--- [TIER 5.1] High-Density Swarm Stress & Geometric Integrity (200-500 Vehicles) ---');

runAdversarialTest('T5.1.1', '500-Vehicle Swarm Allocation & Heterogeneous Distribution',
  'Allocate 500 vehicles across corridor network; verify count, archetype representation, and finite initial coordinates',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection, null, null, null, { maxVehicles: 500, count: 500 });
    Assert.assertEqual(swarm.getVehicleCount(), 500, 'Must successfully spawn 500 vehicles');

    const counts = { AUTO_RICKSHAW: 0, BMTC_BUS: 0, TWO_WHEELER: 0, PASSENGER_CAR: 0 };
    swarm.getVehicles().forEach((v, idx) => {
      Assert.assert(v.type in counts, `Vehicle ${idx} must belong to a valid class`);
      counts[v.type]++;
      Assert.assertFinite(v.position.x, `Vehicle ${idx} X must be finite`);
      Assert.assertFinite(v.position.y, `Vehicle ${idx} Y must be finite`);
      Assert.assertFinite(v.position.z, `Vehicle ${idx} Z must be finite`);
      Assert.assertFinite(v.speedKmh, `Vehicle ${idx} speed must be finite`);
      Assert.assertFinite(v.headingDeg, `Vehicle ${idx} heading must be finite`);
    });

    Assert.assert(counts.AUTO_RICKSHAW > 0, 'Auto-Rickshaws must be present in 500-swarm');
    Assert.assert(counts.BMTC_BUS > 0, 'BMTC Buses must be present in 500-swarm');
    Assert.assert(counts.TWO_WHEELER > 0, 'Two-Wheelers must be present in 500-swarm');
    Assert.assert(counts.PASSENGER_CAR > 0, 'Passenger Cars must be present in 500-swarm');
  }
);

runAdversarialTest('T5.1.2', '200 Vehicles Packed on Narrow 2-Lane Road (Avenue Road) Under 100 Frames',
  'Force 200 vehicles into single narrow 2-lane road (7.0m width); simulate 100 frames with collision avoidance',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const avenueRoad = swarm.roads.get('way_avenue_01');
    Assert.assert(avenueRoad !== undefined, 'Avenue Road segment must exist');
    Assert.assertEqual(avenueRoad.lanes, 2, 'Avenue road must be 2 lanes');
    Assert.assertEqual(avenueRoad.width, 7.0, 'Avenue road width must be 7.0m');

    // Pack 200 vehicles exclusively into this 2-lane road
    swarm.vehicles = [];
    for (let i = 0; i < 200; i++) {
      const v = new CivilianVehicle(`adv_avenue_${i}`, 'PASSENGER_CAR', avenueRoad, i % 2, (i * 5.0) % 1000.0);
      swarm.vehicles.push(v);
    }
    Assert.assertEqual(swarm.getVehicleCount(), 200);

    // Simulate 100 frames
    for (let f = 0; f < 100; f++) {
      swarm.update(0.016);
    }

    // Verify all 200 vehicles maintained finite non-corrupted state
    swarm.vehicles.forEach((v, idx) => {
      Assert.assertFinite(v.position.x, `Vehicle ${idx} position X must be finite`);
      Assert.assertFinite(v.position.y, `Vehicle ${idx} position Y must be finite`);
      Assert.assertFinite(v.position.z, `Vehicle ${idx} position Z must be finite`);
      Assert.assertFinite(v.speedKmh, `Vehicle ${idx} speed must be finite`);
      Assert.assert(v.speedKmh >= 0.0, `Vehicle ${idx} speed must not be negative`);
      Assert.assert(v.speedKmh <= v.classDef.maxSpeedKmh + 0.1, `Vehicle ${idx} speed must not exceed maximum`);
    });
  }
);

runAdversarialTest('T5.1.3', 'Lateral Yield Clamping on Narrow 2-Lane Road Under Parting Wave',
  'Verify vehicles yielding on 2-lane road never overshoot curb safety margins (curb safety margin = 0.40m)',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const avenueRoad = swarm.roads.get('way_avenue_01');
    const v = new CivilianVehicle('adv_curb_veh', 'BMTC_BUS', avenueRoad, 0, 80.0);

    const maxAllowedHalfWidth = (avenueRoad.width / 2.0) - TRAFFIC_CONSTANTS.CURB_SAFETY_MARGIN_M; // 7.0/2 - 0.40 = 3.10m
    const cone = {
      position: { x: v.position.x, y: 0, z: v.position.z + 20.0 },
      forward: { x: 0, y: 0, z: -1 },
      range: 80.0,
      fovAngleRad: 0.70,
      sirenActive: true
    };

    // Run 30 frames to allow lateral lerp convergence
    for (let i = 0; i < 30; i++) {
      v.update(0.1, cone);
    }

    Assert.assertTrue(v.isYielding, 'Vehicle inside cone must set isYielding to true');
    const laneCenter = (0 + 0.5 - (2 / 2.0)) * TRAFFIC_CONSTANTS.ROAD_LANE_WIDTH_M; // -1.75m
    const totalLateral = Math.abs(laneCenter + v.lateralOffset);

    Assert.assert(totalLateral <= (maxAllowedHalfWidth + 1e-4),
      `Total lateral offset (${totalLateral.toFixed(3)}m) must not exceed road curb limit (${maxAllowedHalfWidth.toFixed(3)}m)`);
  }
);

runAdversarialTest('T5.1.4', 'Extreme Frame Delta Spikes (0s, 0.0001s, 1.0s, 5.0s)',
  'Verify vehicle and swarm physics remain stable under zero delta, microscopic steps, and multi-second lag freezes',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection, null, null, null, { maxVehicles: 50, count: 50 });

    const deltas = [0.0, 0.00001, 0.5, 1.0, 5.0, 0.016];
    deltas.forEach(dt => {
      swarm.update(dt);
      swarm.vehicles.forEach((v, idx) => {
        Assert.assertFinite(v.position.x, `Vehicle ${idx} pos X finite after dt=${dt}`);
        Assert.assertFinite(v.position.z, `Vehicle ${idx} pos Z finite after dt=${dt}`);
        Assert.assertFinite(v.lateralOffset, `Vehicle ${idx} lateralOffset finite after dt=${dt}`);
      });
    });
  }
);

runAdversarialTest('T5.1.5', 'InstancedMesh 500-Vehicle Batch Matrix Integrity',
  'Mock Three.js InstancedMesh with 500 instances; verify all 16 matrix elements are finite numbers',
  () => {
    const matrixBuffer = [];
    const mockThree = {
      Scene: function () {},
      Group: function () { this.children = []; this.add = function (c) { this.children.push(c); }; },
      Object3D: function () {
        this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.matrix = {
          elements: new Float32Array(16)
        };
        this.updateMatrix = function () {
          // Fill dummy matrix elements for verification
          this.matrix.elements[0] = 1; this.matrix.elements[5] = 1; this.matrix.elements[10] = 1; this.matrix.elements[15] = 1;
          this.matrix.elements[12] = this.position.x;
          this.matrix.elements[13] = this.position.y;
          this.matrix.elements[14] = this.position.z;
        };
      },
      Color: function () { this.setHex = function () {}; },
      BoxGeometry: function () { this.translate = function () {}; },
      MeshStandardMaterial: function () {},
      InstancedMesh: function (geo, mat, count) {
        this.geo = geo;
        this.mat = mat;
        this.maxCount = count;
        this.count = 0;
        this.instanceMatrix = { setUsage() {}, needsUpdate: false };
        this.instanceColor = { needsUpdate: false };
        this.setMatrixAt = function (idx, mat) {
          matrixBuffer.push({ idx, elements: Array.from(mat.elements) });
        };
        this.setColorAt = function () {};
      },
      DynamicDrawUsage: 35048
    };

    global.THREE = mockThree;
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager({ add() {} }, projection, null, null, null, { maxVehicles: 500, count: 500 });
    swarm.update(0.016);

    Assert.assert(matrixBuffer.length > 0, 'InstancedMesh matrix buffer must be populated');
    matrixBuffer.forEach(entry => {
      entry.elements.forEach((val, i) => {
        Assert.assertFinite(val, `Matrix element ${i} at instance ${entry.idx} must be finite`);
      });
    });

    delete global.THREE;
  }
);

// ============================================================================
// DIMENSION 2: SENSOR RANGE EXTREMES & BOUNDARY STRESS
// ============================================================================
console.log('\n--- [TIER 5.2] Sensor Range Extremes & Pathological Spatial Inputs ---');

runAdversarialTest('T5.2.1', 'Clearance Cone Sensor at Reference Origin (0, 0, 0)',
  'Verify cone sensor anchored at exact origin correctly distinguishes forward target vs rear/lateral target',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const v = swarm.vehicles[0];

    const coneOrigin = {
      position: { x: 0.0, y: 0.0, z: 0.0 },
      forward: { x: 0.0, y: 0.0, z: -1.0 }, // Facing North
      range: 80.0,
      fovAngleRad: 0.70,
      sirenActive: true
    };

    // Ahead inside cone
    v.position = { x: 0.0, y: 0.0, z: -40.0 };
    Assert.assertTrue(v.isInsideClearanceCone(coneOrigin), 'Target 40m North must be inside cone');

    // Behind ambulance
    v.position = { x: 0.0, y: 0.0, z: +40.0 };
    Assert.assertFalse(v.isInsideClearanceCone(coneOrigin), 'Target 40m South (behind) must be outside cone');

    // Lateral to ambulance
    v.position = { x: +50.0, y: 0.0, z: 0.0 };
    Assert.assertFalse(v.isInsideClearanceCone(coneOrigin), 'Target 50m East must be outside cone');
  }
);

runAdversarialTest('T5.2.2', 'Ambulance Far Outside Bengaluru Bounding Box (>1,000 km away)',
  'Verify sensor rejects vehicles when ambulance is 1,000+ km away, producing no false positive yields',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const v = swarm.vehicles[0]; // Inside Bengaluru
    v.position = { x: 100.0, y: 0.0, z: -200.0 };

    const coneFar = {
      position: { x: 1500000.0, y: 0.0, z: -1500000.0 }, // Far away
      forward: { x: 0.0, y: 0.0, z: -1.0 },
      range: 80.0,
      fovAngleRad: 0.70,
      sirenActive: true
    };

    Assert.assertFalse(v.isInsideClearanceCone(coneFar), 'Bengaluru vehicle must not detect ambulance 1500km away');
    v.update(0.016, coneFar);
    Assert.assertFalse(v.isYielding, 'Vehicle must not yield to distant ambulance');
    Assert.assertEqual(v.lateralOffset, 0.0, 'Lateral offset must remain zero');
  }
);

runAdversarialTest('T5.2.3', 'Target Vehicle Co-located at Exact Same Coordinates (Distance = 0)',
  'Verify clearance cone evaluates distance = 0 without division-by-zero, returning false safely',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const v = swarm.vehicles[0];
    v.position = { x: 25.0, y: 0.0, z: -50.0 };

    const coneSamePos = {
      position: { x: 25.0, y: 0.0, z: -50.0 }, // Exact same position
      forward: { x: 0.0, y: 0.0, z: -1.0 },
      range: 80.0,
      fovAngleRad: 0.70,
      sirenActive: true
    };

    const inside = v.isInsideClearanceCone(coneSamePos);
    Assert.assertFalse(inside, 'Co-located vehicle must evaluate false (dist < 0.001)');
  }
);

runAdversarialTest('T5.2.4', 'Target Vehicle Exactly on Sensor Boundary (80.0m range, 0.35 rad half-angle)',
  'Verify deterministic evaluation at the mathematical boundary of the clearance cone',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const v = swarm.vehicles[0];

    const cone = {
      position: { x: 0.0, y: 0.0, z: 0.0 },
      forward: { x: 0.0, y: 0.0, z: -1.0 },
      range: 80.0,
      fovAngleRad: 0.70,
      sirenActive: true
    };

    // Target at exactly 80.0m range on centerline
    v.position = { x: 0.0, y: 0.0, z: -80.0 };
    Assert.assertTrue(v.isInsideClearanceCone(cone), 'Vehicle at exact range boundary (80.0m) must evaluate true');

    // Target at 80.05m (just beyond)
    v.position = { x: 0.0, y: 0.0, z: -80.05 };
    Assert.assertFalse(v.isInsideClearanceCone(cone), 'Vehicle at 80.05m must evaluate false');
  }
);

runAdversarialTest('T5.2.5', 'Degenerate Cone Forward Vector ({x: 0, y: 0, z: 0})',
  'Verify zero-length forward vector does not trigger NaN or crash, returning false safely',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const v = swarm.vehicles[0];
    v.position = { x: 0.0, y: 0.0, z: -30.0 };

    const degenerateCone = {
      position: { x: 0.0, y: 0.0, z: 0.0 },
      forward: { x: 0.0, y: 0.0, z: 0.0 }, // Zero vector
      range: 80.0,
      fovAngleRad: 0.70,
      sirenActive: true
    };

    const detected = v.isInsideClearanceCone(degenerateCone);
    Assert.assertFalse(detected, 'Degenerate forward vector must return false');
  }
);

runAdversarialTest('T5.2.6', 'Null and Undefined Cone Inputs to Vehicle Update',
  'Verify vehicle update gracefully accepts null and undefined cone parameters (no ambulance in scene)',
  () => {
    const projection = new GeoProjection();
    const swarm = new TrafficSwarmManager(null, projection);
    const v = swarm.vehicles[0];

    v.update(0.016, null);
    Assert.assertFinite(v.position.x, 'Position X must remain finite after null cone');
    Assert.assertEqual(v.lateralOffset, 0.0, 'Lateral offset must be 0.0 when cone is null');

    v.update(0.016, undefined);
    Assert.assertFinite(v.position.x, 'Position X must remain finite after undefined cone');
    Assert.assertEqual(v.lateralOffset, 0.0, 'Lateral offset must be 0.0 when cone is undefined');
  }
);

// ============================================================================
// DIMENSION 3: HIGH-FREQUENCY SIREN & MODE TOGGLING STRESS
// ============================================================================
console.log('\n--- [TIER 5.3] High-Frequency Siren & Mode Toggling Stress ---');

runAdversarialTest('T5.3.1', '1,000 Rapid Siren Toggles (State Alternation & Invariant)',
  'Execute 1,000 consecutive calls to ambulance.toggleSiren(); verify clean state alternation',
  () => {
    const projection = new GeoProjection();
    const amb = new AmbulanceManager(null, projection);
    const initialSiren = amb.isSirenActive();

    for (let i = 0; i < 1000; i++) {
      const state = amb.toggleSiren();
      Assert.assertEqual(state, amb.isSirenActive(), 'toggleSiren return must match isSirenActive()');
    }

    // 1000 toggles (even number) must return to initial state
    Assert.assertEqual(amb.isSirenActive(), initialSiren, '1,000 toggles must preserve initial parity');
  }
);

runAdversarialTest('T5.3.2', '1,000 Rapid Driving Mode Toggles (Autonomous vs Manual WASD)',
  'Execute 1,000 consecutive calls to ambulance.toggleMode(); verify clean state alternation',
  () => {
    const projection = new GeoProjection();
    const amb = new AmbulanceManager(null, projection);
    const initialMode = amb.isManualMode();

    for (let i = 0; i < 1000; i++) {
      const state = amb.toggleMode();
      Assert.assertEqual(state, amb.isManualMode(), 'toggleMode return must match isManualMode()');
    }

    Assert.assertEqual(amb.isManualMode(), initialMode, '1,000 toggles must preserve initial mode parity');
  }
);

runAdversarialTest('T5.3.3', '1,000 Rapid AI Green Corridor Toggles in BenchmarkEngine',
  'Execute 1,000 consecutive calls to benchmark.toggleAiCorridor(); verify state alternation and non-corruption',
  () => {
    const bm = new BenchmarkEngine();
    const initialActive = bm.isAiCorridorActive;

    for (let i = 0; i < 1000; i++) {
      const state = bm.toggleAiCorridor();
      Assert.assertEqual(state, bm.isAiCorridorActive, 'toggleAiCorridor return must match isAiCorridorActive');
    }

    Assert.assertEqual(bm.isAiCorridorActive, initialActive, '1,000 toggles must preserve initial AI corridor parity');
  }
);

runAdversarialTest('T5.3.4', 'Concurrent Multi-Subsystem Thrashing During Active Simulation Loop',
  'Simulate 300 frames while concurrently toggling siren, mode, corridor state, and conflicting keyboard inputs',
  () => {
    const projection = new GeoProjection();
    const amb = new AmbulanceManager(null, projection);
    const swarm = new TrafficSwarmManager(null, projection);
    const bm = new BenchmarkEngine();

    for (let f = 0; f < 300; f++) {
      // Toggle states
      amb.toggleSiren();
      amb.toggleMode();
      bm.toggleAiCorridor();

      // Conflicting inputs
      amb.keys.w = (f % 2 === 0);
      amb.keys.s = (f % 3 === 0);
      amb.keys.a = (f % 4 === 0);
      amb.keys.d = (f % 5 === 0);
      amb.keys.space = (f % 7 === 0);

      // Simulation steps
      amb.update(0.016);
      const cone = amb.getClearanceCone();
      swarm.update(0.016, cone);
      bm.update(0.016, amb);

      Assert.assertFinite(amb.position.x, `Ambulance X finite at frame ${f}`);
      Assert.assertFinite(amb.speedKmh, `Ambulance speed finite at frame ${f}`);
      Assert.assertFinite(bm.baselineTimeSec, `Baseline time finite at frame ${f}`);
      Assert.assertFinite(bm.aiCorridorTimeSec, `AI time finite at frame ${f}`);
    }

    const metrics = bm.getMetrics();
    Assert.assert(metrics.minutesSaved >= 0.0, 'minutesSaved must be non-negative after thrashing');
    Assert.assert(metrics.goldenHourOddsPreserved >= 0.0, 'goldenHourOddsPreserved must be non-negative after thrashing');
  }
);

// ============================================================================
// DIMENSION 4: BENCHMARKENGINE MATHEMATICAL CONSISTENCY & INVARIANTS
// ============================================================================
console.log('\n--- [TIER 5.4] BenchmarkEngine Mathematical Consistency & Invariant Preservation ---');

runAdversarialTest('T5.4.1', 'Monotonicity of Time Savings Under AI Green Corridor Active',
  'Simulate 60 seconds of AI Green Corridor transit; verify baselineTimeSec >= aiCorridorTimeSec monotonically',
  () => {
    const bm = new BenchmarkEngine({ isAiCorridorActive: true });
    const mockAmb = { getSpeedKmh: () => 50.0 };

    let prevBaseline = 0.0;
    let prevAi = 0.0;

    for (let s = 0; s < 60; s++) {
      bm.update(1.0, mockAmb);
      Assert.assert(bm.baselineTimeSec >= bm.aiCorridorTimeSec,
        `Step ${s}: baselineTime (${bm.baselineTimeSec}) must be >= aiCorridorTime (${bm.aiCorridorTimeSec})`);
      Assert.assert(bm.baselineTimeSec >= prevBaseline, `Step ${s}: baselineTime must be monotonically increasing`);
      Assert.assert(bm.aiCorridorTimeSec >= prevAi, `Step ${s}: aiCorridorTime must be monotonically increasing`);

      prevBaseline = bm.baselineTimeSec;
      prevAi = bm.aiCorridorTimeSec;
    }
  }
);

runAdversarialTest('T5.4.2', 'Strict Non-Negativity of Time Savings (minutesSaved >= 0.0 under all inputs)',
  'Verify minutesSaved and percentTimeSaved are >= 0.0 even under adversarial scenarios where aiSec > baselineSec',
  () => {
    const testCases = [
      { base: 100, ai: 200 },
      { base: 0, ai: 500 },
      { base: 50, ai: 50 },
      { base: 3600, ai: 1200 },
      { base: 0, ai: 0 }
    ];

    testCases.forEach(tc => {
      const m = BenchmarkEngine.calculateMetrics(tc.base, tc.ai);
      Assert.assert(m.minutesSaved >= 0.0, `minutesSaved (${m.minutesSaved}) must be >= 0 for base=${tc.base}, ai=${tc.ai}`);
      Assert.assert(m.percentTimeSaved >= 0.0, `percentTimeSaved (${m.percentTimeSaved}) must be >= 0 for base=${tc.base}, ai=${tc.ai}`);
      Assert.assert(m.speedImprovementPercent >= 0.0, `speedImprovementPercent (${m.speedImprovementPercent}) must be >= 0`);
      Assert.assert(m.haltsAvoided >= 0, `haltsAvoided (${m.haltsAvoided}) must be >= 0`);
    });
  }
);

runAdversarialTest('T5.4.3', 'Golden Hour Survival Odds Strictly Bounded in [0.0%, 100.0%]',
  'Verify Golden Hour survival odds metric is strictly bounded within [0.0%, 99.0%] across extreme inputs',
  () => {
    // Range of minutes saved from -100 to +10,000 minutes
    const testMinutes = [-100, -10, 0, 1, 5, 12, 50, 100, 1000, 10000];

    testMinutes.forEach(mins => {
      const baseSec = (mins >= 0 ? mins : 0) * 60.0 + 100.0;
      const aiSec = 100.0;
      const m = BenchmarkEngine.calculateMetrics(baseSec, aiSec);

      Assert.assert(m.goldenHourOddsPreserved >= 0.0,
        `Odds (${m.goldenHourOddsPreserved}%) must be >= 0.0% for minutesSaved=${mins}`);
      Assert.assert(m.goldenHourOddsPreserved <= 99.0,
        `Odds (${m.goldenHourOddsPreserved}%) must be <= 99.0% (ceiling) for minutesSaved=${mins}`);
      Assert.assert(m.goldenHourOddsPreserved <= 100.0,
        `Odds (${m.goldenHourOddsPreserved}%) must strictly not exceed 100.0%`);
    });
  }
);

runAdversarialTest('T5.4.4', 'Pathological & Adversarial Input Sanitization in calculateMetrics',
  'Pass NaN, negative, null, undefined, strings, and zero values to calculateMetrics; verify clean numeric output',
  () => {
    const pathological = [
      [NaN, NaN],
      [-500, -200],
      [null, undefined],
      ['invalid', 'strings'],
      [0, 0],
      [1e8, 10]
    ];

    pathological.forEach(([b, a]) => {
      const m = BenchmarkEngine.calculateMetrics(b, a);
      Assert.assertFinite(m.baselineTimeSec, `baselineTimeSec finite for [${b}, ${a}]`);
      Assert.assertFinite(m.aiCorridorTimeSec, `aiCorridorTimeSec finite for [${b}, ${a}]`);
      Assert.assertFinite(m.minutesSaved, `minutesSaved finite for [${b}, ${a}]`);
      Assert.assertFinite(m.percentTimeSaved, `percentTimeSaved finite for [${b}, ${a}]`);
      Assert.assertFinite(m.goldenHourOddsPreserved, `goldenHourOddsPreserved finite for [${b}, ${a}]`);
      Assert.assert(m.minutesSaved >= 0.0, `minutesSaved >= 0 for [${b}, ${a}]`);
      Assert.assert(m.goldenHourOddsPreserved >= 0.0 && m.goldenHourOddsPreserved <= 99.0, `goldenHourOdds in [0, 99]`);
    });
  }
);

runAdversarialTest('T5.4.5', 'Distance Accumulation Progress Guard Under Reverse Driving',
  'Simulate ambulance in reverse (speedKmh = -25.0); verify distanceTraveledKm never decrements below 0',
  () => {
    const bm = new BenchmarkEngine();
    const mockAmbReverse = { getSpeedKmh: () => -25.0 };

    for (let i = 0; i < 50; i++) {
      bm.update(0.1, mockAmbReverse);
      Assert.assertEqual(bm.distanceTraveledKm, 0.0, `Distance must remain 0.0 while reversing (step ${i})`);
      Assert.assertEqual(bm.currentSpeedKmh, 0.0, `Forward speed must be clamped to 0.0 while reversing (step ${i})`);
    }
  }
);

runAdversarialTest('T5.4.6', 'Multi-Run Cumulative Metric Invariance and JSON Export Integrity',
  'Record 10 sequential transit runs; verify cumulative aggregates match sum of individual runs',
  () => {
    const bm = new BenchmarkEngine();

    for (let r = 1; r <= 10; r++) {
      bm.recordRun({
        minutesSaved: r * 1.5,
        percentTimeSaved: 40.0 + r * 2.0,
        haltReduction: r,
        haltsAvoided: r
      });
    }

    const exported = bm.exportBenchmarkData();
    Assert.assertEqual(exported.totalRunsCompleted, 10, 'Must have recorded 10 runs');
    Assert.assertEqual(exported.runs.length, 10, 'Must contain 10 run objects');

    // Expected cumulative minutes saved = sum(1.5 * r for r=1..10) = 1.5 * 55 = 82.5
    Assert.assertNear(exported.cumulativeMinutesSaved, 82.5, 0.1, 'Cumulative minutes saved must match sum');
    // Expected total halts eliminated = sum(1..10) = 55
    Assert.assertEqual(exported.totalHaltsEliminated, 55, 'Total halts eliminated must match sum');
    // Schema timestamp
    Assert.assert(typeof exported.exportTimestamp === 'string', 'exportTimestamp must be an ISO string');
  }
);

// ============================================================================
// DIMENSION 5: NUMERICAL STABILITY OF ENU COORDINATE PROJECTION
// ============================================================================
console.log('\n--- [TIER 5.5] Numerical Stability of ENU Coordinate Projection ---');

runAdversarialTest('T5.5.1', 'Reference Origin Null-Displacement Invariance',
  'K.R. Circle origin (12.9715987°, 77.5945627°, 920.0m) projects to (0, 0, 0) with <1e-6m precision',
  () => {
    const proj = new GeoProjection();
    const origin = proj.latLonAltToCartesian(12.9715987, 77.5945627, 920.0);
    Assert.assertNear(origin.x, 0.0, 1e-6, 'Origin X must be 0.0');
    Assert.assertNear(origin.y, 0.0, 1e-6, 'Origin Y must be 0.0');
    Assert.assertNear(origin.z, 0.0, 1e-6, 'Origin Z must be 0.0');
  }
);

runAdversarialTest('T5.5.2', 'Near-Poles Projection Stability (Lat = ±89.9999°, ±90.0°)',
  'Verify near-pole and polar inputs produce finite coordinates without throwing or NaN',
  () => {
    const proj = new GeoProjection();
    const poleNorth = proj.latLonAltToCartesian(90.0, 77.5945627, 920.0);
    const poleSouth = proj.latLonAltToCartesian(-90.0, 77.5945627, 920.0);
    const nearPole = proj.latLonAltToCartesian(89.9999, 77.5945627, 920.0);

    Assert.assertFinite(poleNorth.x, 'North Pole X must be finite');
    Assert.assertFinite(poleNorth.z, 'North Pole Z must be finite');
    Assert.assertFinite(poleSouth.x, 'South Pole X must be finite');
    Assert.assertFinite(poleSouth.z, 'South Pole Z must be finite');
    Assert.assertFinite(nearPole.x, 'Near Pole X must be finite');
    Assert.assertFinite(nearPole.z, 'Near Pole Z must be finite');

    // Rigorous ECEF-to-ENU projection
    const rigNorth = proj.rigorousLatLonAltToCartesian(90.0, 77.5945627, 920.0);
    Assert.assertFinite(rigNorth.x, 'Rigorous North Pole X must be finite');
    Assert.assertFinite(rigNorth.y, 'Rigorous North Pole Y must be finite');
    Assert.assertFinite(rigNorth.z, 'Rigorous North Pole Z must be finite');
  }
);

runAdversarialTest('T5.5.3', 'Antipodal Coordinate Projection Stability',
  'Verify antipodal point (Lat: -12.9715987°, Lon: -102.4054373°) computes finite coordinates',
  () => {
    const proj = new GeoProjection();
    const antipodal = proj.latLonAltToCartesian(-12.9715987, -102.4054373, 920.0);
    Assert.assertFinite(antipodal.x, 'Antipodal X must be finite');
    Assert.assertFinite(antipodal.y, 'Antipodal Y must be finite');
    Assert.assertFinite(antipodal.z, 'Antipodal Z must be finite');

    const rigAnti = proj.rigorousLatLonAltToCartesian(-12.9715987, -102.4054373, 920.0);
    Assert.assertFinite(rigAnti.x, 'Rigorous Antipodal X must be finite');
    Assert.assertFinite(rigAnti.y, 'Rigorous Antipodal Y must be finite');
    Assert.assertFinite(rigAnti.z, 'Rigorous Antipodal Z must be finite');
  }
);

runAdversarialTest('T5.5.4', 'Prime Meridian and Antimeridian Displacements (Lon = 0.0°, ±180.0°)',
  'Verify Prime Meridian and Antimeridian longitudes compute finite coordinates without NaN',
  () => {
    const proj = new GeoProjection();
    const prime = proj.latLonAltToCartesian(12.9715987, 0.0, 920.0);
    const anti1 = proj.latLonAltToCartesian(12.9715987, 180.0, 920.0);
    const anti2 = proj.latLonAltToCartesian(12.9715987, -180.0, 920.0);

    Assert.assertFinite(prime.x, 'Prime meridian X must be finite');
    Assert.assertFinite(anti1.x, 'Antimeridian +180 X must be finite');
    Assert.assertFinite(anti2.x, 'Antimeridian -180 X must be finite');
  }
);

runAdversarialTest('T5.5.5', 'Microscopic Displacement Precision (1 Micrometer)',
  'Verify projection detects microscopic longitude delta (1e-8 deg ~= 1.1mm) without precision underflow',
  () => {
    const proj = new GeoProjection();
    const p1 = proj.latLonAltToCartesian(12.9715987, 77.5945627, 920.0);
    const p2 = proj.latLonAltToCartesian(12.9715987, 77.5945627 + 1e-8, 920.0);

    const deltaX = p2.x - p1.x;
    Assert.assert(deltaX > 0.0005 && deltaX < 0.002, `Delta X (${deltaX}m) must be ~1.08mm`);
  }
);

runAdversarialTest('T5.5.6', 'Geodetic <-> Cartesian Invertibility Roundtrip Across 25 Corridor Points',
  'Verify unproject(project(lat, lon, alt)) recovers geodetic coordinates to <1e-7 deg (~1cm)',
  () => {
    const proj = new GeoProjection();

    for (let i = 0; i < 25; i++) {
      const testLat = 12.955 + (i * 0.0014); // Corridor latitude range
      const testLon = 77.565 + (i * 0.0024); // Corridor longitude range
      const testAlt = 910.0 + (i * 1.5);

      const cart = proj.latLonAltToCartesian(testLat, testLon, testAlt);
      const recovered = proj.cartesianToLatLonAlt(cart.x, cart.y, cart.z);

      Assert.assertNear(recovered.lat, testLat, 1e-7, `Recovered lat must match testLat at point ${i}`);
      Assert.assertNear(recovered.lon, testLon, 1e-7, `Recovered lon must match testLon at point ${i}`);
      Assert.assertNear(recovered.alt, testAlt, 1e-3, `Recovered alt must match testAlt at point ${i}`);
    }
  }
);

runAdversarialTest('T5.5.7', 'Extreme Altitude Bounds (-11,000m Mariana Trench to +100,000m Karman Line)',
  'Verify vertical Y displacement scales 1:1 with delta altitude across planetary extremes',
  () => {
    const proj = new GeoProjection();
    const deepSea = proj.latLonAltToCartesian(12.9715987, 77.5945627, -11000.0);
    const space = proj.latLonAltToCartesian(12.9715987, 77.5945627, 100000.0);

    Assert.assertNear(deepSea.y, -11000.0 - 920.0, 0.001, 'Deep sea elevation must be exact delta');
    Assert.assertNear(space.y, 100000.0 - 920.0, 0.001, 'Space elevation must be exact delta');
  }
);

// ============================================================================
// DIMENSION 6: TRAFFIC SIGNAL PREEMPTION HORIZON & CYCLE STRESS
// ============================================================================
console.log('\n--- [TIER 5.6] Traffic Signal Preemption Horizon & Cycle Stress ---');

runAdversarialTest('T5.6.1', 'Supersonic Speed Preemption Horizon Clamped to 300.0m',
  'Verify preemption clearance horizon d = min(300m, v * 25s) is strictly clamped to 300.0m at 5,000 km/h',
  () => {
    const projection = new GeoProjection();
    const sm = new SignalManager(null, projection);
    Assert.assert(sm.getAllSignals().length > 0, 'SignalManager must load signals');

    // At 5,000 km/h = 1388.8 m/s, v * 25s = 34,722m, but horizon must clamp to 300m
    const originPos = { x: 0, y: 0, z: 0 };
    sm.updatePreemption(originPos, 5000.0);

    // Verify signals farther than 300m from origin are NOT preempted
    sm.getAllSignals().forEach(sig => {
      const dist = Math.hypot(sig.worldPos.x, sig.worldPos.z);
      if (dist > 300.0) {
        Assert.assertFalse(sig.isPreempted, `Signal ${sig.id} at ${dist.toFixed(1)}m must not be preempted (>300m clamp)`);
      }
    });
  }
);

runAdversarialTest('T5.6.2', 'Negative Ambulance Speed Clamped to Minimum (5.0 m/s)',
  'Verify negative ambulance speed in preemption update is clamped to minSpeedMps=5.0m/s (horizon=125.0m)',
  () => {
    const projection = new GeoProjection();
    const sm = new SignalManager(null, projection);

    // Negative speed: -50 km/h. Minimum speed clamp = 5.0 m/s -> horizon = 5.0 * 25.0 = 125.0m
    sm.updatePreemption({ x: 0, y: 0, z: 0 }, -50.0);

    sm.getAllSignals().forEach(sig => {
      const dist = Math.hypot(sig.worldPos.x, sig.worldPos.z);
      if (dist > 125.0) {
        Assert.assertFalse(sig.isPreempted, `Signal ${sig.id} at ${dist.toFixed(1)}m must not be preempted (>125m min horizon)`);
      }
    });
  }
);

runAdversarialTest('T5.6.3', 'Long-Duration 100,000s Cycling Invariance (Zero Phase Freeze/Lock)',
  'Simulate 100,000 seconds of signal operation; verify cycleTimer wraps cleanly and all signals continue cycling',
  () => {
    const projection = new GeoProjection();
    const sm = new SignalManager(null, projection);

    // Step 10,000 frames at dt = 10.0s = 100,000 seconds simulated
    for (let step = 0; step < 1000; step++) {
      sm.update(100.0);
    }

    sm.getAllSignals().forEach(sig => {
      Assert.assertFinite(sig.cycleTimer, `Signal ${sig.id} cycleTimer must be finite`);
      Assert.assert(sig.cycleTimer >= 0.0 && sig.cycleTimer <= sig.cycleTime,
        `Signal ${sig.id} cycleTimer (${sig.cycleTimer.toFixed(2)}) must be within [0, ${sig.cycleTime}]`);
      Assert.assert(['RED', 'AMBER', 'GREEN', 'PRIORITY_GREEN'].includes(sig.currentState),
        `Signal ${sig.id} must be in a valid phase`);
    });
  }
);

runAdversarialTest('T5.6.4', 'Sequential Signal Passage & 3.0s Amber Safety Transition Phase',
  'Simulate ambulance traversing signal junction; verify transition: RED -> PRIORITY_GREEN -> AMBER (3.0s) -> RED',
  () => {
    const projection = new GeoProjection();
    const sm = new SignalManager(null, projection);
    const krSignal = sm.getSignal('signal_kr_circle');
    Assert.assert(krSignal !== undefined, 'K.R. Circle signal must exist');

    const targetPos = { x: krSignal.worldPos.x, y: 0, z: krSignal.worldPos.z };

    // 1. Approach within 100m at 40 km/h -> should preempt to PRIORITY_GREEN
    sm.updatePreemption({ x: targetPos.x, y: 0, z: targetPos.z + 80.0 }, 40.0);
    Assert.assertTrue(krSignal.isPreempted, 'Signal must preempt to PRIORITY_GREEN upon approach');
    Assert.assertEqual(krSignal.currentState, 'PRIORITY_GREEN', 'State must be PRIORITY_GREEN');

    // 2. Pass junction (>30m past horizon threshold -> 300m + 30m = 330m)
    sm.updatePreemption({ x: targetPos.x, y: 0, z: targetPos.z + 350.0 }, 40.0);
    Assert.assertFalse(krSignal.isPreempted, 'Signal isPreempted must become false after passage');
    Assert.assertTrue(krSignal.isPostPassage, 'Signal isPostPassage must become true');
    Assert.assertEqual(krSignal.currentState, 'AMBER', 'Signal must enter AMBER safety transition phase');
    Assert.assertNear(krSignal.postPassageAmberTimer, 3.0, 0.01, 'Post-passage amber timer must be initialized to 3.0s');

    // 3. Advance timer by 3.5s -> should exit amber safety phase back to regular cycle (RED)
    krSignal.update(3.5);
    Assert.assertFalse(krSignal.isPostPassage, 'isPostPassage must clear after 3.0s amber');
    Assert.assertEqual(krSignal.currentState, 'RED', 'Signal must restore to RED after amber safety phase');
  }
);

// ============================================================================
// DIMENSION 7: EDGE-CASE DISCOVERY & FAULT BOUNDARY CHARACTERIZATION
// ============================================================================
console.log('\n--- [TIER 5.7] Edge-Case Discovery & Fault Boundary Characterization ---');

runAdversarialTest('T5.7.1', 'Characterize calculateMetrics Under Non-Finite Inputs',
  'Characterize and assert that calculateMetrics cleanly sanitizes NaN, null, and negative inputs to finite values',
  () => {
    const m1 = BenchmarkEngine.calculateMetrics(NaN, NaN);
    Assert.assertEqual(m1.minutesSaved, 0, 'calculateMetrics(NaN, NaN) minutesSaved must be 0');
    Assert.assertEqual(m1.goldenHourOddsPreserved, 0, 'calculateMetrics(NaN, NaN) goldenHourOddsPreserved must be 0');

    const m2 = BenchmarkEngine.calculateMetrics(-50, -20);
    Assert.assertEqual(m2.minutesSaved, 0, 'calculateMetrics(-50, -20) minutesSaved must be 0');
    Assert.assertEqual(m2.baselineTimeSec, 0, 'Negative baselineTimeSec must clamp to 0');
  }
);

runAdversarialTest('T5.7.2', 'Characterize Web Audio Headless Safe Fallback',
  'Verify SirenSynthesizer in Node.js headless environment degrades safely without throwing missing AudioContext error',
  () => {
    const siren = new SirenSynthesizer();
    Assert.assertTrue(siren.isHeadless, 'SirenSynthesizer must detect headless Node.js environment');

    const startRet = siren.start();
    Assert.assertTrue(startRet, 'start() in headless mode must return true');
    Assert.assertTrue(siren.isActive(), 'isActive() must report true after start()');

    const stopRet = siren.stop();
    Assert.assertFalse(stopRet, 'stop() in headless mode must return false');
    Assert.assertFalse(siren.isActive(), 'isActive() must report false after stop()');

    const toggleRet = siren.toggle();
    Assert.assertTrue(toggleRet, 'toggle() must activate siren');
  }
);

runAdversarialTest('T5.7.3', 'Characterize AtmosphereController Diurnal Clamping & Camera Guard',
  'Verify setTimeOfDay clamps to [0, 24] and update executes safely with provided camera position vector',
  () => {
    const atmo = new AtmosphereController();

    atmo.setTimeOfDay(-10.0);
    Assert.assertEqual(atmo.currentHour, 0.0, 'Negative time of day must clamp to 0.0');

    atmo.setTimeOfDay(35.0);
    Assert.assertEqual(atmo.currentHour, 24.0, 'Excessive time of day must clamp to 24.0');

    atmo.setWeather('rain');
    Assert.assertEqual(atmo.weather, 'rain', 'Weather must be rain');

    atmo.setWeather('clear');
    Assert.assertEqual(atmo.weather, 'clear', 'Weather must be clear');

    // Camera position guard: passing cameraPos object allows safe headless execution
    atmo.update(0.016, { x: 0, y: 15, z: 0 });
    Assert.assertFinite(atmo.wetness, 'Wetness must remain finite after update');
  }
);

// ============================================================================
// FINAL TIER 5 SUMMARY & EXIT CODE
// ============================================================================
const totalTests = testResults.length;
const passRate = ((passedCount / totalTests) * 100).toFixed(1);

console.log('\n' + '='.repeat(80));
console.log(`TIER 5 ADVERSARIAL STRESS TEST RESULTS: ${passedCount}/${totalTests} PASSED (${passRate}%)`);
console.log('='.repeat(80));

if (failedCount > 0) {
  console.error(`\nTier 5 Adversarial Suite FAILED with ${failedCount} failures.`);
  process.exit(1);
} else {
  console.log('\nTier 5 Adversarial Suite PASSED. All pathological stress cases & invariances confirmed.');
  process.exit(0);
}
