/**
 * Headless CLI Test Runner for Bengaluru Emergency Green Corridor 3D Digital Twin
 * Zero external build requirements. Runs in Node.js.
 */

const TestSuite = require('./test_suite.js');

console.log('='.repeat(80));
console.log('BENGALURU EMERGENCY GREEN CORRIDOR 3D DIGITAL TWIN — E2E TEST RUNNER');
console.log('='.repeat(80));
console.log(`Execution Timestamp: ${new Date().toISOString()}`);
console.log(`Environment: Node.js ${process.version}`);
console.log('-'.repeat(80));

const report = TestSuite.runAll();

// Group results by tier
const tierGroups = { 1: [], 2: [], 3: [], 4: [] };
report.results.forEach(r => {
  tierGroups[r.tier].push(r);
});

const tierNames = {
  1: 'Tier 1: Feature Coverage (R1-R4 Base Requirements)',
  2: 'Tier 2: Boundary & Corner Cases (Extremes & Clamping)',
  3: 'Tier 3: Cross-Feature Interactions (Coupled Subsystems)',
  4: 'Tier 4: Real-World Scenarios (End-to-End Corridor Transit)'
};

for (const [tier, list] of Object.entries(tierGroups)) {
  const passed = list.filter(r => r.passed).length;
  const total = list.length;
  console.log(`\n--- [TIER ${tier}] ${tierNames[tier]} ---`);
  list.forEach(r => {
    const symbol = r.passed ? '✓' : '✗';
    const tag = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${r.id} (${r.durationMs}ms) — ${r.name}`);
    if (!r.passed) {
      console.error(`         ERROR: ${r.error}`);
    }
  });
  console.log(`  > Summary: ${passed}/${total} passed`);
}

console.log('\n' + '='.repeat(80));
console.log(`FINAL RESULT: ${report.passedCount}/${report.totalTests} PASSED (${report.passRatePercent}%) in ${report.totalDurationMs}ms`);
console.log('='.repeat(80));

if (report.failedCount > 0) {
  console.error(`\nTest suite FAILED with ${report.failedCount} failures.`);
  process.exit(1);
} else {
  console.log('\nTest suite PASSED. All requirement contracts verified.');
  process.exit(0);
}
