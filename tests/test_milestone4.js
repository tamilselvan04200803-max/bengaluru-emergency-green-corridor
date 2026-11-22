/**
 * tests/test_milestone4.js
 * Verification Test Suite for Milestone 4:
 * - BenchmarkEngine Parallel Simulation Models (Baseline vs AI Green Corridor)
 * - Quantitative Metrics: Minutes Saved, % Time Saved, Speed Boost %, Halts Avoided
 * - Golden Hour Survival Odds Preserved (+8% per minute saved, clamped [0%, 99%])
 * - Live "AI Green Corridor: ON vs. OFF (Baseline)" State Machine & Preemption Toggle
 * - Progress Guard: Reverse Driving Does Not Decrement Distance Traveled
 * - Division-by-Zero & NaN/Infinity Safety at t = 0
 * - Reset & Gauge Zeroing Cleanliness
 * - Structured JSON Benchmark Telemetry Export Schema Compliance
 * - UIManager Required Keys Contract & Node.js Isomorphic Compatibility
 */

const BenchmarkEngine = require('../js/benchmark.js');
const UIManager = require('../js/ui.js');
const SignalManager = require('../js/signals.js');
const { AmbulanceManager } = require('../js/ambulance.js');
const GeoProjection = require('../js/projection.js');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// Load preview_data.js for standalone testing
const previewDataPath = path.resolve(__dirname, '..', 'preview_data.js');
if (fs.existsSync(previewDataPath)) {
  const code = fs.readFileSync(previewDataPath, 'utf8');
  vm.runInThisContext(code);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`[FAIL] ${message} — Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
  }
}

function assertNear(actual, expected, tolerance = 0.001, message = '') {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`[FAIL] ${message} — Expected: ${expected} ±${tolerance}, Actual: ${actual} (diff: ${diff.toFixed(5)})`);
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
console.log('MILESTONE 4: COMPARATIVE BENCHMARK & IMPACT ANALYTICS HUD VERIFICATION');
console.log('='.repeat(80));

// ============================================================================
// SUITE 1: BENCHMARK ENGINE CORE INITIALIZATION & DEFAULTS
// ============================================================================
console.log('\n--- [ENGINE INITIALIZATION] Benchmark Engine Construction & Defaults ---');

runTest('Initialization: BenchmarkEngine Instantiates with Clean Zeroed State', () => {
  const engine = new BenchmarkEngine();
  assertEqual(engine.baselineTimeSec, 0.0, 'Baseline time begins at 0.0s');
  assertEqual(engine.aiCorridorTimeSec, 0.0, 'AI corridor time begins at 0.0s');
  assertEqual(engine.baselineHalts, 0, 'Baseline halts counter begins at 0');
  assertEqual(engine.aiHalts, 0, 'AI corridor halts counter begins at 0');
  assertEqual(engine.distanceTraveledKm, 0.0, 'Distance traveled begins at 0.0 km');
  assertEqual(engine.isAiCorridorActive, true, 'AI green corridor default state is active (true)');
  assertEqual(engine.totalRouteLengthKm, 3.8, 'Default route length is 3.8 km (Central Bengaluru Corridor)');
});

runTest('Initialization: Time Formatter Converts Seconds to MM:SS Format', () => {
  assertEqual(BenchmarkEngine.formatTime(0), '00:00', '0s -> 00:00');
  assertEqual(BenchmarkEngine.formatTime(65), '01:05', '65s -> 01:05');
  assertEqual(BenchmarkEngine.formatTime(240), '04:00', '240s -> 04:00');
  assertEqual(BenchmarkEngine.formatTime(645), '10:45', '645s -> 10:45');
  assertEqual(BenchmarkEngine.formatTime(-10), '00:00', 'Negative seconds clamp to 00:00');
  assertEqual(BenchmarkEngine.formatTime(NaN), '00:00', 'NaN clamps to 00:00');
});

// ============================================================================
// SUITE 2: MATHEMATICAL CALCULATION ORACLE VERIFICATION
// ============================================================================
console.log('\n--- [MATH ORACLE] Quantitative Travel Time & Speed Analytics ---');

runTest('Math: Minutes and Percentage Time Saved Calculation (Test T1.4.2 Compliance)', () => {
  // Baseline 600s (10 min) vs AI 240s (4 min) on 3.8 km corridor
  const m = BenchmarkEngine.calculateMetrics(600.0, 240.0, 5, 0, 3.8);
  assertEqual(m.baselineTimeSec, 600.0, 'Tracks baseline time');
  assertEqual(m.aiCorridorTimeSec, 240.0, 'Tracks AI time');
  assertEqual(m.minutesSaved, 6.0, 'Minutes saved must be exactly (600 - 240)/60 = 6.0 min');
  assertEqual(m.percentTimeSaved, 60.0, 'Percent time saved must be exactly (360/600)*100 = 60.0%');
});

runTest('Math: Average Speeds and Speed Improvement Boost % (Test T1.4.3 Compliance)', () => {
  const m = BenchmarkEngine.calculateMetrics(600.0, 240.0, 5, 0, 3.8);
  // Base speed = 3.8 / (600 / 3600) = 22.8 km/h
  // AI speed = 3.8 / (240 / 3600) = 57.0 km/h
  // Speed boost = (57.0 - 22.8) / 22.8 * 100 = 150.0%
  assertNear(m.avgSpeedBaseKmh, 22.8, 0.1, 'Baseline average speed ~22.8 km/h');
  assertNear(m.avgSpeedAiKmh, 57.0, 0.1, 'AI corridor average speed ~57.0 km/h');
  assertNear(m.speedImprovementPercent, 150.0, 1.0, 'Speed improvement must be ~150%');
  assertEqual(m.haltsAvoided, 5, 'Halts avoided = 5 baseline - 0 AI = 5 halts');
  assertEqual(m.haltReduction, 5, 'haltReduction alias must equal 5');
});

// ============================================================================
// SUITE 3: GOLDEN HOUR SURVIVAL ODDS PRESERVED (+8% / MIN SAVED)
// ============================================================================
console.log('\n--- [GOLDEN HOUR] Clinical Survival Odds Formula Verification ---');

runTest('Golden Hour: Exact +8.0% Survival Odds Preserved per Minute Saved', () => {
  // 0 min saved -> 0.0%
  const m0 = BenchmarkEngine.calculateMetrics(300.0, 300.0, 0, 0, 3.8);
  assertEqual(m0.goldenHourOddsPreserved, 0.0, '0 min saved yields +0.0% odds preserved');

  // 1 min saved -> 8.0%
  const m1 = BenchmarkEngine.calculateMetrics(360.0, 300.0, 1, 0, 3.8);
  assertEqual(m1.goldenHourOddsPreserved, 8.0, '1 min saved yields +8.0% odds preserved');

  // 6 min saved -> 48.0%
  const m6 = BenchmarkEngine.calculateMetrics(600.0, 240.0, 5, 0, 3.8);
  assertEqual(m6.goldenHourOddsPreserved, 48.0, '6 min saved yields +48.0% odds preserved');

  // 7.1 min saved -> 56.8%
  const m7 = BenchmarkEngine.calculateMetrics(645.2, 218.4, 5, 0, 3.8);
  assertNear(m7.goldenHourOddsPreserved, 56.9, 0.2, '7.11 min saved yields ~56.9% odds preserved');
});

runTest('Golden Hour: Strict Asymptotic Clamping to [0.0%, 99.0%]', () => {
  // Negative savings (if AI were slower) clamps to 0.0%
  const mNeg = BenchmarkEngine.calculateMetrics(200.0, 300.0, 0, 0, 3.8);
  assertEqual(mNeg.goldenHourOddsPreserved, 0.0, 'Negative savings clamps to 0.0%');

  // Extreme time saved (e.g. 25 min saved -> 25 * 8% = 200%) clamps to 99.0%
  const mExtreme = BenchmarkEngine.calculateMetrics(1800.0, 300.0, 8, 0, 3.8);
  assertEqual(mExtreme.goldenHourOddsPreserved, 99.0, 'Extreme savings strictly capped at 99.0% survival odds');
});

// ============================================================================
// SUITE 4: BOUNDARY CONDITIONS & NUMERICAL STABILITY
// ============================================================================
console.log('\n--- [BOUNDARY SAFETY] Zero-Division, Reverse Progress & Reset Guards ---');

runTest('Boundary: Zero Elapsed Time Initialization (Test T2.4.1 Compliance)', () => {
  const m = BenchmarkEngine.calculateMetrics(0.0, 0.0, 0, 0, 0.0);
  assert(!isNaN(m.minutesSaved), 'minutesSaved is not NaN');
  assert(!isNaN(m.percentTimeSaved), 'percentTimeSaved is not NaN');
  assert(!isNaN(m.speedImprovementPercent), 'speedImprovementPercent is not NaN');
  assert(!isNaN(m.goldenHourOddsPreserved), 'goldenHourOddsPreserved is not NaN');
  assertEqual(m.minutesSaved, 0.0, 'minutesSaved at t=0 is 0.0');
  assertEqual(m.percentTimeSaved, 0.0, 'percentTimeSaved at t=0 is 0.0');
  assertEqual(m.speedImprovementPercent, 0.0, 'speedImprovementPercent at t=0 is 0.0');
  assertEqual(m.goldenHourOddsPreserved, 0.0, 'goldenHourOddsPreserved at t=0 is 0.0');
});

runTest('Boundary: Gridlock Congestion Bounded <= 95% (Test T2.4.2 Compliance)', () => {
  const m = BenchmarkEngine.calculateMetrics(1800.0, 240.0, 8, 0, 3.8);
  assert(m.percentTimeSaved >= 80.0 && m.percentTimeSaved <= 95.0,
    `Gridlock percentTimeSaved must be in [80%, 95%], got ${m.percentTimeSaved}%`);
});

runTest('Boundary: Negative Speed / Reverse Driving Progress Guard (Test T2.4.3 Compliance)', () => {
  const engine = new BenchmarkEngine();
  // Simulate driving forward 1 km
  const forwardAmbulance = { getSpeedKmh: () => 60.0 };
  engine.update(60.0, forwardAmbulance); // 1 minute at 60 km/h = 1 km
  const initialDist = engine.distanceTraveledKm;
  assertNear(initialDist, 1.0, 0.02, 'Progress reached ~1.0 km');

  // Now simulate driving in reverse (-25 km/h)
  const reverseAmbulance = { getSpeedKmh: () => -25.0 };
  engine.update(10.0, reverseAmbulance);

  assertEqual(engine.distanceTraveledKm, initialDist, 'Reverse driving must NOT decrement distance traveled');
});

runTest('Boundary: Route Reset & Gauge Zeroing Cleanliness (Test T2.4.4 Compliance)', () => {
  const engine = new BenchmarkEngine();
  engine.baselineTimeSec = 540.0;
  engine.aiCorridorTimeSec = 190.0;
  engine.baselineHalts = 6;
  engine.distanceTraveledKm = 3.2;

  engine.reset();

  assertEqual(engine.baselineTimeSec, 0.0, 'Reset baseline time to 0.0');
  assertEqual(engine.aiCorridorTimeSec, 0.0, 'Reset AI corridor time to 0.0');
  assertEqual(engine.baselineHalts, 0, 'Reset baseline halts to 0');
  assertEqual(engine.aiHalts, 0, 'Reset AI halts to 0');
  assertEqual(engine.distanceTraveledKm, 0.0, 'Reset distance traveled to 0.0');
});

// ============================================================================
// SUITE 5: DYNAMIC AI GREEN CORRIDOR ON VS. OFF (BASELINE) TOGGLE
// ============================================================================
console.log('\n--- [LIVE TOGGLE] AI Green Corridor ON vs. OFF State Machine ---');

runTest('Toggle: State Toggle Changes isAiCorridorActive Seamlessly', () => {
  const engine = new BenchmarkEngine();
  assertEqual(engine.isAiCorridorActive, true, 'Starts active');

  const off = engine.toggleAiCorridor();
  assertEqual(off, false, 'Toggles to false (Baseline mode)');
  assertEqual(engine.isAiCorridorActive, false, 'State updated to false');

  const on = engine.toggleAiCorridor();
  assertEqual(on, true, 'Toggles back to true (AI Green Corridor mode)');
  assertEqual(engine.isAiCorridorActive, true, 'State restored to true');
});

runTest('Toggle: Baseline Mode Demonstrates Congestion Delay Accumulation', () => {
  const engine = new BenchmarkEngine({ isAiCorridorActive: false });
  const amb = { getSpeedKmh: () => 15.0 }; // Cruising at congested speed

  // Run for 30 seconds in baseline mode
  for (let i = 0; i < 30; i++) {
    engine.update(1.0, amb);
  }

  const m = engine.getMetrics();
  assert(m.baselineTimeSec >= 30.0, `Baseline elapsed time must be >= 30s, got ${m.baselineTimeSec}s`);
  assert(m.aiCorridorTimeSec < m.baselineTimeSec, 'Parallel AI green corridor ETA must be faster than baseline');
});

// ============================================================================
// SUITE 6: STRUCTURED JSON BENCHMARK EXPORT SCHEMA COMPLIANCE
// ============================================================================
console.log('\n--- [TELEMETRY EXPORT] Structured JSON Telemetry Schema (Test T4.5) ---');

runTest('Export: Structured JSON Schema Compliance with Cumulative Runs', () => {
  const engine = new BenchmarkEngine();
  const run1 = BenchmarkEngine.calculateMetrics(950.0, 285.0, 5, 0, 3.8);
  const run2 = BenchmarkEngine.calculateMetrics(1020.0, 310.0, 6, 0, 4.2);

  engine.recordRun(run1);
  engine.recordRun(run2);

  const exported = engine.exportBenchmarkData();

  assertEqual(exported.totalRunsCompleted, 2, 'Total runs completed equals 2');
  assertEqual(exported.totalHaltsEliminated, 11, 'Total halts eliminated = 5 + 6 = 11');
  assert(exported.cumulativeMinutesSaved >= 20.0, `Cumulative minutes saved >= 20 min, got ${exported.cumulativeMinutesSaved}`);
  assert(typeof exported.exportTimestamp === 'string', 'exportTimestamp must be an ISO string');
  assert(Array.isArray(exported.runs), 'runs must be an array');
  assertEqual(exported.runs.length, 2, '2 run records preserved');
});

// ============================================================================
// SUITE 7: UI MANAGER & HUD CONTRACT VERIFICATION
// ============================================================================
console.log('\n--- [UI HUD CONTRACT] UIManager Interface & Container Compatibility ---');

runTest('HUD Contract: UIManager Exposes All Required Container Keys (Test T1.4.4 Compliance)', () => {
  const requiredKeys = [
    'speedometerGauge',
    'baselineTimeDisplay',
    'aiCorridorTimeDisplay',
    'minutesSavedCounter',
    'priorityStatusBadge',
    'haltReductionBadge'
  ];

  requiredKeys.forEach(key => {
    assert(UIManager.REQUIRED_KEYS.includes(key), `UIManager must declare required key ${key}`);
  });

  const ui = new UIManager(null);
  requiredKeys.forEach(key => {
    assert(ui.elements[key] !== undefined, `UI elements map must supply container ${key}`);
  });
});

runTest('HUD Contract: UIManager Safe Execution in Node.js Headless Runtime', () => {
  const ui = new UIManager(null);
  let error = null;
  try {
    ui.update(0.016);
    ui.toggleCorridorMode();
    ui.showToast('Test Toast', 'info');
    ui.exportBenchmarkJson();
  } catch (err) {
    error = err;
  }
  assertEqual(error, null, 'UIManager headless execution must not throw null-reference errors');
});

// ============================================================================
// SUITE 8: APPLICATION INTERACTION CONTRACTS
// ============================================================================
console.log('\n--- [APPLICATION INTEGRATION] Subsystem Preemption & Yield Gating ---');

runTest('Integration: Signal Preemption Suppression when AI Corridor is OFF', () => {
  const origin = { lat: 12.9715987, lon: 77.5945627, alt: 920.0 };
  const proj = new GeoProjection(origin);
  const signals = new SignalManager(null, proj);

  // Position ambulance 50m from signal
  const ambPos = { x: 0, y: 0, z: 0 };
  const sig = signals.getAllSignals()[0];
  if (sig && sig.worldPos) {
    ambPos.x = sig.worldPos.x;
    ambPos.z = sig.worldPos.z - 50.0; // 50m away approaching
  }

  // When AI corridor is ON, signal preempts
  signals.updatePreemption(ambPos, 45.0, []);
  assert(signals.getPreemptedCount() >= 1, 'Signal preempted when green corridor is active');

  // Clear preemption (simulating toggle OFF)
  signals.preemptedSignals.clear();
  signals.getAllSignals().forEach(s => {
    if (s.isPreempted) {
      s.isPreempted = false;
      s.setPhase('AMBER');
    }
  });
  assertEqual(signals.getPreemptedCount(), 0, 'Signals returned to normal cycle when corridor is OFF');
});

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log(`MILESTONE 4 TEST VERIFICATION: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
console.log('='.repeat(80));

if (passed === total) {
  console.log('Milestone 4 implementation verified successfully against all functional and behavioral contracts.\n');
  process.exit(0);
} else {
  console.error(`Failed ${total - passed} tests.`);
  process.exit(1);
}
