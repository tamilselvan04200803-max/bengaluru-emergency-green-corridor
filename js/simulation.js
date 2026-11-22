/**
 * js/simulation.js
 * Deterministic Fixed-Timestep Traffic Simulation Engine — Phase 3 Complete
 *
 * dt = 0.1s fixed. All stochasticity via seeded PRNG (simulation.seed).
 * No Math.random() in simulation logic.
 *
 * Browser-global (window.SimulationEngine) and CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SimulationEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // =============================================================================
  // DETERMINISTIC SEEDED PRNG (Mulberry32)
  // =============================================================================
  class SeededRandom {
    constructor(seed = 1) {
      this.state = seed >>> 0;
    }
    seed(seed) { this.state = seed >>> 0; }
    next() {
      this.state = (this.state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    nextFloat() { return this.next(); }
    nextInt(max) { return Math.floor(this.next() * max); }
    nextBool(p = 0.5) { return this.next() < p; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = this.nextInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  }

  // =============================================================================
  // VEHICLE CLASS DEFINITIONS (exact Bengaluru fleet dimensions)
  // =============================================================================
  const VEHICLE_CLASSES = {
    TWO_WHEELER: {
      id: 'TWO_WHEELER',
      name: '2-Wheeler',
      length: 2.1,
      width: 0.8,
      height: 1.2,
      mass: 250,
      aMax: 2.0,
      comfortableDecel: 2.5,
      emergencyDecel: 4.0,
      idm: { v0: 13.9, T: 0.8, s0: 0.8, a: 2.0, b: 2.5 },
      color: 0xff6600,
      spawnWeight: 0.45,
    },
    AUTO_RICKSHAW: {
      id: 'AUTO_RICKSHAW',
      name: 'Auto-Rickshaw / 3W',
      length: 2.8,
      width: 1.2,
      height: 1.8,
      mass: 600,
      aMax: 1.5,
      comfortableDecel: 2.0,
      emergencyDecel: 3.5,
      idm: { v0: 11.1, T: 1.0, s0: 1.0, a: 1.5, b: 2.0 },
      color: 0x00ccff,
      spawnWeight: 0.20,
    },
    PASSENGER_CAR: {
      id: 'PASSENGER_CAR',
      name: 'Passenger Car',
      length: 4.5,
      width: 1.8,
      height: 1.5,
      mass: 1400,
      aMax: 2.5,
      comfortableDecel: 3.0,
      emergencyDecel: 5.0,
      idm: { v0: 16.7, T: 1.2, s0: 1.5, a: 2.5, b: 3.0 },
      color: 0x4488ff,
      spawnWeight: 0.25,
    },
    BMTC_BUS: {
      id: 'BMTC_BUS',
      name: 'BMTC Bus',
      length: 12.0,
      width: 2.5,
      height: 3.2,
      mass: 16000,
      aMax: 1.0,
      comfortableDecel: 2.0,
      emergencyDecel: 3.5,
      idm: { v0: 13.9, T: 1.5, s0: 2.5, a: 1.0, b: 2.0 },
      color: 0xcc4400,
      spawnWeight: 0.08,
    },
    AMBULANCE: {
      id: 'AMBULANCE',
      name: 'Ambulance',
      length: 5.5,
      width: 2.1,
      height: 2.4,
      mass: 3500,
      aMax: 2.5,
      comfortableDecel: 3.0,
      emergencyDecel: 4.5,
      idm: { v0: 22.2, T: 0.7, s0: 1.0, a: 2.5, b: 3.0 },
      color: 0xffffff,
      spawnWeight: 0.0,
      isEmergency: true,
    },
  };

  const MIN_GAP = 0.5; // hard zero-overlap invariant: front-to-rear gap >= 0.5m

  // =============================================================================
  // TRIP SINKS
  // =============================================================================
  // Every generated vehicle is dispatched to one of three sink classes. The
  // classes are a modelling choice, not survey data: the assignment of a named
  // junction to "commercial" or "residential" is ASSUMED from its land use.
  // A vehicle despawns when it reaches its assigned sink, which is what keeps
  // the active population bounded by demand rather than growing without limit.
  const SINK_NODES = {
    hospital: {
      provenance: 'ASSUMED',
      nodes: [
        'node_victoria_hospital_gate', 'node_victoria_hospital_main',
        'node_bowring_hospital_gate', 'node_st_marthas',
        'node_kasturba_cross', 'node_st_johns', 'node_manipal_hospital',
      ],
    },
    commercial: {
      provenance: 'ASSUMED',
      nodes: [
        'node_mg_road', 'node_anil_kumble_circle', 'node_forum',
        'node_sony_world', 'node_corporation_circle', 'node_kr_market_junction',
        'node_trinity', 'node_hudson_circle', 'node_kr_circle',
      ],
    },
    residential: {
      provenance: 'ASSUMED',
      nodes: [
        'node_btm_layout', 'node_jayadeva', 'node_indiranagar_100ft',
        'node_domlur', 'node_shivajinagar', 'node_hebbal_flyover',
        'node_mekhri_circle', 'node_lalbagh_west', 'node_nimhans',
        'node_raj_bhavan', 'node_vidhana_soudha', 'node_mysore_bank',
        'node_silk_board', 'node_tipu_palace', 'node_fort_junction',
        'node_sheshadri_junction', 'node_kg_road_mid', 'node_majestic',
      ],
    },
  };

  // =============================================================================
  // DEMAND PROFILES
  // =============================================================================
  const DEMAND_PROFILES = {
    peak: {
      vehiclesPerMinute: 150, // network-wide, across all entry edges
      classWeights: { TWO_WHEELER: 0.50, AUTO_RICKSHAW: 0.20, PASSENGER_CAR: 0.25, BMTC_BUS: 0.05 },
      sinkWeights: { hospital: 0.15, commercial: 0.50, residential: 0.35 },
      provenance: 'SIMULATED',
    },
    off_peak: {
      vehiclesPerMinute: 45,
      classWeights: { TWO_WHEELER: 0.40, AUTO_RICKSHAW: 0.15, PASSENGER_CAR: 0.40, BMTC_BUS: 0.05 },
      sinkWeights: { hospital: 0.10, commercial: 0.30, residential: 0.60 },
      provenance: 'SIMULATED',
    },
  };

  // =============================================================================
  // HOSPITAL BAY STATE MACHINE
  // =============================================================================
  const BAY_STATE = {
    FREE: 'FREE',
    OCCUPIED: 'OCCUPIED',
    RESERVED: 'RESERVED',
    LOCKED: 'LOCKED', // discharging patient, no entry
  };

  const AMBULANCE_STATE = {
    EN_ROUTE: 'EN_ROUTE',
    APPROACHING_BAY: 'APPROACHING_BAY',
    DOCKING: 'DOCKING',
    DWELLING: 'DWELLING',
    DEPARTING: 'DEPARTING',
    BAY_RELEASED: 'BAY_RELEASED',
  };

  const DWELL_TIME_SEC = 30.0;
  // Time to pull clear of the bay before it is handed back to the next
  // ambulance. Keeps DEPARTING a real phase rather than an instant hop.
  const DEPART_TIME_SEC = 5.0;

  // =============================================================================
  // SIMULATION VEHICLE INSTANCE
  // =============================================================================
  class SimVehicle {
    constructor(id, cls, edge, laneIndex, spawnS, random) {
      this.id = id;
      this.cls = cls;
      this.edge = edge;
      this.laneIndex = laneIndex;
      this.s = spawnS; // arc-length along edge polyline [0, edge.length]
      this.v = 0.0; // m/s
      this.a = 0.0; // m/s^2
      this.targetV = cls.idm.v0; // m/s
      this.driver = {
        reactionTime: cls.idm.T + (random.nextFloat() - 0.5) * 0.2, // ±0.1s noise
        aggressiveness: 0.8 + random.nextFloat() * 0.4, // 0.8..1.2
      };
      this.stopLineS = edge.stopLineOffsetM || edge.length;
      this.hasCrossedStopLine = false;
      this.queuePosition = 0; // vehicles ahead in same lane
      this.timeInQueue = 0;
      this.collisionViolations = 0;

      // Ambulance-specific state
      this.ambulanceState = null; // EN_ROUTE | APPROACHING_BAY ...
      this.targetBay = null;
      this.dwellTimer = 0.0;
      this.departTimer = 0.0;
      this.bayArrivalTimeSec = 0.0;
      this.tripStartTimeSec = 0.0;
      this.assignedBay = null;
    }

    /** IDM car-following acceleration. */
    idmAccel(leadVehicle, edge) {
      const p = this.cls.idm;
      const s = this.s;
      const v = this.v;
      // An incident lowers the achievable speed on the edge rather than making
      // it an on/off wall: vehicles genuinely slow, the congestion measurement
      // sees that slowdown, and the router reacts to the measured reality
      // instead of to an invisible flag.
      const incident = edge.incidentSpeedFactor || 1.0;
      const v0 = p.v0 * Math.min(1, (edge.maxspeedKmh / 3.6) * incident / p.v0);
      const T = this.driver.reactionTime;
      const s0 = p.s0 * this.driver.aggressiveness;
      const a = p.a * this.driver.aggressiveness;
      const b = p.b;

      let deltaS, deltaV;
      if (leadVehicle) {
        deltaS = leadVehicle.s - s - leadVehicle.cls.length;
        deltaV = v - leadVehicle.v;
      } else {
        deltaS = 1e9;
        deltaV = 0;
      }
      if (deltaS < MIN_GAP) deltaS = MIN_GAP; // hard floor

      const sStar = s0 + v * T + (v * deltaV) / (2 * Math.sqrt(a * b));
      const accelFree = a * (1 - Math.pow(v / v0, 4));
      const accelInteract = -a * Math.pow(sStar / deltaS, 2);
      return Math.max(-b, Math.min(a, accelFree + accelInteract));
    }

    /** Priority-aware IDM for ambulance: smaller gap, keeps to the speed limit. */
    ambulanceAccel(leadVehicle, edge) {
      const p = this.cls.idm;
      const s = this.s;
      const v = this.v;
      // Emergency vehicles get priority, not a speed-limit exemption. A corridor
      // benefit that came from driving over the limit would not be a corridor
      // benefit, so the measured saving stays attributable to preemption alone.
      const incident = edge.incidentSpeedFactor || 1.0;
      const v0 = Math.min((edge.maxspeedKmh / 3.6) * incident, p.v0);
      const T = p.T * 0.7;
      const s0 = 0.8; // tighter following
      const a = p.a;
      const b = p.b;

      let deltaS, deltaV;
      if (leadVehicle) {
        deltaS = leadVehicle.s - s - leadVehicle.cls.length;
        deltaV = v - leadVehicle.v;
      } else {
        deltaS = 1e9;
        deltaV = 0;
      }
      if (deltaS < MIN_GAP) deltaS = MIN_GAP;

      const sStar = s0 + v * T + (v * deltaV) / (2 * Math.sqrt(a * b));
      const accelFree = a * (1 - Math.pow(v / v0, 4));
      const accelInteract = -a * Math.pow(sStar / deltaS, 2);
      return Math.max(-b, Math.min(a, accelFree + accelInteract));
    }
  }

  // =============================================================================
  // PER-LANE FIFO QUEUE MANAGER
  // =============================================================================
  class LaneQueue {
    constructor(edge, laneIndex, stopLineS) {
      this.edge = edge;
      this.laneIndex = laneIndex;
      this.stopLineS = stopLineS;
      this.vehicles = []; // ordered by s descending (front of queue at index 0)
    }

    /** Insert vehicle maintaining order by s (furthest along first). */
    enqueue(veh) {
      let i = 0;
      while (i < this.vehicles.length && this.vehicles[i].s > veh.s) i += 1;
      this.vehicles.splice(i, 0, veh);
      this._reindex();
    }

    remove(veh) {
      const i = this.vehicles.indexOf(veh);
      if (i >= 0) this.vehicles.splice(i, 1);
      this._reindex();
    }

    _reindex() {
      for (let i = 0; i < this.vehicles.length; i += 1) {
        this.vehicles[i].queuePosition = i;
      }
    }

    /** Lead vehicle ahead of `veh` in this lane (or null if `veh` is the leader). */
    leaderOf(veh) {
      const i = this.vehicles.indexOf(veh);
      if (i <= 0) return null;
      return this.vehicles[i - 1];
    }

    /** Vehicles queued upstream of stop line (v < 0.5 m/s). */
    queuedCount() {
      return this.vehicles.filter(v => v.s <= this.stopLineS && v.v < 0.5).length;
    }

    /** All vehicles on this lane. */
    all() { return this.vehicles; }
  }

  // =============================================================================
  // HOSPITAL BAY MANAGER
  // =============================================================================
  class HospitalBayManager {
    constructor(network) {
      this.network = network;
      this.bays = new Map(); // hospitalId -> { bay_a, bay_b } each with { state, vehicleId, position, queue }
    }

    initFromHospitals() {
      for (const hosp of this.network.hospitals.values()) {
        this.bays.set(hosp.id, {
          bay_a: { id: hosp.bays.bay_a.id, state: BAY_STATE.FREE, vehicleId: null, position: hosp.bays.bay_a.position, queue: [] },
          bay_b: { id: hosp.bays.bay_b.id, state: BAY_STATE.FREE, vehicleId: null, position: hosp.bays.bay_b.position, queue: [] },
          ingressNodeId: hosp.ingress_node,
          driveway: hosp.driveway,
        });
      }
    }

    /**
     * Claim a free bay at `hospitalId` (preferring bay_a). Returns
     * { hospitalId, bayId, bay, ingressNodeId } or null when both bays are
     * taken. Scoped to one hospital so concurrent ambulances to different
     * hospitals never contend for the same bay.
     */
    requestBay(hospitalId, vehicleId) {
      const hosp = this.bays.get(hospitalId);
      if (!hosp) return null;
      for (const bayKey of ['bay_a', 'bay_b']) {
        const bay = hosp[bayKey];
        if (bay.state === BAY_STATE.FREE) {
          bay.state = BAY_STATE.RESERVED;
          bay.vehicleId = vehicleId;
          return { hospitalId, bayId: bayKey, bay, ingressNodeId: hosp.ingressNodeId };
        }
      }
      return null;
    }

    /** Mark bay as occupied (vehicle arrived at bay). */
    occupyBay(hospitalId, bayKey, vehicleId) {
      const hosp = this.bays.get(hospitalId);
      if (hosp && hosp[bayKey] && hosp[bayKey].vehicleId === vehicleId) {
        hosp[bayKey].state = BAY_STATE.OCCUPIED;
        return true;
      }
      return false;
    }

    /** Start dwelling (patient transfer). */
    startDwell(hospitalId, bayKey, vehicleId) {
      const hosp = this.bays.get(hospitalId);
      if (hosp && hosp[bayKey] && hosp[bayKey].vehicleId === vehicleId) {
        hosp[bayKey].state = BAY_STATE.LOCKED;
        return true;
      }
      return false;
    }

    /** Release bay after dwelling complete. */
    releaseBay(hospitalId, bayKey, vehicleId) {
      const hosp = this.bays.get(hospitalId);
      if (hosp && hosp[bayKey] && hosp[bayKey].vehicleId === vehicleId) {
        hosp[bayKey].state = BAY_STATE.FREE;
        hosp[bayKey].vehicleId = null;
        return true;
      }
      return false;
    }

    /** Get bay info for ambulance to navigate to. */
    getBayInfo(hospitalId, bayKey) {
      const hosp = this.bays.get(hospitalId);
      if (hosp && hosp[bayKey]) return hosp[bayKey];
      return null;
    }

    /** Check if a vehicle is en route to a specific bay. */
    isVehicleEnRouteToBay(hospitalId, bayKey, vehicleId) {
      const hosp = this.bays.get(hospitalId);
      if (hosp && hosp[bayKey]) return hosp[bayKey].vehicleId === vehicleId;
      return false;
    }
  }

  // =============================================================================
  // MAIN SIMULATION ENGINE
  // =============================================================================
  const DT = 0.1; // fixed timestep, seconds

  class SimulationEngine {
    constructor(network, signalManager = null, seed = 42, projection = null) {
      this.network = network;
      this.signalManager = signalManager;
      this.projection = projection;
      this.random = new SeededRandom(seed);
      this.seed = seed;
      this.time = 0.0;
      this.tick = 0;

      this.vehicles = new Map(); // id -> SimVehicle
      this.laneQueues = new Map(); // edgeId|laneIndex -> LaneQueue
      this.activeVehicleCount = 0;
      this.collisionViolations = 0;

      // Statistics
      this.spawnedCount = 0;
      this.despawnedCount = 0;
      this.signalInterventions = 0;
      this.totalAddedWaitTime = 0;

      // Demand profile
      this.demandProfile = 'off_peak';
      this.spawnTimer = 0;

      // Ambulance tracking
      this.ambulances = new Map();

      // Hospital bay management
      this.bayManager = new HospitalBayManager(network);
      this.bayManager.initFromHospitals();

      // Congestion measurement (live, no double-counting)
      this.edgeCongestion = new Map(); // edgeId -> { density, meanSpeedMps, queueDelaySec, vehicleCount }
      this.congestionUpdateInterval = 1.0; // seconds
      this.lastCongestionUpdate = 0;

      // Routing callback (to push live travel times into js/routing.js RoadGraph)
      this.onCongestionUpdate = null;
      // Optional SmartRoutingController; its priority requests are consumed
      // each tick and turned into signal preemption calls.
      this.routingController = null;

      // Decision log for verification
      this.decisionLog = [];

      // Completed ambulance trips, retained after the vehicle is despawned so
      // arrival/parking outcomes stay inspectable once the trip is over.
      this.completedTrips = new Map();

      this._initLaneQueues();
      this._initSinkDistances();
    }

    /**
     * Reverse-BFS hop distance from every node to each sink class. Gives each
     * generated vehicle a deterministic, congestion-independent way to pick the
     * outgoing edge that actually makes progress toward its destination, so the
     * active population is bounded by arrivals rather than looping forever.
     */
    _initSinkDistances() {
      this.sinkDistances = new Map();
      for (const [sinkClass, def] of Object.entries(SINK_NODES)) {
        const dist = new Map();
        const queue = [];
        for (const nodeId of def.nodes) {
          if (this.network.getNode(nodeId) && !dist.has(nodeId)) {
            dist.set(nodeId, 0);
            queue.push(nodeId);
          }
        }
        for (let i = 0; i < queue.length; i += 1) {
          const nodeId = queue[i];
          const d = dist.get(nodeId);
          for (const edge of this.network.getIncoming(nodeId)) {
            if (!dist.has(edge.fromNodeId)) {
              dist.set(edge.fromNodeId, d + 1);
              queue.push(edge.fromNodeId);
            }
          }
        }
        this.sinkDistances.set(sinkClass, dist);
      }
    }

    _initLaneQueues() {
      for (const edge of this.network.getEdgeList()) {
        for (let lane = 0; lane < edge.lanes; lane += 1) {
          const key = `${edge.id}|${lane}`;
          this.laneQueues.set(key, new LaneQueue(edge, lane, edge.stopLineOffsetM || edge.length));
        }
      }
    }

    /** Set deterministic seed (re-seeds PRNG, resets time). */
    setSeed(seed) {
      this.seed = seed >>> 0;
      this.random = new SeededRandom(this.seed);
      this.time = 0.0;
      this.tick = 0;
    }

    setDemandProfile(profile) {
      this.demandProfile = profile;
      this.spawnTimer = 0;
    }

    /** Register a callback to receive live congestion for routing.js integration. */
    setCongestionCallback(cb) { this.onCongestionUpdate = cb; }

    /** Wire the SmartRoutingController so its Tier-2 priority requests drive preemption. */
    setRoutingController(controller) { this.routingController = controller; }

    /** Main simulation step. */
    step(dt = DT) {
      this.time += dt;
      this.tick += 1;

      // 1. Spawn vehicles at entry edges
      this._spawnVehicles(dt);

      // 2. Update each vehicle
      const toDespawn = [];
      for (const veh of this.vehicles.values()) {
        this._updateVehicle(veh, dt);
        // Ordinary vehicles that run off the end of the network end their trip
        // here. Ambulances are long-lived: their lifecycle is owned by the
        // hospital bay state machine, which despawns them at BAY_RELEASED.
        if (!veh.cls.isEmergency && veh.s >= veh.edge.length - 0.1) {
          toDespawn.push(veh.id);
        }
      }
      for (const id of toDespawn) this._despawnVehicle(id);

      // 3. Update queues & enforce stop-line
      this._enforceStopLines();

      // 4. Collision detection (assert zero-overlap)
      this._checkCollisions();

      // 5. Update signal preemption from signal manager (if available)
      this._updateSignalPreemption();

      // 6. Measure live congestion and feed routing
      this._measureCongestion(dt);

      // 7. Ambulance bay state machine
      this._updateAmbulanceBays(dt);

      return this._getSnapshot();
    }

    /** Spawn vehicles at network entry edges per demand profile. */
    _spawnVehicles(dt) {
      const profile = DEMAND_PROFILES[this.demandProfile];
      if (!profile) return;

      const entryEdges = this.network.getEntryEdges();
      if (entryEdges.length === 0) return;

      // Poisson-style arrivals: a deterministic Bernoulli trial per tick whose
      // probability is lambda * dt. A deferred spawn (no clearance) is simply
      // dropped rather than retried in a tight loop.
      const lambdaPerSec = profile.vehiclesPerMinute / 60.0;
      if (this.random.next() >= lambdaPerSec * dt) return;

      // Pick entry edge uniformly at random amongst the ranked entry list.
      const edge = entryEdges[this.random.nextInt(entryEdges.length)];

      // Pick class by weights
      const r = this.random.nextFloat();
      let cum = 0, chosenClass = 'PASSENGER_CAR';
      for (const [clsId, w] of Object.entries(profile.classWeights)) {
        cum += w;
        if (r <= cum) { chosenClass = clsId; break; }
      }
      const cls = VEHICLE_CLASSES[chosenClass];

      // Pick lanes by clearance: try the least-occupied lane first, then others.
      const laneOrder = [];
      for (let lane = 0; lane < edge.lanes; lane += 1) laneOrder.push(lane);
      laneOrder.sort((a, b) =>
        this.laneQueues.get(`${edge.id}|${a}`).vehicles.length -
        this.laneQueues.get(`${edge.id}|${b}`).vehicles.length);

      // Pick sink class by weights, then the sink node of that class.
      const rs = this.random.nextFloat();
      let cumSink = 0, sinkClass = 'commercial';
      for (const [cls, w] of Object.entries(profile.sinkWeights)) {
        cumSink += w;
        if (rs <= cumSink) { sinkClass = cls; break; }
      }
      const sinkList = (SINK_NODES[sinkClass] || SINK_NODES.commercial).nodes;
      const sinkNode = sinkList[this.random.nextInt(sinkList.length)];

      for (const lane of laneOrder) {
        const queue = this.laneQueues.get(`${edge.id}|${lane}`);
        // Safe clearance: the new vehicle's rear sits at s=0, so the vehicle
        // already on the lane must be far enough ahead that the gap clears
        // *its* length (which may be much longer than the one spawning).
        const lastVeh = queue.vehicles[queue.vehicles.length - 1];
        if (lastVeh && lastVeh.s < lastVeh.cls.length + MIN_GAP + 1.0) continue;

        const id = `veh_${this.spawnedCount++}`;
        const veh = new SimVehicle(id, cls, edge, lane, 0.0, this.random);
        veh.sinkClass = sinkClass;
        veh.sinkNodeId = sinkNode;
        this.vehicles.set(id, veh);
        queue.enqueue(veh);
        this.activeVehicleCount = this.vehicles.size;
        return;
      }
      // Every lane lacked safe clearance: defer this spawn.
    }

    _leastOccupiedLane(edge) {
      let best = 0, bestCount = Infinity;
      for (let lane = 0; lane < edge.lanes; lane += 1) {
        const q = this.laneQueues.get(`${edge.id}|${lane}`);
        if (q.vehicles.length < bestCount) { bestCount = q.vehicles.length; best = lane; }
      }
      return best;
    }

    /** Vehicle longitudinal update with car-following. */
    _updateVehicle(veh, dt) {
      const edge = veh.edge;

      // A parked ambulance has finished its trip: it is off-lane and inert.
      if (veh.tripComplete) {
        veh.v = 0;
        return;
      }

      // Blocked edge: hold the vehicle at its current position.
      if (edge._blocked) {
        veh.v = 0;
        return;
      }

      const queue = this.laneQueues.get(`${veh.edge.id}|${veh.laneIndex}`);
      const leader = queue.leaderOf(veh);

      // Determine acceleration
      let accel;
      if (veh.cls.isEmergency) {
        accel = veh.ambulanceAccel(leader, edge);
        // The bay machine commands a target speed (0 while docking or holding at
        // a driveway, 5 m/s while departing). IDM alone would always accelerate
        // back to free-flow v0, so the command is applied as a speed governor on
        // top of car-following — otherwise the ambulance could never come to rest.
        const dv = veh.targetV - veh.v;
        accel = dv < 0
          ? Math.min(accel, Math.max(dv / dt, -veh.cls.emergencyDecel))
          : Math.min(accel, dv / dt);
      } else {
        accel = veh.idmAccel(leader, edge);
      }

      // Stop-line enforcement: ordinary vehicles must stop on red/amber.
      // Only the lead vehicle of a lane brakes for the stop line; followers are
      // handled by car-following against that leader, so vehicles do not stack
      // at a single point.
      if (!veh.cls.isEmergency && !leader) {
        const signalState = this._signalStateForEdge(veh.edge);
        const isStop = signalState === 'RED' || signalState === 'ALL_RED_CLEARANCE'
          || signalState === 'AMBER';
        const distToStop = veh.stopLineS - veh.s;

        if (isStop && distToStop > -MIN_GAP && distToStop < 60.0) {
          // Decelerate to a halt at the stop line on a physically achievable
          // profile: the required decel is whatever stops the vehicle exactly at
          // the line. It is capped at emergency braking; if the vehicle is too
          // close for even that, it is already committed and clears the line
          // rather than being teleported to a dead stop (which would leave the
          // follower no stopping distance at all).
          const gap = Math.max(0.5, distToStop - MIN_GAP);
          const requiredDecel = -(veh.v * veh.v) / (2 * gap);
          if (requiredDecel >= -veh.cls.emergencyDecel) {
            accel = Math.min(accel, requiredDecel);
          }
        }
      }

      // Kinematic update. Distance uses the trapezoidal rule over the clamped
      // final velocity: v0*dt + 0.5*a*dt^2 is identical whenever v stays
      // positive, but applying that form after clamping v at 0 would subtract
      // 0.5*a*dt^2 from a stopped vehicle's position and creep it backwards,
      // eroding the gap to the vehicle behind it.
      const v0 = veh.v;
      const v1 = Math.max(0, v0 + accel * dt);
      veh.s += 0.5 * (v0 + v1) * dt;
      veh.v = v1;
      veh.s = Math.min(veh.s, edge.length);
      veh.a = accel;

      // Hard bumper constraint. IDM is a comfort model and caps braking at b, so
      // a follower can still overrun a leader that braked far harder than b (the
      // emergency stop-line profile is capped at emergencyDecel). Clamping the
      // position at the physical limit keeps the zero-overlap invariant an
      // invariant rather than something _checkCollisions has to repair.
      if (leader) {
        const maxS = leader.s - leader.cls.length - MIN_GAP;
        if (veh.s > maxS) {
          veh.s = Math.max(0, maxS);
          veh.v = Math.min(veh.v, leader.v);
          veh.a = Math.min(veh.a, 0);
        }
      }

      // Queue time tracking
      if (veh.s <= veh.stopLineS && veh.v < 0.5) {
        veh.timeInQueue += dt;
      }

      // Junction handoff: if vehicle reaches end of edge, transfer to next edge
      if (veh.s >= edge.length - 0.1) {
        this._handOffAtJunction(veh, edge);
      }
    }

    _signalStateForEdge(edge) {
      if (this.signalManager && this.signalManager.getSignal) {
        // Find signal for the junction this edge feeds
        const sig = this.signalManager.getSignalByNode(edge.toNodeId);
        if (sig) return sig.currentState;
      }
      return 'GREEN';
    }

    /** World-space position of a vehicle's front bumper (for preemption math). */
    _vehicleWorldPos(veh) {
      const sample = veh.edge.sampleAt(veh.s);
      if (!this.projection) {
        return { x: sample.lon, y: sample.alt, z: sample.lat };
      }
      return this.projection.latLonAltToCartesian(sample.lat, sample.lon, sample.alt);
    }

    /** Transfer vehicle to downstream edge at junction, or end its trip. */
    _handOffAtJunction(veh, fromEdge) {
      const nodeId = fromEdge.toNodeId;

      // --- Trip termination --------------------------------------------------
      const amb = this.ambulances.get(veh.id);
      if (amb) {
        if (amb.routeEdgeIds) {
          const idx = amb.routeEdgeIds.indexOf(fromEdge.id);
          if (idx >= 0 && idx + 1 < amb.routeEdgeIds.length) {
            amb.currentEdgeIndex = idx + 1;
            return this._moveToEdge(veh, fromEdge, amb.routeEdgeIds[idx + 1]);
          }
        }
        // Route exhausted. If the ambulance is still EN_ROUTE this is a failed
        // trip, not a U-turn: hold it at the terminus so the bay machine can
        // finish; the bay machine is what eventually removes it.
        if (veh.ambulanceState === AMBULANCE_STATE.EN_ROUTE) {
          veh.v = 0;
          veh.s = fromEdge.length;
        }
        return;
      }

      // A generated vehicle reaching its assigned sink has completed its trip.
      if (veh.sinkNodeId && nodeId === veh.sinkNodeId) {
        this._despawnVehicle(veh.id);
        return;
      }

      // --- Ordinary junction choice -----------------------------------------
      const outgoing = this.network.getOutgoing(nodeId);
      if (outgoing.length === 0) {
        this._despawnVehicle(veh.id); // dead end: trip ends here
        return;
      }

      const nextEdge = this._selectSinkEdge(veh, outgoing);
      this._moveToEdge(veh, fromEdge, nextEdge.id);
    }

    /**
     * Pick the outgoing edge that moves the vehicle closest to its sink, using
     * polyline hop distance. Avoids U-turning onto the edge it just came from
     * unless that is the only option.
     */
    _selectSinkEdge(veh, outgoing) {
      const dist = this.sinkDistances.get(veh.sinkClass);
      const candidates = outgoing.filter(e => e.id !== veh.edge.id);
      const pool = candidates.length > 0 ? candidates : outgoing;
      let best = pool[0];
      let bestScore = Infinity;
      for (const edge of pool) {
        const hop = dist ? dist.get(edge.toNodeId) : undefined;
        const score = hop === undefined ? 1e6 : hop;
        if (score < bestScore) { bestScore = score; best = edge; }
      }
      return best;
    }

    /** Move a vehicle onto the start of `nextEdgeId` if the lane has clearance. */
    _moveToEdge(veh, fromEdge, nextEdgeId) {
      const nextEdge = this.network.getEdge(nextEdgeId);
      if (!nextEdge) return false;

      const oldQueue = this.laneQueues.get(`${fromEdge.id}|${veh.laneIndex}`);
      const nextLane = Math.min(veh.laneIndex, nextEdge.lanes - 1);
      const newQueue = this.laneQueues.get(`${nextEdge.id}|${nextLane}`);

      // Safe clearance on the receiving lane: this vehicle arrives at s=0, so
      // the vehicle already there must be far enough ahead to clear the gap
      // behind *its own* rear bumper.
      const lastVeh = newQueue.vehicles[newQueue.vehicles.length - 1];
      if (lastVeh && lastVeh.s < lastVeh.cls.length + MIN_GAP + 1.0) {
        // Space not ready: hold at the junction on the old edge and retry next
        // tick. Clamp s just short of the terminus so the vehicle is not
        // treated as having arrived and will not be despawned meanwhile.
        veh.s = fromEdge.length - 0.2;
        veh.v = Math.min(veh.v, 2.0);
        if (oldQueue) oldQueue.enqueue(veh);
        return false;
      }

      if (oldQueue) oldQueue.remove(veh);
      veh.edge = nextEdge;
      veh.laneIndex = nextLane;
      veh.s = 0.0;
      veh.stopLineS = nextEdge.stopLineOffsetM || nextEdge.length;
      veh.hasCrossedStopLine = false;
      newQueue.enqueue(veh);
      return true;
    }

    /**
     * Safety net for the stop line. The lead vehicle of a lane already brakes for
     * a red/amber aspect in _updateVehicle; this catches the rare overshoot. It
     * only halts a vehicle that is already essentially at the line and slow — it
     * never teleports a moving vehicle, because a car that stops dead on the
     * line leaves the follower no stopping distance and manufactures an overlap.
     */
    _enforceStopLines() {
      for (const queue of this.laneQueues.values()) {
        const vs = queue.vehicles;
        for (let i = 0; i < vs.length; i += 1) {
          const veh = vs[i];
          if (veh.cls.isEmergency || veh.hasCrossedStopLine) continue;
          if (veh.s <= veh.stopLineS) continue;

          const signalState = this._signalStateForEdge(veh.edge);
          if (signalState !== 'RED' && signalState !== 'ALL_RED_CLEARANCE' && signalState !== 'AMBER') {
            veh.hasCrossedStopLine = true;
            continue;
          }

          // Only clamp a vehicle that has barely crept past the line, and only
          // when doing so does not push it back into the vehicle behind.
          const ahead = i > 0 ? vs[i - 1] : null;
          const limit = ahead
            ? Math.min(veh.stopLineS, ahead.s - ahead.cls.length - MIN_GAP)
            : veh.stopLineS;
          if (veh.s - veh.stopLineS <= 0.5 && limit >= veh.s - 0.5 && limit < veh.s) {
            veh.s = Math.max(0, limit);
            veh.v = 0;
          } else if (veh.s - veh.stopLineS > 0.5) {
            // Too far past the line to clamp safely: it has effectively crossed.
            // Do not snap it backwards through the queue.
            veh.hasCrossedStopLine = true;
          }
        }
      }
    }

    /** Hard collision check: assert front-to-rear gap >= MIN_GAP on every lane. */
    _checkCollisions() {
      for (const queue of this.laneQueues.values()) {
        const vs = queue.vehicles;
        for (let i = 1; i < vs.length; i += 1) {
          const rear = vs[i];
          const front = vs[i - 1];
          const gap = front.s - rear.s - front.cls.length;
          if (gap < MIN_GAP - 1e-6) {
            this.collisionViolations += 1;
            rear.collisionViolations += 1;
            // Emergency correction: push back
            rear.s = front.s - front.cls.length - MIN_GAP;
            rear.v = Math.min(rear.v, front.v);
          }
        }
      }
    }

    _despawnVehicle(id) {
      const veh = this.vehicles.get(id);
      if (!veh) return;
      const queue = this.laneQueues.get(`${veh.edge.id}|${veh.laneIndex}`);
      queue.remove(veh);
      this.vehicles.delete(id);
      this.activeVehicleCount = this.vehicles.size;
      this.despawnedCount += 1;
    }

    _updateSignalPreemption() {
      if (!this.signalManager) return;

      // 1. Consume Tier-2 priority requests from SmartRoutingController.
      //    Each request targets a signal id; the controller guarantees the
      //    ambulance is within 250 m / 25 s of the junction, so the signal's
      //    own machine walks the safe amber/all-red transition before green.
      if (this.routingController) {
        const ambState = this._ambulanceStateForRouting();
        if (ambState) {
          const result = this.routingController.update(ambState, DT, this.time);
          if (result.priorityRequests && result.priorityRequests.length > 0) {
            for (const req of result.priorityRequests) {
              const sig = this.signalManager.getSignal(req.junctionId);
              if (sig && !sig.isPreempted) {
                sig.queuePreemption();
                this.signalInterventions += 1;
                this._logDecision(ambState.ambulanceId, 'TIER2_PRIORITY',
                  req.edgeId, req.junctionId,
                  req.etaSec, `Preemption queued for ${req.junctionId} (${req.distanceM.toFixed(0)}m, ETA ${req.etaSec.toFixed(1)}s)`);
              }
            }
          }
          if (result.reroute && result.newRoute) {
            // predictedSavingSec is a saving, not the new route's duration. The
            // controller reports timeSaved explicitly; newRoute.totalTime is an
            // absolute time and would overstate the benefit by an order of
            // magnitude on a long route.
            this._logDecision(ambState.ambulanceId, 'TIER1_REROUTE',
              this._edgeForAmbulance(ambState), result.newRoute.path[0],
              result.timeSaved || 0, `Reroute: ${result.newRoute.path.length} edges`);
            // A logged reroute that is not adopted is not a reroute. Rebase the
            // ambulance's remaining route onto the new path so it actually
            // follows the alternative.
            this._adoptReroute(ambState.ambulanceId, result.newRoute);
          }
        }
      }

      // 2. Release preemption once the ambulance has cleared the junction.
      //    When a SmartRoutingController is wired it owns the request lifecycle
      //    and retires junctions through cleanupPassedJunctions; mirror that
      //    here by releasing any preempted signal the controller no longer
      //    holds. Without a controller, fall back to the distance horizon.
      if (this.routingController) {
        const held = this.routingController.priorityRequestedJunctions;
        for (const sig of this.signalManager.getAllSignals()) {
          if (sig.isPreempted && !held.has(sig.id)) {
            sig.endPreemption();
          }
        }
      } else {
        for (const [ambId, amb] of this.ambulances) {
          const veh = this.vehicles.get(ambId);
          if (!veh) continue;
          const speedMps = Math.max(5.0, veh.v);
          const horizon = Math.min(300.0, speedMps * 25.0);
          const margin = 30.0;
          for (const sig of this.signalManager.getAllSignals()) {
            if (!sig.isPreempted) continue;
            const dist = this._distanceToSignal(veh, sig);
            // Ambulance has passed: it is beyond the horizon + margin, or it is
            // downstream of the signal's junction.
            if (dist > horizon + margin || this._hasPassedJunction(veh, sig)) {
              sig.endPreemption();
            }
          }
        }
      }

      // 3. Track ordinary-vehicle added wait time caused by preemption.
      //    Vehicles queued at a preempted junction lose green time; the extra
      //    wait is the difference between their current queue time and what
      //    free-flow would have cost them.
      this._measureAddedWaitTime();
    }

    _ambulanceStateForRouting() {
      const ambIds = Array.from(this.ambulances.keys());
      if (ambIds.length === 0) return null;
      const ambId = ambIds[0];
      const veh = this.vehicles.get(ambId);
      if (!veh) return null;
      return {
        ambulanceId: ambId,
        // A vehicle mid-edge is travelling towards the edge's downstream node,
        // so that is the node its remaining route must start from. Reporting
        // fromNodeId here would place the ambulance behind itself and the router
        // would answer with a U-turn back down the edge it is already on.
        currentNode: veh.edge.toNodeId,
        currentEdgeId: veh.edge.id,
        sOnEdge: veh.s,
        speedKmh: veh.v * 3.6,
        position: this._vehicleWorldPos(veh),
        isAtDestination: veh.ambulanceState === AMBULANCE_STATE.DOCKING
          || veh.ambulanceState === AMBULANCE_STATE.DWELLING
          || veh.ambulanceState === AMBULANCE_STATE.DEPARTING
          || veh.ambulanceState === AMBULANCE_STATE.BAY_RELEASED,
      };
    }

    _edgeForAmbulance(ambState) {
      const veh = this.vehicles.get(ambState.ambulanceId);
      return veh ? veh.edge.id : '';
    }

    /**
     * Rebase an ambulance's remaining route onto an accepted Tier-1 reroute.
     *
     * The reroute was planned from the node the ambulance is travelling towards,
     * so its path begins at the downstream end of the current edge. The vehicle
     * is mid-edge and cannot be teleported, so the current edge is kept as the
     * head of the new route to be finished first.
     */
    _adoptReroute(ambId, newRoute) {
      const amb = this.ambulances.get(ambId);
      const veh = this.vehicles.get(ambId);
      if (!amb || !veh || !newRoute || !newRoute.path || newRoute.path.length === 0) return false;

      const currentEdgeId = veh.edge.id;
      const adopted = newRoute.path[0] === currentEdgeId
        ? newRoute.path.slice()
        : [currentEdgeId, ...newRoute.path];

      // Collapse consecutive duplicates (the current edge may reappear at the
      // head of the planner's path once the vehicle crosses the junction).
      const deduped = [];
      for (const eid of adopted) {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== eid) deduped.push(eid);
      }

      amb.routeEdgeIds = deduped;
      amb.currentEdgeIndex = 0;
      return true;
    }

    _distanceToSignal(veh, sig) {
      const p = this._vehicleWorldPos(veh);
      const dx = sig.worldPos.x - p.x;
      const dz = sig.worldPos.z - p.z;
      return Math.hypot(dx, dz);
    }

    _hasPassedJunction(veh, sig) {
      // Ambulance is on an edge whose from-node is the signal's junction, i.e.
      // it has already crossed the conflict zone.
      const nodeId = sig.properties && sig.properties.node_id;
      return nodeId ? veh.edge.fromNodeId === nodeId : false;
    }

    _measureAddedWaitTime() {
      // Ordinary vehicles queueing at a signal that is in preemption lose the
      // green they would otherwise have had. Accumulate the per-tick delta so
      // the total is a real emergent metric, not a hardcoded estimate.
      for (const [edgeId, data] of this.edgeCongestion) {
        if (data.queuedCount > 0) {
          const sig = this.signalManager.getSignalByNode(
            this.network.getEdge(edgeId).toNodeId);
          if (sig && sig.isPreempted) {
            this.totalAddedWaitTime += data.queuedCount * DT;
          }
        }
      }
    }

    /** Measure live congestion per edge and push to routing callback. */
    _measureCongestion(dt) {
      this.lastCongestionUpdate += dt;
      if (this.lastCongestionUpdate < this.congestionUpdateInterval) return;
      this.lastCongestionUpdate = 0;

      const congestionMap = {};

      for (const edge of this.network.getEdgeList()) {
        let totalVehicles = 0;
        let totalSpeed = 0;
        let queuedCount = 0;
        let totalQueueDelay = 0;

        for (let lane = 0; lane < edge.lanes; lane += 1) {
          const queue = this.laneQueues.get(`${edge.id}|${lane}`);
          if (!queue) continue;
          for (const veh of queue.vehicles) {
            totalVehicles += 1;
            totalSpeed += veh.v;
            if (veh.s <= edge.stopLineOffsetM && veh.v < 0.5) {
              queuedCount += 1;
              totalQueueDelay += veh.timeInQueue;
            }
          }
        }

        const meanSpeedMps = totalVehicles > 0 ? totalSpeed / totalVehicles : edge.maxspeedKmh / 3.6;
        const freeFlowSpeed = edge.maxspeedKmh / 3.6;
        const density = totalVehicles / Math.max(1, edge.length / 100.0); // veh per 100m
        const queueDelaySec = queuedCount > 0 ? totalQueueDelay / queuedCount : 0;

        this.edgeCongestion.set(edge.id, {
          density,
          meanSpeedMps,
          queueDelaySec,
          vehicleCount: totalVehicles,
          queuedCount,
        });

        // An incident caps how fast the edge can be traversed regardless of how
        // many vehicles happen to be on it, so it is visible to the router even
        // when the edge is momentarily empty.
        const incidentFactor = edge.incidentSpeedFactor || 1.0;
        // A blocked edge is a wall: no vehicle can traverse it, so its travel
        // time is infinite and the router routes around it. Without this the
        // blockage is invisible to congestion measurement even though the
        // vehicles on it have been removed.
        if (edge._blocked) {
          congestionMap[edge.id] = {
            travelTimeSec: Infinity,
            density: 0,
            meanSpeedMps: 0,
            queueDelaySec: 0,
            vehicleCount: 0,
            queuedCount: 0,
          };
          continue;
        }
        const achievableSpeedMps = (edge.maxspeedKmh / 3.6) * incidentFactor;

        // Travel time = length / effective speed. The speed floor is the same
        // crawling speed the router itself assumes for a gridlocked edge
        // (MIN_TRAVERSAL_SPEED_KMH), so a fully stopped edge reports its length
        // at that crawl rather than inflating to hours. The queue delay is NOT
        // added on top: a stopped queue is exactly what drags meanSpeedMps down
        // to the crawl floor, so adding per-vehicle queue delay a second time
        // double-counts it (a 100-vehicle queue where each car has waited 190 s
        // reported the edge as 2700 s instead of ~820 s).
        const crawlSpeedMps = 5.0 / 3.6;
        const effectiveSpeedMps = totalVehicles > 0
          ? Math.max(crawlSpeedMps, Math.min(meanSpeedMps, achievableSpeedMps))
          : achievableSpeedMps;
        const travelTimeSec = edge.length / effectiveSpeedMps;
        congestionMap[edge.id] = {
          travelTimeSec,
          density,
          meanSpeedMps,
          queueDelaySec,
          vehicleCount: totalVehicles,
        };
      }

      if (this.onCongestionUpdate) {
        this.onCongestionUpdate(congestionMap);
      }
    }

    /** Ambulance hospital bay state machine. */
    _updateAmbulanceBays(dt) {
      for (const [ambId, amb] of this.ambulances) {
        const veh = this.vehicles.get(ambId);
        if (!veh) continue;

        const hosp = this.bayManager.bays.get(amb.destinationHospital);
        if (!hosp) continue;

        switch (veh.ambulanceState) {
          case null:
          case AMBULANCE_STATE.EN_ROUTE: {
            // Request a bay once the ambulance is on the final approach to the
            // hospital's ingress node. Holding the request until then keeps the
            // reservation short and lets a second ambulance see a free bay.
            const onApproach = veh.edge.toNodeId === hosp.ingressNodeId;
            if (onApproach && veh.s >= veh.edge.length - 120.0) {
              const bayReq = this.bayManager.requestBay(amb.destinationHospital, ambId);
              if (bayReq) {
                veh.ambulanceState = AMBULANCE_STATE.APPROACHING_BAY;
                veh.targetBay = { hospitalId: bayReq.hospitalId, bayKey: bayReq.bayId };
                this._logDecision(ambId, 'APPROACHING_BAY', veh.edge.id, bayReq.bayId, 0, 'Bay assigned on final approach');
              } else {
                // Both bays occupied: wait at the driveway entrance. Re-tried
                // every tick until a bay frees.
                veh.targetV = 0;
              }
            }
            break;
          }

          case AMBULANCE_STATE.APPROACHING_BAY: {
            // The bay is a virtual waypoint off the graph (driveway geometry is
            // not in the routable network), so the bay is taken to sit at the
            // ingress node. Command a speed profile that reaches ~0 m/s exactly
            // there: v = sqrt(2 * b_comfort * distance_remaining).
            const remaining = Math.max(0.5, veh.edge.length - veh.s);
            veh.targetV = Math.min(veh.targetV, Math.sqrt(2 * veh.cls.comfortableDecel * remaining));
            if (veh.edge.toNodeId === hosp.ingressNodeId && remaining <= 2.0) {
              veh.ambulanceState = AMBULANCE_STATE.DOCKING;
              veh.bayArrivalTimeSec = this.time;
              this.bayManager.occupyBay(veh.targetBay.hospitalId, veh.targetBay.bayKey, ambId);
              veh.targetV = 0;
              this._logDecision(ambId, 'DOCKING', veh.edge.id, veh.targetBay.bayKey, 0, 'Entered bay');
            }
            break;
          }

          case AMBULANCE_STATE.DOCKING: {
            // Decelerate to a full stop at the bay, then start the dwell timer.
            veh.targetV = 0;
            if (veh.v <= 0.1) {
              veh.v = 0;
              veh.ambulanceState = AMBULANCE_STATE.DWELLING;
              veh.dwellTimer = DWELL_TIME_SEC;
              this.bayManager.startDwell(veh.targetBay.hospitalId, veh.targetBay.bayKey, ambId);
              this._logDecision(ambId, 'DWELLING', '', veh.targetBay.bayKey, DWELL_TIME_SEC, 'Patient transfer started');
            }
            break;
          }

          case AMBULANCE_STATE.DWELLING: {
            veh.v = 0;
            veh.dwellTimer -= dt;
            if (veh.dwellTimer <= 0) {
              veh.ambulanceState = AMBULANCE_STATE.DEPARTING;
              veh.departTimer = DEPART_TIME_SEC;
              veh.targetV = 5.0; // depart at 5 m/s
              this._logDecision(ambId, 'DEPARTING', '', veh.targetBay.bayKey, 0, 'Discharge complete');
            }
            break;
          }

          case AMBULANCE_STATE.DEPARTING: {
            // Pull out of the bay, then hand the bay back. The departure is a
            // real phase rather than an instant hop, so the bay is not marked
            // free while the ambulance is still occupying it.
            veh.targetV = 5.0;
            veh.departTimer -= dt;
            if (veh.departTimer > 0) break;
            this.bayManager.releaseBay(veh.targetBay.hospitalId, veh.targetBay.bayKey, ambId);
            veh.ambulanceState = AMBULANCE_STATE.BAY_RELEASED;
            this._logDecision(ambId, 'BAY_RELEASED', '', veh.targetBay.bayKey, 0, 'Bay free for next ambulance');
            // Terminal state. The ambulance stays parked at the hospital rather
            // than vanishing mid-scene, but it leaves its lane so it can neither
            // block traffic nor be re-driven. Its trip outcome is also recorded
            // so the result survives independently of the vehicle record.
            const oldQueue = this.laneQueues.get(`${veh.edge.id}|${veh.laneIndex}`);
            if (oldQueue) oldQueue.remove(veh);
            veh.tripComplete = true;
            veh.v = 0;
            this.completedTrips.set(ambId, {
              ambulanceId: ambId,
              hospitalId: veh.targetBay.hospitalId,
              bayKey: veh.targetBay.bayKey,
              state: AMBULANCE_STATE.BAY_RELEASED,
              arrivedAtSec: veh.bayArrivalTimeSec,
              completedAtSec: this.time,
              travelTimeSec: this.time - veh.tripStartTimeSec,
            });
            this.ambulances.delete(ambId);
            break;
          }
        }
      }
    }

    _logDecision(ambulanceId, tier, fromEdge, toEdge, predictedSavingSec, reason) {
      this.decisionLog.push({
        timestamp: this.time,
        ambulanceId,
        tier,
        fromEdge,
        toEdge,
        predictedSavingSec,
        reason,
      });
    }

    _getSnapshot() {
      return {
        time: this.time,
        tick: this.tick,
        vehicleCount: this.vehicles.size,
        collisionViolations: this.collisionViolations,
        signalInterventions: this.signalInterventions,
        addedWaitTime: this.totalAddedWaitTime,
      };
    }

    /** State checksum for determinism verification. */
    checksum() {
      let h = 0;
      for (const veh of this.vehicles.values()) {
        h = (h * 31 + Math.round(veh.s * 1000)) >>> 0;
        h = (h * 31 + Math.round(veh.v * 1000)) >>> 0;
      }
      if (this.signalManager && this.signalManager.getAllSignals) {
        for (const sig of this.signalManager.getAllSignals()) {
          h = (h * 31 + (sig.currentPhase || '').length) >>> 0;
          h = (h * 31 + (sig.isPreempted ? 1 : 0)) >>> 0;
        }
      }
      return h >>> 0;
    }

    /** Register ambulance for tracking and priority. */
    registerAmbulance(id, routeEdgeIds, destinationHospital) {
      this.ambulances.set(id, { id, routeEdgeIds, currentEdgeIndex: 0, status: 'EN_ROUTE', destinationHospital });
      const veh = this.vehicles.get(id);
      if (veh) {
        veh.ambulanceState = AMBULANCE_STATE.EN_ROUTE;
      }
    }

    /**
     * Place an ambulance onto the network at the start of a route edge.
     * The ambulance drives its route edge list, handing off at junctions, and
     * is exempt from ordinary stop-line enforcement while en route.
     */
    addAmbulance(id, routeEdgeIds, destinationHospital, startEdgeId = null) {
      const edgeIds = routeEdgeIds && routeEdgeIds.length
        ? routeEdgeIds
        : (startEdgeId ? [startEdgeId] : []);
      if (edgeIds.length === 0) return null;

      const firstEdge = this.network.getEdge(edgeIds[0]);
      if (!firstEdge) return null;

      // Resolve the destination to a bay-manager key. Callers may pass either
      // the hospital id ('hosp_victoria_01') or its short slug
      // ('victoria_hospital'); the slug is matched against the id and name.
      const hospitalId = this._resolveHospitalId(destinationHospital, edgeIds[edgeIds.length - 1]);
      if (!hospitalId) return null;

      // Place the ambulance on a lane with clearance, since ordinary traffic may
      // already occupy the first lane at the entry point.
      let lane = 0;
      for (let i = 0; i < firstEdge.lanes; i += 1) {
        const q = this.laneQueues.get(`${firstEdge.id}|${i}`);
        const last = q && q.vehicles[q.vehicles.length - 1];
        if (!last || last.s >= last.cls.length + MIN_GAP + 1.0) {
          lane = i;
          break;
        }
      }

      const veh = new SimVehicle(id, VEHICLE_CLASSES.AMBULANCE, firstEdge, lane, 0.0, this.random);
      veh.ambulanceState = AMBULANCE_STATE.EN_ROUTE;
      veh.targetBay = null;
      veh.tripStartTimeSec = this.time;
      this.vehicles.set(id, veh);
      const q = this.laneQueues.get(`${firstEdge.id}|${lane}`);
      if (q) q.enqueue(veh);

      this.ambulances.set(id, {
        id,
        routeEdgeIds: edgeIds,
        currentEdgeIndex: 0,
        status: 'EN_ROUTE',
        destinationHospital: hospitalId,
      });
      return veh;
    }

    /**
     * Map a caller-supplied hospital reference to a bay-manager key, falling
     * back to the hospital whose ingress node terminates the route.
     */
    _resolveHospitalId(reference, finalEdgeId) {
      if (reference && this.bayManager.bays.has(reference)) return reference;

      if (reference) {
        const slug = String(reference).toLowerCase();
        for (const [hospitalId, hosp] of this.bayManager.bays) {
          const network = this.network.hospitals.get(hospitalId);
          const name = network ? String(network.name || '').toLowerCase() : '';
          if (hospitalId.toLowerCase().includes(slug) || slug.includes(hospitalId.toLowerCase().replace('hosp_', '').replace(/_\d+$/, ''))) {
            return hospitalId;
          }
          if (name && name.includes(slug.replace(/_/g, ' '))) return hospitalId;
        }
      }

      if (finalEdgeId) {
        const edge = this.network.getEdge(finalEdgeId);
        if (edge) {
          for (const [hospitalId, hosp] of this.bayManager.bays) {
            if (hosp.ingressNodeId === edge.toNodeId) return hospitalId;
          }
        }
      }
      return null;
    }

    /**
     * Inject a blockage onto an edge: all vehicles on it are removed and the
     * edge is marked impassable until the blockage clears. Used by the
     * verification suite to force a Tier-1 reroute.
     */
    setEdgeBlockage(edgeId, blocked = true) {
      const edge = this.network.getEdge(edgeId);
      if (!edge) return false;
      edge._blocked = !!blocked;
      // Mirror the blockage onto the routing graph. The router keeps its own
      // edge objects, so without this the blockage is invisible to A* and it
      // will happily route straight through the closed edge.
      if (this.routingController && this.routingController.graph) {
        this.routingController.graph.setEdgeBlocked(edgeId, !!blocked);
      }
      if (blocked) {
        // Remove all ordinary vehicles on the blocked edge.
        for (const [vid, veh] of this.vehicles) {
          if (veh.edge.id === edgeId && !veh.cls.isEmergency) {
            this._despawnVehicle(vid);
          }
        }
      }
      return true;
    }

    isEdgeBlocked(edgeId) {
      const edge = this.network.getEdge(edgeId);
      return !!(edge && edge._blocked);
    }

    /**
     * Inject a traffic incident on an edge: a speed multiplier that applies to
     * every vehicle using it. This is physically real in the simulation — the
     * vehicles actually slow, and the congestion the router then sees is
     * measured from that behaviour rather than asserted.
     *
     * @param {string} edgeId
     * @param {number} speedFactor - multiplier on the posted limit, (0, 1]
     */
    setEdgeIncident(edgeId, speedFactor) {
      const edge = this.network.getEdge(edgeId);
      if (!edge) return false;
      const f = Number.isFinite(speedFactor) ? Math.max(0.02, Math.min(1.0, speedFactor)) : 1.0;
      edge.incidentSpeedFactor = f;
      return true;
    }

    getAmbulance(id) { return this.ambulances.get(id); }
    getAllVehicles() { return Array.from(this.vehicles.values()); }
    getLaneQueue(edgeId, laneIndex) { return this.laneQueues.get(`${edgeId}|${laneIndex}`); }
    getDecisionLog() { return this.decisionLog; }
    getCongestionMap() {
      const out = {};
      for (const [edgeId, data] of this.edgeCongestion) {
        out[edgeId] = data;
      }
      return out;
    }
  }

  // =============================================================================
  // EXPORTS
  // =============================================================================
  return {
    SimulationEngine,
    SimVehicle,
    LaneQueue,
    SeededRandom,
    VEHICLE_CLASSES,
    DEMAND_PROFILES,
    DT,
    MIN_GAP,
    BAY_STATE,
    AMBULANCE_STATE,
    DWELL_TIME_SEC,
    HospitalBayManager,
    SINK_NODES,
  };
}));