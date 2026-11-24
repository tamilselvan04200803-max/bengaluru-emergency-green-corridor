/**
 * js/experiment.js
 * Stage 4 — Controlled A/B/C/D Experiment Harness
 *
 * Runs four *completely independent* simulation worlds for one scenario config
 * and reports each mode's measured metrics plus deltas against Baseline A. The
 * four worlds share only the scenario inputs (seed, demand profile, ambulance
 * dispatch, injected congestion events) — every world builds its own
 * SimulationNetwork, SignalManager, RoadGraph, SmartRoutingController and
 * seeded PRNG. No mutable object is shared between worlds.
 *
 *   Mode A — Baseline: no Tier-1 rerouting, no Tier-2 signal priority.
 *   Mode B — Routing only: Tier-1 rerouting on, Tier-2 priority off.
 *   Mode C — Signal priority only: Tier-1 off, Tier-2 on.
 *   Mode D — Combined: both on.
 *
 * Scientific integrity: nothing here is hardcoded to make the intervention look
 * good. Metrics are read off the live simulation, neutral and negative results
 * are preserved verbatim, and a reroute that takes longer is reported as a
 * longer reroute.
 *
 * Browser-global (window.ExperimentHarness) and CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ExperimentHarness = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DT = 0.1;
  const STOPPED_SPEED_MPS = 0.5; // "stopped" is defined consistently as v < 0.5 m/s
  const DNF_TIMEOUT = 'DNF_TIMEOUT';
  const ARRIVED = 'ARRIVED';

  // The factory closes over the module scope, not the UMD wrapper's `root`, so
  // the global object is resolved here directly.
  const GLOBAL_OBJ = (typeof self !== 'undefined') ? self
    : (typeof global !== 'undefined') ? global : {};

  // The four experimental modes, expressed as the two independent intervention
  // switches the platform actually implements.
  const MODES = {
    A: { id: 'A', label: 'Baseline (no intervention)', rerouting: false, signalPriority: false },
    B: { id: 'B', label: 'Routing optimization only', rerouting: true, signalPriority: false },
    C: { id: 'C', label: 'Signal priority only', rerouting: false, signalPriority: true },
    D: { id: 'D', label: 'Combined (routing + signal)', rerouting: true, signalPriority: true },
  };
  const MODE_IDS = ['A', 'B', 'C', 'D'];

  /**
   * Resolve the platform modules. In Node they are require()d from ./; in the
   * browser they are read off the global (window) scope. network.js and
   * simulation.js publish a namespace object rather than the bare class, so the
   * constructors are pulled off the namespace when present.
   */
  function resolveDeps(overrides) {
    const o = overrides || {};
    const isNode = typeof module === 'object' && module.exports && typeof require === 'function';
    const win = GLOBAL_OBJ;

    let networkNs = o.SimulationNetwork || null;
    let simNs = o.SimulationEngine || null;
    let routingNs = o.RoutingEngine || null;
    let SignalManagerCtor = o.SignalManager || null;
    let GeoProjectionNs = o.GeoProjection || null;
    let CONFIG = o.CONFIG || null;

    if (isNode) {
      if (!networkNs) networkNs = require('./network.js');
      if (!simNs) simNs = require('./simulation.js');
      if (!routingNs) routingNs = require('./routing.js');
      if (!SignalManagerCtor) SignalManagerCtor = require('./signals.js');
      if (!GeoProjectionNs) GeoProjectionNs = require('./projection.js');
      if (!CONFIG) CONFIG = require('./config.js');
    } else {
      // preview_data.js declares its payloads as top-level `const`, so they are
      // global lexical bindings reachable as bare identifiers but NOT as
      // properties of window. Check the bare name first, then window.
      if (!networkNs) networkNs = (typeof SimulationNetwork !== 'undefined') ? SimulationNetwork : win.SimulationNetwork;
      if (!simNs) simNs = (typeof SimulationEngine !== 'undefined') ? SimulationEngine : win.SimulationEngine;
      if (!routingNs) routingNs = (typeof RoutingEngine !== 'undefined') ? RoutingEngine : win.RoutingEngine;
      if (!SignalManagerCtor) SignalManagerCtor = (typeof SignalManager !== 'undefined') ? SignalManager : win.SignalManager;
      if (!GeoProjectionNs) GeoProjectionNs = (typeof GeoProjection !== 'undefined') ? GeoProjection : win.GeoProjection;
      if (!CONFIG) CONFIG = (typeof CONFIG !== 'undefined') ? CONFIG : win.CONFIG;
    }

    let NETWORK = o.NETWORK;
    let SIGNALS = o.SIGNALS;
    if (!NETWORK || !SIGNALS) {
      if (isNode) {
        const fs = require('fs');
        const path = require('path');
        const rootDir = path.resolve(__dirname, '..');
        if (!NETWORK) {
          NETWORK = JSON.parse(fs.readFileSync(
            path.join(rootDir, 'Data', 'GeoJSON', 'bengaluru_network.json'), 'utf8'));
        }
        if (!SIGNALS) {
          SIGNALS = JSON.parse(fs.readFileSync(
            path.join(rootDir, 'Data', 'GeoJSON', 'bengaluru_traffic_signals.geojson'), 'utf8'));
        }
      } else {
        if (!NETWORK) NETWORK = (typeof NETWORK_DATA !== 'undefined') ? NETWORK_DATA : win.NETWORK_DATA;
        if (!SIGNALS) SIGNALS = (typeof SIGNALS_DATA !== 'undefined') ? SIGNALS_DATA : win.SIGNALS_DATA;
      }
    }

    return {
      SimulationNetwork: (networkNs && networkNs.SimulationNetwork) ? networkNs.SimulationNetwork : networkNs,
      SimulationEngine: (simNs && simNs.SimulationEngine) ? simNs.SimulationEngine : simNs,
      RoutingEngine: routingNs,
      SignalManager: SignalManagerCtor,
      GeoProjection: (GeoProjectionNs && GeoProjectionNs.GeoProjection) ? GeoProjectionNs.GeoProjection : GeoProjectionNs,
      CONFIG,
      NETWORK,
      SIGNALS,
    };
  }

  /** Build one isolated world for `scenario` under `mode`. */
  function buildWorld(scenario, mode, deps) {
    const seed = scenario.seed;
    const proj = new deps.GeoProjection(deps.CONFIG.GEO.origin);

    // A fresh network object per world: the simulation mutates edge state
    // (blockages, incidents), so worlds must not share one.
    const networkData = JSON.parse(JSON.stringify(deps.NETWORK));
    const net = new deps.SimulationNetwork(networkData);

    // SignalManager reads the global NETWORK_DATA / SIGNALS_DATA when building
    // its signal set and node->signal index, so both globals are pointed at this
    // world's copies for the duration of construction. (Node: global; browser:
    // window.) Without SIGNALS_DATA the manager silently builds zero signals,
    // which would make every mode identical and the comparison meaningless.
    const globalRef = (typeof global !== 'undefined') ? global
      : (typeof self !== 'undefined') ? self : GLOBAL_OBJ;
    const savedNetwork = globalRef.NETWORK_DATA;
    const savedSignals = globalRef.SIGNALS_DATA;
    globalRef.NETWORK_DATA = networkData;
    globalRef.SIGNALS_DATA = deps.SIGNALS;
    const signalMgr = new deps.SignalManager(null, proj);
    globalRef.NETWORK_DATA = savedNetwork;
    globalRef.SIGNALS_DATA = savedSignals;

    if (signalMgr.getAllSignals().length === 0) {
      throw new Error('SignalManager built zero signals — SIGNALS_DATA was not available to this world');
    }

    const sim = new deps.SimulationEngine(net, signalMgr, seed, proj);
    sim.setDemandProfile(scenario.demandProfile || 'peak');

    const R = deps.RoutingEngine;
    const graph = new R.RoadGraph(networkData, seed);
    const planner = new R.RoutePlanner(graph, signalMgr);
    const controller = new R.SmartRoutingController(planner, graph, signalMgr, {});

    // The two switches are enforced at the controller's decision points so that
    // a disabled tier makes zero requests of any kind — not merely a tier whose
    // output is discarded downstream.
    if (!mode.rerouting) {
      controller.checkReroute = function disabledReroute() {
        return { shouldReroute: false, reason: 'TIER1_DISABLED (mode ' + mode.id + ')', timeSaved: 0 };
      };
    }
    if (!mode.signalPriority) {
      controller.checkSignalPriority = function disabledPriority() {
        return { requests: [] };
      };
      controller.priorityRequestedJunctions.clear();
    }

    sim.setRoutingController(controller);
    // Live congestion feedback is part of the Tier-1 path only; with Tier 1 off
    // the router must not receive a live travel-time feed it could act on.
    if (mode.rerouting) {
      sim.setCongestionCallback((map) => controller.setLiveTravelTimes(map));
    }

    // Resolve the destination node: explicit node, else the hospital ingress.
    let destNode = scenario.destinationNode || null;
    if (!destNode) {
      const hosp = networkData.hospitals.find((h) => h.id === scenario.destinationHospital);
      destNode = hosp ? hosp.ingress_node : null;
    }
    if (!destNode) throw new Error('cannot resolve destination node for ' + scenario.destinationHospital);

    const route = planner.findRouteEnhanced(scenario.origin, destNode, { isPreempted: true });
    if (!route || route.path.length === 0) {
      throw new Error('no route ' + scenario.origin + ' -> ' + destNode);
    }
    controller.setDestination(destNode, scenario.destinationHospital);

    const ambId = scenario.ambulanceId || 'amb_1';
    sim.addAmbulance(ambId, route.path, scenario.destinationHospital);
    // The ambulance's route is fixed at dispatch for modes without Tier 1; for
    // modes with Tier 1 the engine's controller may rebase it mid-trip.
    const plannedRoute = route.path.slice();

    return {
      mode, net, signalMgr, sim, graph, planner, controller,
      ambId, route, plannedRoute, destNode, proj,
    };
  }

  /**
   * Run one world to `durationSec` and read its metrics off the live simulation.
   * Ordinary-vehicle outcomes are observed from the engine's own spawn/despawn
   * accounting rather than reconstructed, so a vehicle that is removed for any
   * reason is classified by what actually happened to it.
   */
  function runWorld(world, scenario, deps) {
    const { sim, signalMgr, ambId } = world;
    const durationSec = scenario.durationSec || 600;
    const maxTicks = Math.round(durationSec / DT);

    // --- ordinary-vehicle observation -------------------------------------
    const tracked = new Map(); // id -> { spawnSec, stoppedSec }
    const completed = [];      // { travelSec, stoppedSec }
    let seenSpawns = 0;
    let ordinaryTracked = 0;

    const origDespawn = sim._despawnVehicle.bind(sim);
    sim._despawnVehicle = function instrumentedDespawn(id) {
      const rec = tracked.get(id);
      if (rec) {
        completed.push({ travelSec: sim.time - rec.spawnSec, stoppedSec: rec.stoppedSec });
        tracked.delete(id);
      }
      return origDespawn(id);
    };

    // --- injected congestion events ---------------------------------------
    const events = (scenario.congestionEvents || []).slice()
      .sort((a, b) => (a.atSec || 0) - (b.atSec || 0));
    let nextEvent = 0;

    // --- ambulance accounting ---------------------------------------------
    let ambStoppedSec = 0;
    let ambQueueSec = 0;
    let ambDistanceM = 0;
    let amberMin = Infinity;
    let allRedMin = Infinity;

    const simSignals = signalMgr.getAllSignals();

    for (let tick = 0; tick < maxTicks; tick += 1) {
      // Apply any congestion events whose time has arrived.
      while (nextEvent < events.length && (events[nextEvent].atSec || 0) <= sim.time + 1e-9) {
        const ev = events[nextEvent];
        if (ev.blocked) {
          sim.setEdgeBlockage(ev.edgeId, true);
        } else if (typeof ev.speedFactor === 'number') {
          sim.setEdgeIncident(ev.edgeId, ev.speedFactor);
        }
        nextEvent += 1;
      }

      sim.step(DT);
      signalMgr.update(DT);

      // Register newly spawned ordinary vehicles.
      while (seenSpawns < sim.spawnedCount) {
        const id = 'veh_' + seenSpawns;
        seenSpawns += 1;
        tracked.set(id, { spawnSec: sim.time, stoppedSec: 0 });
        ordinaryTracked += 1;
      }

      // Accumulate per-vehicle stopped time and the ambulance's own metrics.
      const ambVeh = sim.vehicles.get(ambId);
      for (const veh of sim.vehicles.values()) {
        if (veh.v < STOPPED_SPEED_MPS) {
          if (veh === ambVeh) {
            ambStoppedSec += DT;
            const q = sim.laneQueues.get(veh.edge.id + '|' + veh.laneIndex);
            if (q && q.leaderOf(veh)) ambQueueSec += DT;
          } else if (tracked.has(veh.id)) {
            tracked.get(veh.id).stoppedSec += DT;
          }
        }
      }
      if (ambVeh) ambDistanceM += ambVeh.v * DT;

      const trip = sim.completedTrips.get(ambId);
      if (trip && trip.state === 'BAY_RELEASED') break;
    }

    // Vehicles still on the network at the cutoff never completed.
    const ordinaryCompletedCount = completed.length;
    const ordinaryDnfCount = tracked.size;

    let meanTravel = 0;
    let meanStopped = 0;
    if (ordinaryCompletedCount > 0) {
      let tSum = 0;
      let sSum = 0;
      for (const c of completed) { tSum += c.travelSec; sSum += c.stoppedSec; }
      meanTravel = tSum / ordinaryCompletedCount;
      meanStopped = sSum / ordinaryCompletedCount;
    }

    // --- safe-transition invariant ----------------------------------------
    let safeTransitionViolations = 0;
    for (const sig of simSignals) {
      if (sig.minAmberObserved !== Infinity) {
        amberMin = Math.min(amberMin, sig.minAmberObserved);
        if (sig.minAmberObserved < 3.0 - 1e-9) safeTransitionViolations += 1;
      }
      if (sig.minAllRedObserved !== Infinity) {
        allRedMin = Math.min(allRedMin, sig.minAllRedObserved);
        if (sig.minAllRedObserved < 2.0 - 1e-9) safeTransitionViolations += 1;
      }
    }

    const trip = sim.completedTrips.get(ambId);
    const arrived = !!(trip && trip.state === 'BAY_RELEASED');
    const ambVeh = sim.vehicles.get(ambId);

    const rerouteLog = sim.decisionLog
      .filter((d) => d.tier === 'TIER1_REROUTE')
      .map((d) => ({ t: +d.timestamp.toFixed(1), from: d.fromEdge, to: d.toEdge, predictedSavingSec: +(+d.predictedSavingSec).toFixed(2) }));

    // `distanceTravelledM` is the ambulance's arc-length odometer (what it
    // actually drove, including any detour). `routeLengthM` is the length of the
    // route it was dispatched on. They differ only when a Tier-1 reroute
    // changed the route mid-trip.
    const routeLengthM = world.plannedRoute.reduce((sum, eid) => {
      const e = sim.network.getEdge(eid);
      return sum + (e ? e.length : 0);
    }, 0);

    return {
      mode: world.mode.id,
      modeLabel: world.mode.label,
      outcome: arrived ? ARRIVED : DNF_TIMEOUT,
      arrived,
      travelTimeSec: arrived ? +trip.travelTimeSec.toFixed(2) : null,
      freeFlowEtaSec: +world.route.totalTime.toFixed(2),
      // Red-light waiting is the engine's own queue-time accumulator: ticks the
      // ambulance spent at or before a stop line below 0.5 m/s.
      redLightWaitSec: ambVeh ? +ambVeh.timeInQueue.toFixed(2) : null,
      queueDelaySec: +ambQueueSec.toFixed(2),
      stoppedTimeSec: +ambStoppedSec.toFixed(2),
      distanceTravelledM: +ambDistanceM.toFixed(1),
      routeLengthM: +routeLengthM.toFixed(1),
      collisionViolations: sim.collisionViolations,
      signalInterventions: sim.signalInterventions,
      safeTransitionViolations,
      minAmberObservedSec: amberMin === Infinity ? null : +amberMin.toFixed(3),
      minAllRedObservedSec: allRedMin === Infinity ? null : +allRedMin.toFixed(3),
      rerouteCount: rerouteLog.length,
      rerouteLog,
      ordinary: {
        tracked: ordinaryTracked,
        completed: ordinaryCompletedCount,
        dnf: ordinaryDnfCount,
        meanTravelTimeSec: +meanTravel.toFixed(2),
        meanStoppedTimeSec: +meanStopped.toFixed(2),
      },
      finalTick: sim.tick,
      finalTimeSec: +sim.time.toFixed(1),
      checksum: sim.checksum(),
    };
  }

  /** Run all four modes for one scenario, in four fully isolated worlds. */
  function runComparison(scenario, overrides) {
    const deps = resolveDeps(overrides);
    const modes = {};
    for (const id of MODE_IDS) {
      const world = buildWorld(scenario, MODES[id], deps);
      modes[id] = runWorld(world, scenario, deps);
    }

    const base = modes.A;
    const deltas = {};
    for (const id of MODE_IDS) {
      const m = modes[id];
      deltas[id] = {
        travelTimeSec: deltaNum(m.travelTimeSec, base.travelTimeSec),
        travelTimePct: deltaPct(m.travelTimeSec, base.travelTimeSec),
        ordinaryMeanTravelTimeSec: deltaNum(m.ordinary.meanTravelTimeSec, base.ordinary.meanTravelTimeSec),
        ordinaryMeanTravelTimePct: deltaPct(m.ordinary.meanTravelTimeSec, base.ordinary.meanTravelTimeSec),
        ordinaryMeanStoppedTimeSec: deltaNum(m.ordinary.meanStoppedTimeSec, base.ordinary.meanStoppedTimeSec),
        redLightWaitSec: deltaNum(m.redLightWaitSec, base.redLightWaitSec),
        stoppedTimeSec: deltaNum(m.stoppedTimeSec, base.stoppedTimeSec),
      };
    }

    return {
      scenario: {
        name: scenario.name || 'unnamed',
        origin: scenario.origin,
        destinationHospital: scenario.destinationHospital,
        destinationNode: scenario.destinationNode || null,
        seed: scenario.seed,
        demandProfile: scenario.demandProfile || 'peak',
        durationSec: scenario.durationSec || 600,
        congestionEvents: scenario.congestionEvents || [],
      },
      modes,
      deltas,
    };
  }

  function deltaNum(v, base) {
    if (v === null || base === null || v === undefined || base === undefined) return null;
    return +(v - base).toFixed(2);
  }
  function deltaPct(v, base) {
    if (v === null || base === null || !base) return null;
    return +(((v - base) / base) * 100).toFixed(2);
  }

  /** Machine-readable export of one comparison (or an array of them). */
  function toJSON(result) {
    return JSON.stringify(result, null, 2);
  }

  /** Flat CSV: one row per (scenario, mode) for spreadsheet/CLI consumption. */
  function toCSV(results) {
    const list = Array.isArray(results) ? results : [results];
    const header = [
      'scenario', 'seed', 'demandProfile', 'durationSec', 'origin', 'destinationHospital',
      'mode', 'modeLabel', 'outcome', 'arrived',
      'travelTimeSec', 'travelTimeDeltaSec', 'travelTimeDeltaPct',
      'redLightWaitSec', 'queueDelaySec', 'stoppedTimeSec', 'distanceTravelledM', 'routeLengthM',
      'collisionViolations', 'signalInterventions', 'safeTransitionViolations',
      'rerouteCount',
      'ordinaryTracked', 'ordinaryCompleted', 'ordinaryMeanTravelTimeSec',
      'ordinaryMeanTravelTimeDeltaSec', 'ordinaryMeanTravelTimeDeltaPct',
      'ordinaryMeanStoppedTimeSec', 'checksum',
    ];
    const rows = [header.join(',')];
    for (const r of list) {
      for (const id of MODE_IDS) {
        const m = r.modes[id];
        const d = r.deltas[id];
        const s = r.scenario;
        rows.push([
          csv(s.name), s.seed, csv(s.demandProfile), s.durationSec, csv(s.origin), csv(s.destinationHospital),
          m.mode, csv(m.modeLabel), m.outcome, m.arrived,
          nz(m.travelTimeSec), nz(d.travelTimeSec), nz(d.travelTimePct),
          nz(m.redLightWaitSec), nz(m.queueDelaySec), nz(m.stoppedTimeSec), nz(m.distanceTravelledM), nz(m.routeLengthM),
          m.collisionViolations, m.signalInterventions, m.safeTransitionViolations,
          m.rerouteCount,
          m.ordinary.tracked, m.ordinary.completed, nz(m.ordinary.meanTravelTimeSec),
          nz(d.ordinaryMeanTravelTimeSec), nz(d.ordinaryMeanTravelTimePct),
          nz(m.ordinary.meanStoppedTimeSec), m.checksum,
        ].join(','));
      }
    }
    return rows.join('\n');
  }

  function nz(v) { return (v === null || v === undefined) ? '' : v; }
  function csv(v) {
    const s = String(v === undefined || v === null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Human-readable console table for the CLI and test output. */
  function formatTable(results) {
    const list = Array.isArray(results) ? results : [results];
    const lines = [];
    for (const r of list) {
      const s = r.scenario;
      lines.push('');
      lines.push('='.repeat(96));
      lines.push('SCENARIO: ' + s.name + '  |  seed=' + s.seed
        + '  |  demand=' + s.demandProfile + '  |  ' + s.durationSec + 's'
        + (s.congestionEvents.length ? '  |  events=' + s.congestionEvents.length : ''));
      lines.push('  ' + s.origin + '  ->  ' + s.destinationHospital);
      lines.push('='.repeat(96));
      lines.push('mode  outcome     ambTime  dSec    dPct     redLight  queue   stopped  dist_m   reroutes  sigInt  ordMeanT  dOrdT   dOrd%   collisions  safeViol');
      for (const id of MODE_IDS) {
        const m = r.modes[id];
        const d = r.deltas[id];
        lines.push([
          ' ' + m.mode + '   ',
          pad(m.outcome, 11),
          pad(nz(m.travelTimeSec), 8),
          pad(nz(d.travelTimeSec), 7),
          pad(nz(d.travelTimePct), 8),
          pad(nz(m.redLightWaitSec), 9),
          pad(nz(m.queueDelaySec), 7),
          pad(nz(m.stoppedTimeSec), 8),
          pad(nz(m.distanceTravelledM), 8),
          pad(m.rerouteCount, 9),
          pad(m.signalInterventions, 7),
          pad(nz(m.ordinary.meanTravelTimeSec), 9),
          pad(nz(d.ordinaryMeanTravelTimeSec), 7),
          pad(nz(d.ordinaryMeanTravelTimePct), 7),
          pad(m.collisionViolations, 11),
          pad(m.safeTransitionViolations, 8),
        ].join(' '));
      }
    }
    return lines.join('\n');
  }

  function pad(v, w) {
    const s = String(v);
    return s.length >= w ? s : s + ' '.repeat(w - s.length);
  }

  return {
    MODES,
    MODE_IDS,
    DT,
    DNF_TIMEOUT,
    ARRIVED,
    resolveDeps,
    buildWorld,
    runWorld,
    runComparison,
    toJSON,
    toCSV,
    formatTable,
  };
}));
