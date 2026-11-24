/**
 * tests/test_stage4_experiment.js
 * Stage 4 acceptance suite: world isolation, mode differentiation, invariant
 * enforcement, the multi-scenario / multi-seed benchmark matrix, bit-identical
 * reproducibility, hospital bay finite occupancy, and the export helpers.
 *
 * Runs against the real integrated stack (network + routing + signals +
 * simulation) via js/experiment.js — no mocks, no fabricated numbers.
 *
 * Node only, no dependencies:  node tests/test_stage4_experiment.js
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const experiment = require(path.join(ROOT, 'js/experiment.js'));
const { SimulationNetwork } = require(path.join(ROOT, 'js/network.js'));
const { SimulationEngine } = require(path.join(ROOT, 'js/simulation.js'));
const routing = require(path.join(ROOT, 'js/routing.js'));
const SignalManager = require(path.join(ROOT, 'js/signals.js'));
const GeoProjection = require(path.join(ROOT, 'js/projection.js'));
const CONFIG = require(path.join(ROOT, 'js/config.js'));

const VICTORIA_GATE = 'node_victoria_hospital_gate';
const VICTORIA = 'hosp_victoria_01';

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passCount += 1;
  } catch (e) {
    console.error(`  [FAIL] ${name} — ${e.message}`);
    failCount += 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ============================================================================
// 1. World isolation & identical initial state
// ============================================================================
test('1. World isolation: A/B/C/D start identical for the same seed', () => {
  const scenario = {
    name: 'isolation', origin: 'node_majestic', destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE, seed: 42, demandProfile: 'peak', durationSec: 60,
  };
  const deps = experiment.resolveDeps();

  const worlds = {};
  for (const id of experiment.MODE_IDS) {
    worlds[id] = experiment.buildWorld(scenario, experiment.MODES[id], deps);
  }

  // --- identical state at t = 0 -----------------------------------------
  const snap0 = {};
  for (const id of experiment.MODE_IDS) {
    const w = worlds[id];
    const veh = w.sim.vehicles.get(w.ambId);
    snap0[id] = {
      vehicleCount: w.sim.vehicles.size,
      edgeId: veh.edge.id,
      s: +veh.s.toFixed(6),
      v: +veh.v.toFixed(6),
      lane: veh.laneIndex,
      route: w.plannedRoute.join('>'),
      destNode: w.destNode,
      signalPhases: w.signalMgr.getAllSignals().map((x) => x.currentPhase).join(','),
      prngState: w.sim.random.state,
    };
  }
  const ref = snap0.A;
  for (const id of ['B', 'C', 'D']) {
    assert(JSON.stringify(snap0[id]) === JSON.stringify(ref),
      `world ${id} initial state differs from A:\n  A=${JSON.stringify(ref)}\n  ${id}=${JSON.stringify(snap0[id])}`);
  }

  // --- distinct object identity across worlds ---------------------------
  const nets = new Set(experiment.MODE_IDS.map((id) => worlds[id].sim.network));
  const sims = new Set(experiment.MODE_IDS.map((id) => worlds[id].sim));
  const sigs = new Set(experiment.MODE_IDS.map((id) => worlds[id].signalMgr));
  const ctrls = new Set(experiment.MODE_IDS.map((id) => worlds[id].controller));
  assert(nets.size === 4 && sims.size === 4 && sigs.size === 4 && ctrls.size === 4,
    `worlds share mutable objects: nets=${nets.size} sims=${sims.size} sigs=${sigs.size} ctrls=${ctrls.size}`);

  // --- identical spawn sequence over the pre-divergence window ----------
  // 300 ticks = 30s: shorter than the router's 30s reroute hysteresis and
  // before the ambulance is within 250m of any signalised junction, so no
  // mode-specific intervention can have engaged yet.
  const spawnSeq = {};
  const traj = {};
  for (const id of experiment.MODE_IDS) {
    const w = worlds[id];
    const seq = [];
    const path = [];
    for (let i = 0; i < 300; i += 1) {
      const before = w.sim.spawnedCount;
      w.sim.step(0.1);
      w.signalMgr.update(0.1);
      for (let k = before; k < w.sim.spawnedCount; k += 1) {
        const veh = w.sim.vehicles.get('veh_' + k);
        seq.push(`veh_${k}@t${(i + 1)}:${veh.edge.id}|${veh.laneIndex}|${veh.cls.id}|${veh.sinkNodeId}`);
      }
      const amb = w.sim.vehicles.get(w.ambId);
      if (amb) path.push(`${amb.edge.id}|${amb.s.toFixed(3)}|${amb.v.toFixed(3)}`);
    }
    spawnSeq[id] = seq.join('\n');
    traj[id] = path.join('\n');
  }
  assert(spawnSeq.A.length > 0, 'no vehicles spawned in the observation window');
  for (const id of ['B', 'C', 'D']) {
    assert(spawnSeq[id] === spawnSeq.A,
      `world ${id} spawn sequence diverged from A within the pre-divergence window`);
    assert(traj[id] === traj.A,
      `world ${id} ambulance trajectory diverged from A within the pre-divergence window`);
  }

  console.log(`    identical across A/B/C/D: vehicles=${ref.vehicleCount} `
    + `edge=${ref.edgeId} signals=${ref.signalPhases.split(',').length} spawns(30s)=${spawnSeq.A.split('\n').length}`);
});

// ============================================================================
// 2. Mode behaviour differentiation
// ============================================================================
test('2. Mode differentiation: A(0,0) B(0 sig) C(0 reroute) D(both allowed)', () => {
  const runner = require(path.join(ROOT, 'tests/experiment_runner.js'));
  const base = runner.SCENARIOS.find((s) => s.name === 'blocked_primary_corridor');
  assert(base, 'blocked_primary_corridor scenario is missing');
  const scenario = Object.assign({}, base, { seed: 42 });
  const r = experiment.runComparison(scenario);
  const A = r.modes.A, B = r.modes.B, C = r.modes.C, D = r.modes.D;

  assert(A.rerouteCount === 0, `Mode A logged ${A.rerouteCount} reroutes (expected 0)`);
  assert(A.signalInterventions === 0, `Mode A made ${A.signalInterventions} signal interventions (expected 0)`);
  assert(B.signalInterventions === 0, `Mode B made ${B.signalInterventions} signal interventions (expected 0)`);
  assert(C.rerouteCount === 0, `Mode C logged ${C.rerouteCount} reroutes (expected 0)`);

  // This scenario blocks the primary corridor's third edge, so Tier-1 has a
  // genuine bypass to find. A mode that permits rerouting must find it; a mode
  // that does not must not move at all.
  assert(B.rerouteCount >= 1, `Mode B found no reroute on a blocked corridor (count=${B.rerouteCount})`);
  assert(D.rerouteCount >= 1, `Mode D found no reroute on a blocked corridor (count=${D.rerouteCount})`);

  // Tier-2 must be demonstrably live in C and D, and demonstrably absent in A
  // and B. On this corridor the ambulance crosses three signalised junctions.
  assert(C.signalInterventions >= 1, `Mode C made no signal interventions (=${C.signalInterventions})`);
  assert(D.signalInterventions >= 1, `Mode D made no signal interventions (=${D.signalInterventions})`);

  console.log(`    A(reroute=${A.rerouteCount},sig=${A.signalInterventions}) `
    + `B(reroute=${B.rerouteCount},sig=${B.signalInterventions}) `
    + `C(reroute=${C.rerouteCount},sig=${C.signalInterventions}) `
    + `D(reroute=${D.rerouteCount},sig=${D.signalInterventions})`);
});

// ============================================================================
// 3. Invariant enforcement across all four modes
// ============================================================================
test('3. Invariants hold in every mode: collisions=0, safeTransitionViolations=0', () => {
  const scenario = {
    name: 'invariants', origin: 'node_majestic', destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE, seed: 123, demandProfile: 'peak', durationSec: 1200,
    congestionEvents: [{ atSec: 120, edgeId: 'edge_kg_01_fwd', speedFactor: 0.15 }],
  };
  const r = experiment.runComparison(scenario);
  for (const id of experiment.MODE_IDS) {
    const m = r.modes[id];
    assert(m.collisionViolations === 0, `Mode ${id}: collisionViolations=${m.collisionViolations}`);
    assert(m.safeTransitionViolations === 0,
      `Mode ${id}: safeTransitionViolations=${m.safeTransitionViolations}`);
    if (m.minAmberObservedSec !== null) {
      assert(m.minAmberObservedSec >= 3.0 - 1e-9, `Mode ${id}: min amber ${m.minAmberObservedSec}s < 3.0s`);
    }
    if (m.minAllRedObservedSec !== null) {
      assert(m.minAllRedObservedSec >= 2.0 - 1e-9, `Mode ${id}: min all-red ${m.minAllRedObservedSec}s < 2.0s`);
    }
  }
  console.log('    all four modes: collisionViolations=0 safeTransitionViolations=0, amber>=3.0s all-red>=2.0s');
});

// ============================================================================
// 4. Multi-scenario, multi-seed benchmark matrix
// ============================================================================
test('4. Benchmark matrix: 3 seeds x 2 real corridors', () => {
  const runner = require(path.join(ROOT, 'tests/experiment_runner.js'));
  const wanted = ['peak_signalised_corridor', 'blocked_primary_corridor'];
  const scenarios = runner.SCENARIOS.filter((s) => wanted.includes(s.name));
  assert(scenarios.length === 2, `expected 2 matrix scenarios, found ${scenarios.length}`);

  const matrix = [];
  for (const base of scenarios) {
    for (const seed of [42, 123, 777]) {
      const result = experiment.runComparison(Object.assign({}, base, { seed }));
      matrix.push(result);
      for (const id of experiment.MODE_IDS) {
        const m = result.modes[id];
        assert(m.collisionViolations === 0,
          `${base.name}/${seed}/Mode ${id}: collisionViolations=${m.collisionViolations}`);
        assert(m.safeTransitionViolations === 0,
          `${base.name}/${seed}/Mode ${id}: safeTransitionViolations=${m.safeTransitionViolations}`);
      }
      assert(result.modes.A.rerouteCount === 0 && result.modes.A.signalInterventions === 0,
        `${base.name}/${seed}: Mode A was not a clean baseline`);
      assert(result.modes.C.rerouteCount === 0, `${base.name}/${seed}: Mode C rerouted`);
      assert(result.modes.B.signalInterventions === 0, `${base.name}/${seed}: Mode B preempted signals`);
    }
  }

  // Raw, unedited table — neutral and negative deltas included.
  process.stdout.write(experiment.formatTable(matrix) + '\n');
  console.log(`    matrix: ${matrix.length} comparisons x 4 modes = ${matrix.length * 4} independent worlds, all invariants held`);
  global.__STAGE4_MATRIX__ = matrix;
});

// ============================================================================
// 5. Bit-identical reproducibility
// ============================================================================
test('5. Bit-identical reproducibility (seed 42, run twice)', () => {
  const scenario = {
    name: 'reproducibility', origin: 'node_majestic', destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE, seed: 42, demandProfile: 'peak', durationSec: 1200,
    congestionEvents: [{ atSec: 120, edgeId: 'edge_kg_01_fwd', speedFactor: 0.15 }],
  };
  const r1 = experiment.runComparison(scenario);
  const r2 = experiment.runComparison(scenario);

  for (const id of experiment.MODE_IDS) {
    assert(r1.modes[id].checksum === r2.modes[id].checksum,
      `Mode ${id}: checksum differs (${r1.modes[id].checksum} vs ${r2.modes[id].checksum})`);
    assert(r1.modes[id].travelTimeSec === r2.modes[id].travelTimeSec,
      `Mode ${id}: travelTimeSec differs`);
    assert(r1.modes[id].stoppedTimeSec === r2.modes[id].stoppedTimeSec,
      `Mode ${id}: stoppedTimeSec differs`);
    assert(JSON.stringify(r1.modes[id]) === JSON.stringify(r2.modes[id]),
      `Mode ${id}: full metrics JSON differs`);
  }
  assert(experiment.toJSON(r1) === experiment.toJSON(r2), 'toJSON output differs between runs');

  console.log('    identical checksums: ' + experiment.MODE_IDS.map(
    (id) => `${id}=${r1.modes[id].checksum}`).join(' '));
});

// ============================================================================
// 6. Hospital bay finite occupancy
// ============================================================================
test('6a. Bay manager: third request for a 2-bay hospital is refused', () => {
  const NETWORK = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'Data', 'GeoJSON', 'bengaluru_network.json'), 'utf8'));
  global.NETWORK_DATA = NETWORK;
  const net = new SimulationNetwork(NETWORK);
  const proj = new GeoProjection(CONFIG.GEO.origin);
  const sim = new SimulationEngine(net, new SignalManager(null, proj), 42, proj);
  const mgr = sim.bayManager;

  const b1 = mgr.requestBay(VICTORIA, 'a');
  const b2 = mgr.requestBay(VICTORIA, 'b');
  const b3 = mgr.requestBay(VICTORIA, 'c');
  assert(b1 && b2, 'first two bay requests must both succeed');
  assert(b3 === null, 'third bay request must be refused while both bays are held');
  assert(b1.bayId !== b2.bayId, `first two requests got the same bay: ${b1.bayId}`);

  // The hospital is finite at exactly two bays, not merely "two named keys".
  const hosp = mgr.bays.get(VICTORIA);
  assert(Object.keys(hosp).filter((k) => k === 'bay_a' || k === 'bay_b').length === 2,
    'hospital does not expose exactly two bays');

  // Free one and the third must now succeed on the released bay.
  mgr.releaseBay(VICTORIA, b1.bayId, 'a');
  const b4 = mgr.requestBay(VICTORIA, 'c');
  assert(b4 && b4.bayId === b1.bayId, 'released bay must be reusable by the waiting vehicle');
});

test('6b. Three ambulances, two bays: third waits at the driveway, never overlaps', () => {
  const NETWORK = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'Data', 'GeoJSON', 'bengaluru_network.json'), 'utf8'));
  const SIGNALS = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'Data', 'GeoJSON', 'bengaluru_traffic_signals.geojson'), 'utf8'));
  global.NETWORK_DATA = NETWORK;
  global.SIGNALS_DATA = SIGNALS;

  const proj = new GeoProjection(CONFIG.GEO.origin);
  const net = new SimulationNetwork(NETWORK);
  const signalMgr = new SignalManager(null, proj);
  const sim = new SimulationEngine(net, signalMgr, 42, proj);
  sim.setDemandProfile('peak');
  const graph = new routing.RoadGraph(NETWORK, 42);
  const planner = new routing.RoutePlanner(graph, signalMgr);
  const controller = new routing.SmartRoutingController(planner, graph, signalMgr, {});
  sim.setRoutingController(controller);
  sim.setCongestionCallback((map) => controller.setLiveTravelTimes(map));
  controller.setDestination(VICTORIA_GATE, VICTORIA);

  // Two ambulances are dispatched at once from origins whose free-flow ETAs into
  // Victoria are within 3s (89.9s and 87.9s), so they converge on the hospital
  // together and take both bays. The third is dispatched 45s later from an
  // origin only ~49s away, so it arrives while both bays are still held and must
  // wait at the driveway until one is released.
  const plan = [
    { id: 'amb_1', origin: 'node_kr_market_junction', atSec: 0 },
    { id: 'amb_2', origin: 'node_tipu_palace', atSec: 0 },
    { id: 'amb_3', origin: 'node_fort_junction', atSec: 45 },
  ];
  const dispatched = [];

  const bays = sim.bayManager.bays.get(VICTORIA);
  const ingressNode = bays.ingressNodeId;
  let peakNonFree = 0;
  let doubleOccupancy = 0;
  let drivewayWaitTicks = 0;
  const waiters = new Set();

  for (let i = 0; i < 12000; i += 1) {
    for (const p of plan) {
      if (p.atSec !== null && sim.time >= p.atSec - 1e-9) {
        const route = planner.findRouteEnhanced(p.origin, VICTORIA_GATE, { isPreempted: true });
        assert(route && route.path.length > 0, `no route ${p.origin} -> ${VICTORIA_GATE}`);
        sim.addAmbulance(p.id, route.path, VICTORIA);
        dispatched.push(p.id);
        p.atSec = null;
      }
    }

    sim.step(0.1);
    signalMgr.update(0.1);

    // Finiteness: at most two bays may be non-FREE at any tick.
    const nonFree = [bays.bay_a, bays.bay_b].filter((b) => b.state !== 'FREE');
    peakNonFree = Math.max(peakNonFree, nonFree.length);

    // Exclusivity: no vehicle id may hold two bays at once.
    const holders = nonFree.map((b) => b.vehicleId).filter((x) => x);
    if (new Set(holders).size !== holders.length) doubleOccupancy += 1;

    // "Waiting at the driveway": still EN_ROUTE, on the ingress edge, inside the
    // 120m approach window, commanded to a standstill because no bay is free.
    for (const id of dispatched) {
      const veh = sim.vehicles.get(id);
      if (!veh) continue;
      if (veh.ambulanceState === 'EN_ROUTE'
        && veh.edge.toNodeId === ingressNode
        && veh.s >= veh.edge.length - 120.0
        && veh.targetV === 0) {
        drivewayWaitTicks += 1;
        waiters.add(id);
      }
    }

    if (dispatched.length === plan.length && dispatched.every((id) => {
      const t = sim.completedTrips.get(id);
      return t && t.state === 'BAY_RELEASED';
    })) break;
  }

  assert(sim.collisionViolations === 0, `collisionViolations=${sim.collisionViolations}`);
  assert(peakNonFree <= 2, `more than two bays held at once: ${peakNonFree}`);
  assert(peakNonFree === 2, `contention was not exercised: peak non-FREE bays = ${peakNonFree}`);
  assert(doubleOccupancy === 0, `a bay was double-occupied for ${doubleOccupancy} ticks`);
  assert(drivewayWaitTicks > 0, 'no ambulance ever waited at the driveway — contention was not exercised');
  assert(waiters.size >= 1, 'third ambulance did not wait for a bay');

  const trips = plan.map((p) => {
    const t = sim.completedTrips.get(p.id);
    assert(t && t.state === 'BAY_RELEASED', `${p.id} did not complete (${t ? t.state : 'MISSING'})`);
    return { id: p.id, bayKey: t.bayKey, arrivedAtSec: +t.arrivedAtSec.toFixed(1), completedAtSec: +t.completedAtSec.toFixed(1) };
  });

  // The two bays may legitimately be reused, but never simultaneously by two
  // vehicles — which the per-tick exclusivity check above already proved.
  const stillHeld = [bays.bay_a, bays.bay_b].filter((b) => b.state !== 'FREE').length;
  assert(stillHeld === 0, `${stillHeld} bay(s) still held after all trips completed (deadlock)`);

  console.log(`    peakNonFreeBays=${peakNonFree} drivewayWaitTicks=${drivewayWaitTicks} `
    + `(${(drivewayWaitTicks * 0.1).toFixed(1)}s) waiters=[${Array.from(waiters).join(',')}]`);
  console.log('    trips: ' + trips.map((t) => `${t.id}->${t.bayKey}[${t.arrivedAtSec},${t.completedAtSec}]`).join(' '));
});

// ============================================================================
// 7. Export helpers
// ============================================================================
test('7. JSON and CSV export helpers produce parseable output', () => {
  const scenario = {
    name: 'export', origin: 'node_majestic', destinationHospital: VICTORIA,
    destinationNode: VICTORIA_GATE, seed: 42, demandProfile: 'peak', durationSec: 400,
  };
  const r = experiment.runComparison(scenario);

  const json = experiment.toJSON(r);
  const parsed = JSON.parse(json);
  assert(parsed.modes && parsed.modes.A && parsed.deltas, 'JSON export is missing modes/deltas');
  assert(parsed.modes.A.mode === 'A', 'JSON export lost the mode id');

  const csv = experiment.toCSV([r]);
  const lines = csv.split('\n');
  assert(lines.length === 1 + 4, `CSV must have a header + 4 mode rows, got ${lines.length}`);
  assert(lines[0].startsWith('scenario,seed,demandProfile'), 'CSV header is malformed');
  for (let i = 1; i < lines.length; i += 1) {
    assert(lines[i].split(',').length === lines[0].split(',').length,
      `CSV row ${i} has a different column count than the header`);
  }
  console.log(`    JSON export ${json.length} bytes; CSV ${lines.length} lines x ${lines[0].split(',').length} cols`);
});

// ============================================================================
console.log('\n' + '='.repeat(78));
console.log(`STAGE 4 EXPERIMENT SUITE: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(78));
process.exit(failCount === 0 ? 0 : 1);
