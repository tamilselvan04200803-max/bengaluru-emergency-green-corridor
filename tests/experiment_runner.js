/**
 * tests/experiment_runner.js
 * Stage 4 — A/B/C/D experiment runner (Node CLI).
 *
 * Runs the controlled four-mode comparison over the real Bengaluru corridors
 * defined in SCENARIOS below, prints the raw metrics table, and can write JSON
 * and CSV exports. The same scenario configs are consumed by
 * tests/test_stage4_experiment.js; the export helpers are designed to be wired
 * to a browser download button in Stage 5.
 *
 *   node tests/experiment_runner.js                 # default 3-seed matrix
 *   node tests/experiment_runner.js --json out.json # also write JSON
 *   node tests/experiment_runner.js --csv  out.csv  # also write CSV
 *   node tests/experiment_runner.js --seed 42       # single seed
 *   node tests/experiment_runner.js --scenario reroutable_congestion
 *
 * Node only, no dependencies.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const experiment = require(path.join(ROOT, 'js/experiment.js'));

// Real network nodes the platform routes between. Victoria Hospital's ingress
// gate is the corridor's destination in most scenarios because the task names
// it, and because it is genuinely signalised (signal_victoria_hospital_gate is
// the signal at the node the final approach edge feeds).
const VICTORIA_GATE = 'node_victoria_hospital_gate';
const VICTORIA = 'hosp_victoria_01';

// The route Majestic -> Victoria Hospital is: edge_kg_01 -> edge_kg_02 ->
// edge_avenue_01 -> edge_fort_victoria_01. The only genuine parallel corridor
// into the Victoria / KR Market area is the N.R. Road / Fort Victoria approach
// off K.R. Market junction, which is exactly what makes `edge_avenue_01_fwd` a
// real bottleneck with a real bypass. Scenarios inject congestion only on edges
// the ambulance has *not yet* reached, so the router has a decision to make.
//
// Ambulance progress on this route (seed 42, peak, no incidents):
//   t~0-110s   edge_kg_01_fwd
//   t~110-155s edge_kg_02_fwd
//   t~155-292s edge_avenue_01_fwd
//   t~292-400s edge_fort_victoria_01_fwd
const SCENARIOS = [
  {
    // No injected congestion. The reference corridor: crossing three signalised
    // junctions on the way in, so Tier-2 preemption has something to act on.
    name: 'peak_signalised_corridor',
    origin: 'node_majestic',
    destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE,
    demandProfile: 'peak',
    durationSec: 900,
  },
  {
    // The headline comparable case: severe but non-blocking congestion on
    // Avenue Road, injected at t=120s while the ambulance is still on the
    // preceding Kempegowda edge. Avenue Road is the corridor's real bottleneck
    // (K.R. Market junction has the N.R. Road bypass), so the router has a
    // genuine alternative to weigh and both A and B reach the hospital.
    name: 'severe_congestion_avenue_road',
    origin: 'node_majestic',
    destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE,
    demandProfile: 'peak',
    durationSec: 900,
    congestionEvents: [
      { atSec: 120, edgeId: 'edge_avenue_01_fwd', speedFactor: 0.12 },
    ],
  },
  {
    // Harder case: Avenue Road is fully blocked. With the only inbound arterial
    // from K.R. Market severed, the baseline cannot finish inside the window and
    // is reported as DNF_TIMEOUT rather than being quietly dropped. This is the
    // honest "the intervention is the difference between arriving and not" case,
    // and it is why DNF is a first-class outcome in the metrics.
    name: 'blocked_primary_corridor',
    origin: 'node_majestic',
    destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE,
    demandProfile: 'peak',
    durationSec: 900,
    congestionEvents: [
      { atSec: 120, edgeId: 'edge_avenue_01_fwd', blocked: true },
    ],
  },
  {
    // Honesty control: a real but modest slowdown on the second edge. The
    // degradation is genuine and measurable, but well short of the 20 s Tier-1
    // threshold, so a correct router must NOT reroute. If Mode B reports a
    // saving here, the harness is crediting a win that did not happen.
    name: 'mild_congestion_below_threshold',
    origin: 'node_majestic',
    destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE,
    demandProfile: 'peak',
    durationSec: 900,
    congestionEvents: [
      { atSec: 60, edgeId: 'edge_kg_02_fwd', speedFactor: 0.6 },
    ],
  },
];

const SEEDS = [42, 123, 777];

function parseArgs(argv) {
  const out = { json: null, csv: null, seeds: SEEDS.slice(), scenarios: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') { out.json = argv[++i]; }
    else if (a === '--csv') { out.csv = argv[++i]; }
    else if (a === '--seed') { out.seeds = [parseInt(argv[++i], 10)]; }
    else if (a === '--scenario') { out.scenarios = [argv[++i]]; }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = args.scenarios
    ? SCENARIOS.filter((s) => args.scenarios.includes(s.name))
    : SCENARIOS;

  const results = [];
  for (const base of scenarios) {
    for (const seed of args.seeds) {
      const scenario = Object.assign({}, base, { seed });
      const t0 = Date.now();
      const result = experiment.runComparison(scenario);
      result.wallClockMs = Date.now() - t0;
      results.push(result);
      process.stdout.write(experiment.formatTable(result) + '\n');
      process.stdout.write('  wallClock=' + result.wallClockMs + 'ms\n');
    }
  }

  if (args.json) {
    fs.writeFileSync(args.json, experiment.toJSON(results), 'utf8');
    console.log('\nWrote JSON: ' + args.json);
  }
  if (args.csv) {
    fs.writeFileSync(args.csv, experiment.toCSV(results), 'utf8');
    console.log('Wrote CSV:  ' + args.csv);
  }
  return results;
}

if (require.main === module) {
  main();
}

module.exports = { SCENARIOS, SEEDS, main };
