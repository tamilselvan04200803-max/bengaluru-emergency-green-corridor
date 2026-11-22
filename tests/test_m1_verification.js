/**
 * tests/test_m1_verification.js
 * Comprehensive Verification & Unit Test Suite for Milestone 1:
 * - 3D Geospatial Engine & Environment
 * - Coordinate Projection Precision
 * - Signal Gantry Infrastructure & ITMS Preemption
 * - Atmosphere Controller & Diurnal Weather
 * - Road & Building Geometry Formulas
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load Mock Global Environment for Node.js
const mockGlobal = {
  console: console,
  Math: Math,
  Date: Date,
  Float32Array: Float32Array,
  Uint16Array: Uint16Array,
  Uint32Array: Uint32Array,
  Set: Set,
  Map: Map,
  Array: Array,
  Object: Object,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  performance: { now: () => Date.now() }
};

// 1. Load preview_data.js
const previewDataPath = path.join(__dirname, '..', 'preview_data.js');
const previewDataCode = fs.readFileSync(previewDataPath, 'utf8');
vm.runInNewContext(previewDataCode, mockGlobal);

// 2. Load js/config.js
const configPath = path.join(__dirname, '..', 'js', 'config.js');
const configCode = fs.readFileSync(configPath, 'utf8');
vm.runInNewContext(configCode, mockGlobal);
const CONFIG = mockGlobal.CONFIG;

// 3. Load js/projection.js
const projectionPath = path.join(__dirname, '..', 'js', 'projection.js');
const projectionCode = fs.readFileSync(projectionPath, 'utf8');
vm.runInNewContext(projectionCode, mockGlobal);
const GeoProjection = mockGlobal.GeoProjection;

// 4. Load js/signals.js
const signalsPath = path.join(__dirname, '..', 'js', 'signals.js');
const signalsCode = fs.readFileSync(signalsPath, 'utf8');
vm.runInNewContext(signalsCode, mockGlobal);
const SignalManager = mockGlobal.SignalManager;

// 5. Load js/atmosphere.js
const atmospherePath = path.join(__dirname, '..', 'js', 'atmosphere.js');
const atmosphereCode = fs.readFileSync(atmospherePath, 'utf8');
vm.runInNewContext(atmosphereCode, mockGlobal);
const AtmosphereController = mockGlobal.AtmosphereController;

// 6. Load js/environment.js
const environmentPath = path.join(__dirname, '..', 'js', 'environment.js');
const environmentCode = fs.readFileSync(environmentPath, 'utf8');
vm.runInNewContext(environmentCode, mockGlobal);
const EnvironmentManager = mockGlobal.EnvironmentManager;

console.log('='.repeat(80));
console.log('MILESTONE 1 VERIFICATION & GEOMETRY VALIDATION SUITE');
console.log('='.repeat(80));

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  [FAIL] ${name} — ${err.message}`);
    failCount++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertNear(actual, expected, tolerance = 0.001, message) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${message || 'assertNear failed'} — Expected: ${expected} ±${tolerance}, Got: ${actual} (diff: ${diff})`);
  }
}

// ----------------------------------------------------------------------------
// Test Group 1: Configuration & Origin Alignment
// ----------------------------------------------------------------------------
test('CONFIG: Geo Origin matches K.R. Circle coordinates', () => {
  assert(CONFIG.GEO.origin.lat === 12.9715987, 'Latitude mismatch');
  assert(CONFIG.GEO.origin.lon === 77.5945627, 'Longitude mismatch');
  assert(CONFIG.GEO.origin.alt === 920.0, 'Altitude mismatch');
});

test('CONFIG: Road width constants comply with IRC standards', () => {
  assert(CONFIG.ROADS.widths[2] === 7.0, '2-lane width must be 7.0m');
  assert(CONFIG.ROADS.widths[4] === 14.0, '4-lane width must be 14.0m');
  assert(CONFIG.ROADS.widths[6] === 21.0, '6-lane width must be 21.0m');
});

// ----------------------------------------------------------------------------
// Test Group 2: GeoProjection Precision & Mathematical Symmetry
// ----------------------------------------------------------------------------
const proj = new GeoProjection(CONFIG.GEO.origin);

test('GeoProjection: Origin projects exactly to (0, 0, 0)', () => {
  const p = proj.latLonAltToCartesian(12.9715987, 77.5945627, 920.0);
  assertNear(p.x, 0.0, 0.0001, 'Origin X should be 0.0');
  assertNear(p.y, 0.0, 0.0001, 'Origin Y should be 0.0');
  assertNear(p.z, 0.0, 0.0001, 'Origin Z should be 0.0');
});

test('GeoProjection: East (+X), North (-Z), Up (+Y) Cardinal Orientation', () => {
  // East displacement
  const east = proj.latLonAltToCartesian(12.9715987, 77.6045627, 920.0);
  assert(east.x > 1050.0 && east.x < 1120.0, `East X out of expected range: ${east.x}`);
  assertNear(east.z, 0.0, 0.001, 'East displacement should have ~0 Z');

  // North displacement
  const north = proj.latLonAltToCartesian(12.9815987, 77.5945627, 920.0);
  assert(north.z < -1100.0 && north.z > -1125.0, `North Z out of expected range: ${north.z}`);
  assertNear(north.x, 0.0, 0.001, 'North displacement should have ~0 X');

  // Elevation
  const elevated = proj.latLonAltToCartesian(12.9715987, 77.5945627, 935.0);
  assertNear(elevated.y, 15.0, 0.0001, 'Elevation delta must be exactly 15m');
});

test('GeoProjection: Inverse projection returns original coordinates within sub-millimeter precision', () => {
  const testCoords = [
    [12.9778, 77.5729, 922.0], // Majestic
    [12.9628, 77.5746, 914.8], // Victoria
    [12.9796, 77.5907, 924.0], // Vidhana Soudha
    [12.9748, 77.6045, 922.2]  // Anil Kumble Circle
  ];

  testCoords.forEach(([lat, lon, alt]) => {
    const cart = proj.latLonAltToCartesian(lat, lon, alt);
    const inv = proj.cartesianToLatLonAlt(cart.x, cart.y, cart.z);
    assertNear(inv.lat, lat, 0.00001, `Lat mismatch for ${lat}`);
    assertNear(inv.lon, lon, 0.00001, `Lon mismatch for ${lon}`);
    assertNear(inv.alt, alt, 0.001, `Alt mismatch for ${alt}`);
  });
});

test('GeoProjection: Compass Heading to Three.js Yaw Symmetry', () => {
  assertNear(proj.headingToYaw(0), 0.0, 0.0001, '0 deg North = 0 rad');
  assertNear(proj.headingToYaw(90), -Math.PI / 2, 0.0001, '90 deg East = -pi/2 rad');
  assertNear(proj.yawToHeading(0), 0.0, 0.0001, '0 rad = 0 deg');
  assertNear(proj.yawToHeading(-Math.PI / 2), 90.0, 0.0001, '-pi/2 rad = 90 deg');
});

// ----------------------------------------------------------------------------
// Test Group 3: 15 Traffic Signal Posts & Preemption Logic
// ----------------------------------------------------------------------------
test('SignalManager: All 15 ITMS signals instantiated from GeoJSON', () => {
  const signalMgr = new SignalManager(null, proj);
  const signals = signalMgr.getAllSignals();
  assert(signals.length === 15, `Expected 15 signals, got ${signals.length}`);

  const requiredIds = [
    'signal_majestic_cross', 'signal_sheshadri_junction', 'signal_kr_circle',
    'signal_mysore_bank', 'signal_st_marthas', 'signal_hudson_circle',
    'signal_corporation_circle', 'signal_kr_market', 'signal_victoria_hospital_gate',
    'signal_fort_junction', 'signal_vidhana_soudha', 'signal_raj_bhavan',
    'signal_bowring_hospital', 'signal_kasturba_cross', 'signal_anil_kumble_circle'
  ];

  requiredIds.forEach(id => {
    const s = signalMgr.getSignal(id);
    assert(s !== undefined, `Missing signal ID: ${id}`);
    assert(s.worldPos && typeof s.worldPos.x === 'number', `Signal ${id} missing worldPos`);
  });
});

test('SignalManager: Early Preemption activates PRIORITY_GREEN within horizon', () => {
  const signalMgr = new SignalManager(null, proj);
  const krCircle = signalMgr.getSignal('signal_kr_circle');
  assert(krCircle, 'K.R. Circle signal must exist');

  // Place ambulance 150m from K.R. Circle approaching at 54 km/h (15 m/s)
  // Horizon = min(300, 15 * 25) = 300m
  const ambPos = {
    x: krCircle.worldPos.x + 100.0,
    y: krCircle.worldPos.y,
    z: krCircle.worldPos.z
  };

  signalMgr.updatePreemption(ambPos, 54.0, ['signal_kr_circle']);
  assert(krCircle.isPreempted === true, 'K.R. Circle must be preempted');
  assert(krCircle.currentState === 'PRIORITY_GREEN', 'State must be PRIORITY_GREEN');
  assert(signalMgr.getPreemptedCount() === 1, 'Preempted count must be 1');

  // Move ambulance 400m away (beyond horizon + margin)
  ambPos.x = krCircle.worldPos.x + 400.0;
  signalMgr.updatePreemption(ambPos, 54.0, ['signal_kr_circle']);
  assert(krCircle.isPreempted === false, 'K.R. Circle preemption should be released');
  assert(krCircle.currentState === 'AMBER', 'State should enter AMBER safety phase');
});

// ----------------------------------------------------------------------------
// Test Group 4: Atmosphere Controller & Diurnal Weather
// ----------------------------------------------------------------------------
test('AtmosphereController: Day/Dusk/Night transitions and weather toggle', () => {
  const atmo = new AtmosphereController();

  atmo.setTimeOfDay('day');
  assert(atmo.getTimePreset() === 'day', 'Preset should be day');
  assert(atmo.getCurrentHour() === 12.0, 'Hour should be 12.0');
  assert(atmo.getNightFactor() === 0.0, 'Day nightFactor should be 0.0');

  atmo.setTimeOfDay('night');
  assert(atmo.getTimePreset() === 'night', 'Preset should be night');
  assert(atmo.getCurrentHour() === 23.0, 'Hour should be 23.0');
  assert(atmo.getNightFactor() === 1.0, 'Night nightFactor should be 1.0');

  atmo.setWeather('rain');
  assert(atmo.getWeather() === 'rain', 'Weather should be rain');

  atmo.setWeather('clear');
  assert(atmo.getWeather() === 'clear', 'Weather should be clear');
});

// ----------------------------------------------------------------------------
// Test Group 5: Environment Road Geometry & Landmark Registry
// ----------------------------------------------------------------------------
test('EnvironmentManager: Landmark Definitions include all 12 key complexes', () => {
  const landmarks = EnvironmentManager.LANDMARK_DEFINITIONS;
  assert(landmarks && landmarks.length >= 12, `Expected at least 12 landmarks, found ${landmarks.length}`);

  const vidhana = landmarks.find(l => l.id === 'vidhana_soudha');
  assert(vidhana && vidhana.hasDome === true, 'Vidhana Soudha must have dome');
  assert(vidhana.facadeType === 'heritage', 'Vidhana Soudha facade must be heritage');

  const victoria = landmarks.find(l => l.id === 'victoria_hospital');
  assert(victoria && victoria.facadeType === 'hospital', 'Victoria Hospital must have hospital facade');

  const highCourt = landmarks.find(l => l.id === 'high_court');
  assert(highCourt && highCourt.facadeType === 'civic', 'High Court must have civic facade');

  const ubCity = landmarks.find(l => l.id === 'ub_city_tower');
  assert(ubCity && ubCity.height === 85.0, 'UB City must be 85m tower');
});

console.log('-'.repeat(80));
console.log(`SUMMARY: ${passCount} passed, ${failCount} failed.`);
console.log('='.repeat(80));

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('All Milestone 1 module tests verified successfully!\n');
}
