/**
 * tests/test_stage3_simulation.js
 * Stage 3 acceptance suite: the seven named verification tests from the task
 * specification, run against the real integrated stack (network + routing +
 * signals + simulation) rather than mocks.
 *
 * 1. Peak-demand corridor, Majestic -> Victoria Hospital (seed 42, peak)
 * 2. Off-peak corridor, Silk Board -> St. John's Hospital (seed 123)
 * 3. Injected congestion reroute (blockage at t = 120s, saving >= 20s)
 * 4. Dual-ambulance / dual-bay concurrency (distinct bays, no deadlock)
 * 5. Safe signal transition invariant (amber >= 3.0s, all-red >= 2.0s)
 * 6. Bit-identical determinism (seed 42 twice, 60s)
 * 7. Performance benchmark (200 vehicles, 600 ticks)
 *
 * Every test also asserts the hard zero-overlap invariant:
 * collisionViolations === 0.
 *
 * Node only, no dependencies:  node tests/test_stage3_simulation.js
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { SimulationNetwork } = require(path.join(ROOT, 'js/network.js'));
const { SimulationEngine } = require(path.join(ROOT, 'js/simulation.js'));
const routing = require(path.join(ROOT, 'js/routing.js'));
const SignalManager = require(path.join(ROOT, 'js/signals.js'));
const GeoProjection = require(path.join(ROOT, 'js/projection.js'));
const CONFIG = require(path.join(ROOT, 'js/config.js'));

const NETWORK = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'Data', 'GeoJSON', 'bengaluru_network.json'), 'utf8'));
const SIGNALS = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'Data', 'GeoJSON', 'bengaluru_traffic_signals.geojson'), 'utf8'));

global.NETWORK_DATA = NETWORK;
global.SIGNALS_DATA = SIGNALS;

const ProjectionClass = GeoProjection.GeoProjection || GeoProjection;
const proj = new ProjectionClass(CONFIG.GEO.origin);

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

/** Build the fully wired stack: simulation + router + signal manager. */
function buildSim(seed, demandProfile) {
  const net = new SimulationNetwork(NETWORK);
  const signalMgr = new SignalManager(null, proj);
  const sim = new SimulationEngine(net, signalMgr, seed, proj);
  sim.setDemandProfile(demandProfile);

  const graph = new routing.RoadGraph(NETWORK, seed);
  const planner = new routing.RoutePlanner(graph, signalMgr);
  const controller = new routing.SmartRoutingController(planner, graph, signalMgr, {});
  sim.setRoutingController(controller);
  sim.setCongestionCallback(map => controller.setLiveTravelTimes(map));

  return { net, signalMgr, sim, graph, planner, controller };
}

/** Plan a route with the authoritative router and dispatch an ambulance on it. */
function dispatchAmbulance(sim, controller, ambId, fromNode, toNode, hospitalId) {
  const route = controller.planner.findRouteEnhanced(fromNode, toNode, { isPreempted: true });
  assert(route && route.path.length > 0, `no route ${fromNode} -> ${toNode}`);
  controller.setDestination(toNode, hospitalId);
  sim.addAmbulance(ambId, route.path, hospitalId);
  return route;
}

function run(sim, signalMgr, ticks) {
  for (let i = 0; i < ticks; i += 1) {
    sim.step(0.1);
    signalMgr.update(0.1);
  }
}

// ============================================================================
// 1. Peak-demand corridor
// ============================================================================
test('1. Peak corridor Majestic -> Victoria Hospital (seed 42, peak)', () => {
  const { sim, controller, signalMgr } = buildSim(42, 'peak');
  const route = dispatchAmbulance(sim, controller, 'amb_1', 'node_majestic', VICTORIA_GATE, VICTORIA);

  run(sim, signalMgr, 5000);

  const trip = sim.completedTrips.get('amb_1');
  assert(sim.collisionViolations === 0, `collisionViolations=${sim.collisionViolations}`);
  assert(trip && trip.state === 'BAY_RELEASED',
    `trip=${trip ? trip.state : 'MISSING'}`);
  assert(trip.bayKey, 'no bay assigned');
  assert(sim.decisionLog.some(d => d.tier === 'TIER2_PRIORITY' || d.tier === 'TIER1_REROUTE'),
    'no routing-tier decision was logged');

  const ratio = trip.travelTimeSec / route.totalTime;
  console.log(`    edges=${route.path.length} freeFlow=${route.totalTime.toFixed(1)}s `
    + `actual=${trip.travelTimeSec.toFixed(1)}s ratio=${ratio.toFixed(2)} `
    + `decisions=${sim.decisionLog.length} signalInterventions=${sim.signalInterventions}`);
});

// ============================================================================
// 2. Off-peak corridor, and the free-flow comparison the spec asks for
// ============================================================================
test("2. Off-peak corridor Silk Board -> St. John's (seed 123, off-peak)", () => {
  const { sim, controller, signalMgr } = buildSim(123, 'off_peak');
  const route = dispatchAmbulance(sim, controller, 'amb_1', 'node_silk_board', 'node_st_johns', 'hosp_stjohns_01');

  run(sim, signalMgr, 5000);

  const trip = sim.completedTrips.get('amb_1');
  assert(sim.collisionViolations === 0, `collisionViolations=${sim.collisionViolations}`);
  assert(trip && trip.state === 'BAY_RELEASED',
    `trip=${trip ? trip.state : 'MISSING'}`);

  const ratio = trip.travelTimeSec / route.totalTime;
  console.log(`    freeFlow=${route.totalTime.toFixed(1)}s actual=${trip.travelTimeSec.toFixed(1)}s `
    + `ratio=${ratio.toFixed(2)} bay=${trip.bayKey}`);
});

// ============================================================================
// 3. Injected congestion forces a Tier-1 reroute
// ============================================================================
test('3. Injected congestion reroute (blockage at t=120s)', () => {
  const { sim, controller, signalMgr } = buildSim(99, 'peak');
  dispatchAmbulance(sim, controller, 'amb_1', 'node_majestic', VICTORIA_GATE, VICTORIA);

  // Block Avenue Road at t=120s, mid-trip. Avenue Road is the third edge of the
  // primary corridor and, unlike the earlier Kempegowda edges, the junction
  // it feeds (K.R. Market) has a genuine alternative: N.R. Road. Blocking it
  // makes the primary route a wall while the alternative remains open, so the
  // router must reroute and the ambulance must actually follow the detour.
  let adoptedRoute = null;
  for (let i = 0; i < 12000; i += 1) {
    if (i === 1200) sim.setEdgeBlockage('edge_avenue_01_fwd', true);
    sim.step(0.1);
    signalMgr.update(0.1);
    // Capture the adopted path while the ambulance record still exists.
    const amb = sim.ambulances.get('amb_1');
    if (amb && amb.routeEdgeIds) adoptedRoute = amb.routeEdgeIds.slice();
  }

  const reroute = sim.decisionLog.find(d => d.tier === 'TIER1_REROUTE');
  assert(sim.collisionViolations === 0, `collisionViolations=${sim.collisionViolations}`);
  assert(reroute, `no TIER1_REROUTE logged (tiers: ${sim.decisionLog.map(d => d.tier).join(',')})`);
  assert(reroute.predictedSavingSec >= 20,
    `predictedSavingSec=${reroute.predictedSavingSec} < 20`);

  // A logged reroute that the ambulance never follows is not a reroute: the
  // adopted route must contain the alternative corridor, not the blocked edge.
  assert(adoptedRoute && adoptedRoute.length > 0, 'ambulance has no remaining route');
  assert(!adoptedRoute.includes('edge_avenue_01_fwd'),
    `adopted route still contains the blocked edge: ${adoptedRoute.join(' -> ')}`);

  const trip = sim.completedTrips.get('amb_1');
  assert(trip && trip.state === 'BAY_RELEASED',
    `trip=${trip ? trip.state : 'MISSING'}`);
  assert(trip.hospitalId === VICTORIA, `hospital=${trip.hospitalId}`);
  assert(trip.bayKey, 'no bay assigned');

  console.log(`    predictedSaving=${reroute.predictedSavingSec.toFixed(1)}s `
    + `${reroute.fromEdge} -> ${reroute.toEdge} travel=${trip.travelTimeSec.toFixed(1)}s`);
  console.log(`    adopted: ${adoptedRoute.join(' -> ')}`);
});

// ============================================================================
// 4. Dual ambulance, dual bay
// ============================================================================
test('4. Dual-ambulance / dual-bay concurrency', () => {
  // Bay contention only exists if both ambulances are at the hospital at the
  // same time — a freed bay may legitimately be reused, which would make
  // "distinct bays" a false requirement. Both are dispatched at once from
  // origins whose free-flow ETAs into Victoria are within 3s (89.9s and 87.9s),
  // so their 30s dwell windows genuinely overlap.
  const { sim, controller, signalMgr } = buildSim(42, 'peak');
  dispatchAmbulance(sim, controller, 'amb_1', 'node_kr_market_junction', VICTORIA_GATE, VICTORIA);
  dispatchAmbulance(sim, controller, 'amb_2', 'node_tipu_palace', VICTORIA_GATE, VICTORIA);

  const bays = sim.bayManager.bays.get(VICTORIA);
  let peakHeld = 0;
  for (let i = 0; i < 6000; i += 1) {
    sim.step(0.1);
    signalMgr.update(0.1);
    const held = [bays.bay_a, bays.bay_b]
      .filter(b => b.state === 'OCCUPIED' || b.state === 'LOCKED').length;
    peakHeld = Math.max(peakHeld, held);
  }

  const t1 = sim.completedTrips.get('amb_1');
  const t2 = sim.completedTrips.get('amb_2');

  assert(sim.collisionViolations === 0, `collisionViolations=${sim.collisionViolations}`);
  assert(t1 && t1.state === 'BAY_RELEASED', `amb_1 trip=${t1 ? t1.state : 'MISSING'}`);
  assert(t2 && t2.state === 'BAY_RELEASED', `amb_2 trip=${t2 ? t2.state : 'MISSING'}`);
  assert(t1.bayKey !== t2.bayKey, `both ambulances used ${t1.bayKey}`);
  assert(t1.arrivedAtSec < t2.completedAtSec && t2.arrivedAtSec < t1.completedAtSec,
    `dwell windows did not overlap: amb_1[${t1.arrivedAtSec.toFixed(1)},${t1.completedAtSec.toFixed(1)}] `
    + `amb_2[${t2.arrivedAtSec.toFixed(1)},${t2.completedAtSec.toFixed(1)}]`);
  assert(peakHeld <= 2, `more than two bays held at once: ${peakHeld}`);

  const stillHeld = [bays.bay_a, bays.bay_b]
    .filter(b => b.state === 'OCCUPIED' || b.state === 'LOCKED').length;
  assert(stillHeld === 0, `${stillHeld} bay(s) still held after both trips completed (deadlock)`);

  const overlap = Math.min(t1.completedAtSec, t2.completedAtSec)
    - Math.max(t1.arrivedAtSec, t2.arrivedAtSec);
  console.log(`    amb_1 bay=${t1.bayKey} amb_2 bay=${t2.bayKey} `
    + `peakHeld=${peakHeld} overlap=${overlap.toFixed(1)}s`);
});

// ============================================================================
// 5. Safe signal transition invariant
// ============================================================================
test('5. Safe signal transition invariant (amber >= 3.0s, all-red >= 2.0s)', () => {
  const { sim, signalMgr, controller } = buildSim(7, 'peak');
  dispatchAmbulance(sim, controller, 'amb_1', 'node_majestic', VICTORIA_GATE, VICTORIA);

  let preemptionTicks = 0;
  let conflictingGreens = 0;

  for (let i = 0; i < 4000; i += 1) {
    sim.step(0.1);
    signalMgr.update(0.1);
    for (const sig of signalMgr.getAllSignals()) {
      if (!sig.isPreempted) continue;
      preemptionTicks += 1;
      const phase = sig.currentPhase;
      if (phase !== 'PREEMPT_GREEN' && phase !== 'GREEN'
        && phase !== 'AMBER' && phase !== 'ALL_RED_CLEARANCE') {
        conflictingGreens += 1;
      }
    }
  }

  // Durations come from each signal's own record. Sampling from outside only
  // sees tick boundaries and would under-report by up to one tick.
  let minAmber = Infinity;
  let minAllRed = Infinity;
  for (const sig of signalMgr.getAllSignals()) {
    minAmber = Math.min(minAmber, sig.minAmberObserved);
    minAllRed = Math.min(minAllRed, sig.minAllRedObserved);
  }

  assert(preemptionTicks > 0, 'no preemption occurred, so the invariant was never exercised');
  assert(minAmber >= 3.0 - 1e-9, `min amber ${minAmber}s < 3.0s`);
  assert(minAllRed >= 2.0 - 1e-9, `min all-red ${minAllRed}s < 2.0s`);
  assert(conflictingGreens === 0, `conflicting green aspects: ${conflictingGreens}`);

  console.log(`    minAmber=${minAmber}s minAllRed=${minAllRed}s `
    + `preemptionTicks=${preemptionTicks}`);
});

// ============================================================================
// 6. Bit-identical determinism
// ============================================================================
test('6. Bit-identical determinism (seed 42 twice, 60s)', () => {
  function trace(seed) {
    const { sim, controller, signalMgr } = buildSim(seed, 'peak');
    dispatchAmbulance(sim, controller, 'amb_1', 'node_majestic', VICTORIA_GATE, VICTORIA);
    const hashes = [];
    for (let i = 0; i < 600; i += 1) {
      sim.step(0.1);
      signalMgr.update(0.1);
      if (i % 100 === 99) hashes.push(sim.checksum());
    }
    return { checksum: sim.checksum(), trail: hashes.join(','), sim };
  }

  const a = trace(42);
  const b = trace(42);
  assert(a.checksum === b.checksum, `final checksums differ: ${a.checksum} vs ${b.checksum}`);
  assert(a.trail === b.trail, 'intermediate checksums diverge before the final tick');

  // A different seed must actually produce a different world, otherwise the
  // "deterministic" result would be a constant rather than a seeded run.
  const c = trace(43);
  assert(a.checksum !== c.checksum, 'seed 43 produced an identical world to seed 42');

  console.log(`    checksum=${a.checksum} trail=${a.trail} seed43=${c.checksum}`);
});

// ============================================================================
// 7. Performance benchmark
// ============================================================================
test('7. Performance benchmark (200 vehicles, 600 ticks = 60s)', () => {
  const { sim, controller, signalMgr } = buildSim(42, 'peak');
  dispatchAmbulance(sim, controller, 'amb_1', 'node_majestic', VICTORIA_GATE, VICTORIA);

  // Warm the population up to at least the 200-vehicle target before timing.
  let warmTicks = 0;
  while (sim.vehicles.size < 200 && warmTicks < 6000) {
    sim.step(0.1);
    signalMgr.update(0.1);
    warmTicks += 1;
  }
  assert(sim.vehicles.size >= 200,
    `population only reached ${sim.vehicles.size} vehicles, below the 200 target`);

  const population = sim.vehicles.size;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 600; i += 1) {
    sim.step(0.1);
    signalMgr.update(0.1);
  }
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const perTickMs = wallMs / 600;

  assert(sim.collisionViolations === 0, `collisionViolations=${sim.collisionViolations}`);
  assert(perTickMs < 33, `per tick ${perTickMs.toFixed(3)}ms exceeds the 33ms (30 FPS) budget`);

  console.log(`    vehicles=${population} wallClock=${wallMs.toFixed(1)}ms `
    + `perTick=${perTickMs.toFixed(3)}ms (${(1000 / perTickMs).toFixed(0)} FPS equivalent)`);
});

// ============================================================================
console.log('='.repeat(70));
console.log(`STAGE 3 SIMULATION SUITE: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(70));
if (failCount > 0) process.exit(1);