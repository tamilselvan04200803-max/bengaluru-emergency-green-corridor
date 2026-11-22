/**
 * js/signals.js
 * 3D Traffic Signal Gantries, Emissive Lenses & ITMS Green Wave Preemption
 * Browser-global (window.SignalManager) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SignalManager = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIGNAL_STATES = {
    RED: 'RED',
    AMBER: 'AMBER',
    GREEN: 'GREEN',
    PRIORITY_GREEN: 'PRIORITY_GREEN',
    ALL_RED: 'ALL_RED' // inter-green clearance, not shown to drivers
  };

  // Minimum safe transition timings (seconds)
  const MIN_AMBER_SEC = 3.0;
  const MIN_ALL_RED_SEC = 2.0;
  // The fixed simulation tick. Transition timers are counted in whole ticks so
  // the amber/all-red minimums hold exactly rather than drifting a tick late.
  const dtUnit = 0.1;

  // Driver-facing aspect for each internal phase. ALL_RED_CLEARANCE is an
  // inter-green hold and reads as red; PREEMPT_GREEN reads as a priority green.
  const DRIVER_ASPECT = {
    RED: SIGNAL_STATES.RED,
    AMBER: SIGNAL_STATES.AMBER,
    GREEN: SIGNAL_STATES.GREEN,
    PREEMPT_GREEN: SIGNAL_STATES.PRIORITY_GREEN,
    ALL_RED_CLEARANCE: SIGNAL_STATES.RED,
  };

  const PHASE = {
    RED: 'RED',
    AMBER: 'AMBER',
    GREEN: 'GREEN',
    ALL_RED_CLEARANCE: 'ALL_RED_CLEARANCE',
    PREEMPT_GREEN: 'PREEMPT_GREEN'
  };

  class TrafficSignalPost {
    /**
     * @param {Object} feature - GeoJSON feature from bengaluru_traffic_signals.geojson
     * @param {GeoProjection} projection - Coordinate projection instance
     * @param {Object} [options]
     */
    constructor(feature, projection, options = {}) {
      this.id = feature.properties.id;
      this.name = feature.properties.name || feature.id;
      this.properties = feature.properties;
      this.projection = projection;

      const coords = feature.geometry.coordinates;
      const lon = coords[0];
      const lat = coords[1];
      const alt = coords[2] !== undefined ? coords[2] : 920.0;

      this.worldPos = projection.latLonAltToCartesian(lat, lon, alt);

      this.cycleTime = feature.properties.cycle_time_seconds || 90;
      this.leadTime = feature.properties.actuation_lead_time_sec || 30;
      this.priorityTier = feature.properties.priority_tier || 'MAJOR';
      this.clearanceAction = feature.properties.clearance_action || 'FORCE_GREEN';

      // Phase state machine with safe transitions
      this.currentPhase = PHASE.RED;
      this.isPreempted = false;
      this.isPostPassage = false;
      this.postPassageAmberTimer = 0.0;
      this.postPassageTicks = 0; // integer ticks, kept exact
      this.preemptionQueue = []; // requests deferred until an amber has cleared
      this.transitionTimer = 0.0;
      this.transitionTicks = 0;
      this.targetPhase = PHASE.RED;
      this.elapsed = 0.0;
      // Integer ticks; one tick is dtUnit seconds. Callers pass a real frame
      // delta, so update() sub-steps and any remainder shorter than one tick is
      // carried in pendingDt rather than dropped.
      this.pendingDt = 0.0;

      // Authoritative record of how long each phase actually lasted. Sampling a
      // signal from outside only sees tick boundaries and under-reports a
      // duration by up to one tick; the signal itself knows exactly.
      this.phaseEnteredAt = 0.0;
      this.phaseEnteredTick = 0;
      this.totalTicks = 0;
      this.lastPhaseDuration = 0.0;
      this.minAmberObserved = Infinity;
      this.minAllRedObserved = Infinity;

      // Deterministic desynchronisation: hash the signal id so the corridor does
      // not flash every junction in lockstep, without introducing Math.random().
      let hash = 0;
      for (let i = 0; i < this.id.length; i += 1) {
        hash = (hash * 31 + this.id.charCodeAt(i)) >>> 0;
      }
      this.cycleTimer = (hash % 1000) / 1000 * this.cycleTime;

      // Create Three.js Group
      if (typeof THREE !== 'undefined') {
        this.group = new THREE.Group();
        this.group.name = `Signal_${this.id}`;
        this.group.position.set(this.worldPos.x, this.worldPos.y, this.worldPos.z);
        this.buildMesh(options);
        this.setPhase(PHASE.RED);
      } else {
        this.group = null;
        this.lenses = {};
      }
    }

    /**
     * Constructs the 3D cantilever gantry mesh with housing, lenses, visors, and pointlight.
     */
    buildMesh(options = {}) {
      const cfg = (typeof CONFIG !== 'undefined' && CONFIG.SIGNALS) ? CONFIG.SIGNALS : {
        poleHeight: 6.2,
        poleRadius: 0.14,
        mastArmLength: 4.5,
        housingWidth: 0.55,
        housingHeight: 1.5,
        housingDepth: 0.35,
        lensRadius: 0.17,
        lensSpacing: 0.42,
        emissiveIntensityActive: 3.8,
        emissiveIntensityPriority: 4.8,
        emissiveIntensityDim: 0.12,
        colors: {
          RED: { active: 0xff1e1e, dim: 0x330000, light: 0xff2222 },
          AMBER: { active: 0xffaa00, dim: 0x331c00, light: 0xff8800 },
          GREEN: { active: 0x00ff66, dim: 0x003311, light: 0x00ff55 }
        }
      };

      const poleMat = new THREE.MeshStandardMaterial({
        color: 0x2b2e35, roughness: 0.60, metalness: 0.80, name: 'signalPole'
      });
      const housingMat = new THREE.MeshStandardMaterial({
        color: 0x14161a, roughness: 0.85, metalness: 0.25, name: 'signalHousing'
      });

      const poleGeo = new THREE.CylinderGeometry(cfg.poleRadius * 0.75, cfg.poleRadius, cfg.poleHeight, 16);
      poleGeo.translate(0, cfg.poleHeight / 2, 0);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.castShadow = true;
      pole.receiveShadow = true;
      this.group.add(pole);

      const flangeGeo = new THREE.CylinderGeometry(cfg.poleRadius * 2.2, cfg.poleRadius * 2.5, 0.25, 12);
      flangeGeo.translate(0, 0.125, 0);
      this.group.add(new THREE.Mesh(flangeGeo, poleMat));

      const armGeo = new THREE.CylinderGeometry(cfg.poleRadius * 0.55, cfg.poleRadius * 0.7, cfg.mastArmLength, 12);
      armGeo.rotateZ(-Math.PI / 2);
      armGeo.translate(cfg.mastArmLength / 2, cfg.poleHeight - 0.35, 0);
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.castShadow = true;
      this.group.add(arm);

      const strutLen = 1.8;
      const strutGeo = new THREE.CylinderGeometry(cfg.poleRadius * 0.4, cfg.poleRadius * 0.4, strutLen, 8);
      strutGeo.rotateZ(-Math.PI / 4);
      strutGeo.translate(strutLen * 0.35, cfg.poleHeight - 0.9, 0);
      this.group.add(new THREE.Mesh(strutGeo, poleMat));

      const headGroup = new THREE.Group();
      headGroup.position.set(cfg.mastArmLength - 0.4, cfg.poleHeight - 0.35, 0);

      const boxGeo = new THREE.BoxGeometry(cfg.housingWidth, cfg.housingHeight, cfg.housingDepth);
      const housing = new THREE.Mesh(boxGeo, housingMat);
      housing.castShadow = true;
      headGroup.add(housing);

      const boardGeo = new THREE.BoxGeometry(cfg.housingWidth + 0.35, cfg.housingHeight + 0.35, 0.04);
      boardGeo.translate(0, 0, -cfg.housingDepth / 2 - 0.02);
      headGroup.add(new THREE.Mesh(boardGeo, new THREE.MeshBasicMaterial({ color: 0x05070a })));

      this.lenses = {};
      const lensGeo = new THREE.CylinderGeometry(cfg.lensRadius, cfg.lensRadius, 0.08, 20);
      lensGeo.rotateX(Math.PI / 2);

      const visorGeo = new THREE.CylinderGeometry(cfg.lensRadius * 1.1, cfg.lensRadius * 1.1, 0.24, 16, 1, true, 0, Math.PI);
      visorGeo.rotateZ(Math.PI / 2);

      const lensDefs = [
        { key: SIGNAL_STATES.RED, y: cfg.lensSpacing, colors: cfg.colors.RED },
        { key: SIGNAL_STATES.AMBER, y: 0.0, colors: cfg.colors.AMBER },
        { key: SIGNAL_STATES.GREEN, y: -cfg.lensSpacing, colors: cfg.colors.GREEN }
      ];

      lensDefs.forEach(def => {
        const mat = new THREE.MeshStandardMaterial({
          color: def.colors.dim,
          emissive: def.colors.dim,
          emissiveIntensity: cfg.emissiveIntensityDim,
          roughness: 0.25,
          metalness: 0.1
        });
        const mesh = new THREE.Mesh(lensGeo, mat);
        mesh.position.set(0, def.y, cfg.housingDepth / 2 + 0.04);
        headGroup.add(mesh);

        const visor = new THREE.Mesh(visorGeo, housingMat);
        visor.position.set(0, def.y + 0.04, cfg.housingDepth / 2 + 0.12);
        headGroup.add(visor);

        this.lenses[def.key] = {
          mesh: mesh,
          material: mat,
          activeColor: def.colors.active,
          dimColor: def.colors.dim,
          lightColor: def.colors.light
        };
      });

      this.pointLight = new THREE.PointLight(cfg.colors.RED.light, 0.0, 16.0, 2.0);
      this.pointLight.position.set(cfg.mastArmLength - 0.4, cfg.poleHeight - 0.35, cfg.housingDepth / 2 + 0.6);
      this.group.add(this.pointLight);
      this.group.add(headGroup);
    }

    /**
     * What drivers actually see. ALL_RED_CLEARANCE is an internal inter-green
     * state and reads as red; PREEMPT_GREEN reads as a priority green.
     */
    get currentState() {
      return DRIVER_ASPECT[this.currentPhase] || SIGNAL_STATES.RED;
    }

    /** Begin a timed transition, showing `intermediate` until it expires. */
    _beginTransition(intermediate, to, seconds) {
      this.currentPhase = intermediate;
      this.targetPhase = to;
      this.transitionTimer = seconds;
      // dt is fixed at 0.1 s, so counting ticks keeps the minimum dwell exact.
      // Decrementing a float by 0.1 each tick accumulates error and the
      // transition lands a tick late, which breaks the >= 3.0 s amber invariant.
      this.transitionTicks = Math.round(seconds / dtUnit);
      this.setPhase(intermediate);
    }

    /**
     * The intermediate state a move to `to` must pass through first, or null
     * when the change is already safe to apply directly.
     */
    _intermediateFor(to) {
      const from = this.currentPhase;
      const toGreen = to === PHASE.GREEN || to === PHASE.PREEMPT_GREEN;
      // "Currently green" means GREEN or PREEMPT_GREEN only. ALL_RED_CLEARANCE
      // and AMBER are both inter-greens that must not be jumped over: a
      // preemption request arriving mid-all-red used to see fromGreen=false and
      // toGreen=true, so _intermediateFor returned ALL_RED_CLEARANCE, which is
      // already the current phase — and requestPhase then called setPhase
      // directly, snapping PREEMPT_GREEN on top of the clearance interval and
      // showing a conflicting green before the all-red had run its course.
      const fromGreen = from === PHASE.GREEN || from === PHASE.PREEMPT_GREEN;
      if (fromGreen && !toGreen) return PHASE.AMBER;           // 3s amber
      if (!fromGreen && toGreen) return PHASE.ALL_RED_CLEARANCE; // 2s all-red
      return null;
    }

    /**
     * Request a phase, sequenced through the minimum safe intermediates:
     * green -> amber(3s) -> all-red(2s) -> green. Never instant-snaps to green
     * and never shows conflicting greens.
     *
     * @returns {boolean} true when the signal is, or has just entered, `to`.
     */
    requestPhase(to) {
      if (this.currentPhase === to) return true;
      if (this.transitionTicks > 0) {
        // A transition is in flight; retarget without restarting its timer.
        this.targetPhase = to;
        return false;
      }
      const intermediate = this._intermediateFor(to);
      if (intermediate) {
        // The intermediate is the state we must show before `to`. If we are
        // already in it, re-entering it would restart its timer and could
        // shorten the inter-green below the minimum; instead just retarget so
        // the in-flight timer lands on `to` when it expires.
        if (this.currentPhase === intermediate) {
          this.targetPhase = to;
          return false;
        }
        this._beginTransition(intermediate, to, intermediate === PHASE.AMBER ? MIN_AMBER_SEC : MIN_ALL_RED_SEC);
        return false;
      }
      this.setPhase(to);
      this.targetPhase = to;
      return true;
    }

    /**
     * Switch illuminated aspect for rendering.
     * @param {string} state - RED, AMBER, GREEN, PREEMPT_GREEN, ALL_RED_CLEARANCE
     */
    setPhase(state) {
      const leaving = this.currentPhase;
      if (leaving !== state && this.elapsed > this.phaseEnteredAt) {
        const heldFor = (this.totalTicks - this.phaseEnteredTick) * dtUnit;
        this.lastPhaseDuration = heldFor;
        if (leaving === PHASE.AMBER) this.minAmberObserved = Math.min(this.minAmberObserved, heldFor);
        if (leaving === PHASE.ALL_RED_CLEARANCE) this.minAllRedObserved = Math.min(this.minAllRedObserved, heldFor);
      }
      this.phaseEnteredAt = this.elapsed;
      this.phaseEnteredTick = this.totalTicks;
      this.currentPhase = state;
      const isPriority = state === PHASE.PREEMPT_GREEN;
      const effectiveState = isPriority ? PHASE.GREEN : state;

      if (!this.lenses) return;

      for (const [key, lens] of Object.entries(this.lenses)) {
        if (!lens || !lens.material) continue;

        if (key === effectiveState) {
          lens.material.color.setHex(lens.activeColor);
          lens.material.emissive.setHex(lens.activeColor);
          lens.material.emissiveIntensity = isPriority ? 4.8 : 3.8;
          if (this.pointLight) {
            this.pointLight.color.setHex(lens.lightColor);
            this.pointLight.intensity = isPriority ? 2.0 : 1.3;
          }
        } else {
          lens.material.color.setHex(lens.dimColor);
          lens.material.emissive.setHex(lens.dimColor);
          lens.material.emissiveIntensity = 0.12;
        }
      }
    }

    /**
     * Advance the phase machine by dt seconds.
     *
     * dt is a real frame delta (app.js passes min(clock delta, 0.1); the Node
     * suites pass larger values to fast-forward). The machine itself runs on a
     * fixed tick so the amber and all-red minimums are exact, so a dt longer
     * than one tick is executed as several ticks and a shorter remainder is
     * carried over rather than discarded.
     *
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
      this.pendingDt += dt;
      while (this.pendingDt >= dtUnit) {
        this.pendingDt -= dtUnit;
        this._tick();
      }
    }

    /**
     * One fixed tick of the phase machine.
     *
     * Order matters: a queued preemption is serviced before the autonomous cycle
     * so a request arriving mid-amber is not starved by the cycle's band logic.
     */
    _tick() {
      this.elapsed += dtUnit;
      this.totalTicks += 1;

      // 0. A retargeted transition. requestPhase() may set targetPhase without
      //    starting a timer when the requested move's intermediate is the phase
      //    we are already in (a preemption arriving mid-all-red). The target is
      //    then honoured by starting the transition now, so the inter-green
      //    still runs its full minimum before the conflicting green appears.
      if (this.transitionTicks === 0 && this.targetPhase !== this.currentPhase
          && this.currentPhase !== PHASE.PREEMPT_GREEN) {
        const intermediate = this._intermediateFor(this.targetPhase);
        if (intermediate && this.currentPhase === intermediate) {
          this._beginTransition(intermediate, this.targetPhase,
            intermediate === PHASE.AMBER ? MIN_AMBER_SEC : MIN_ALL_RED_SEC);
        }
      }

      // 1. Complete any in-flight transition, counted in whole ticks.
      if (this.transitionTicks > 0) {
        this.transitionTicks -= 1;
        this.transitionTimer = Math.max(0, this.transitionTicks * dtUnit);
        if (this.transitionTicks === 0) {
          const landed = this.targetPhase;
          this.setPhase(landed);
          // A green->red change still owes its all-red inter-green before the
          // conflicting movement is released.
          if (landed === PHASE.AMBER && !this.isPreempted) {
            this.targetPhase = PHASE.RED;
            this._beginTransition(PHASE.ALL_RED_CLEARANCE, PHASE.RED, MIN_ALL_RED_SEC);
          }
        }
        return;
      }

      // 2. Post-passage amber safety. This is an inter-green after an ambulance
      //    clears, so it is authoritative: a preemption request arriving during
      //    it stays queued rather than cutting the amber short. Servicing the
      //    queue first would let a fresh request shave the amber to a fraction
      //    of MIN_AMBER_SEC and break the safe-transition invariant.
      if (this.isPostPassage) {
        this.postPassageTicks -= 1;
        this.postPassageAmberTimer = Math.max(0, this.postPassageTicks * dtUnit);
        if (this.postPassageTicks <= 0) {
          this.isPostPassage = false;
          this.postPassageAmberTimer = 0;
          this.setPhase(PHASE.AMBER);
          this.targetPhase = PHASE.RED;
          this._beginTransition(PHASE.ALL_RED_CLEARANCE, PHASE.RED, MIN_ALL_RED_SEC);
        }
        return;
      }

      // 3. Service one queued preemption request. requestPhase() returns false while
      // a transition is in flight; the request stays queued and is retried next
      // tick. The flag is set only when the request has actually been accepted,
      // otherwise the signal is left "preempted" with an empty queue — a
      // deadlock where nothing is left to service it.
      if (this.preemptionQueue.length > 0) {
        if (this.requestPhase(PHASE.PREEMPT_GREEN)) {
          this.preemptionQueue.shift();
          this.isPreempted = true;
        }
      }

      // 4. Hold priority green while the ambulance is inside the junction.
      if (this.isPreempted) {
        if (this.currentPhase !== PHASE.PREEMPT_GREEN) this.requestPhase(PHASE.PREEMPT_GREEN);
        return;
      }

      // 5. Autonomous cycle. The cycle timer only decides green vs. not-green;
      //    the amber and all-red inter-greens are produced by the transition
      //    machinery above, so their minimum durations hold exactly. Driving
      //    the bands directly would let a signal that starts part-way through a
      //    band serve a fraction of the minimum before the band ran out.
      const greenDuration = Math.max(10.0, this.cycleTime - MIN_AMBER_SEC - MIN_ALL_RED_SEC);
      this.cycleTimer = (this.cycleTimer + dtUnit) % this.cycleTime;
      if (this.cycleTimer < greenDuration) {
        this.requestPhase(PHASE.GREEN);
      } else {
        this.requestPhase(PHASE.RED);
      }
    }

    /**
     * Called by SignalManager when the ambulance enters the preemption horizon.
     * The request is queued; update() walks it through the safe transition.
     */
    queuePreemption() {
      if (this.isPreempted || this.currentPhase === PHASE.PREEMPT_GREEN) return;
      this.preemptionQueue.push({ at: this.elapsed });
      this.isPreempted = true;
      // Start the safe transition now, not on the next tick. While the
      // request sits in the queue the signal keeps running its autonomous RED,
      // and a preempted signal parked in RED is exactly the conflicting-green
      // interim the safe-transition invariant forbids. requestPhase() starts
      // the ALL_RED_CLEARANCE inter-green (or retargets an in-flight
      // transition), so the signal leaves RED immediately.
      this.requestPhase(PHASE.PREEMPT_GREEN);
    }

    /**
     * Called by SignalManager when the ambulance has cleared the junction.
     * Starts the post-passage amber safety phase before returning to the
     * regular cycle.
     */
    endPreemption() {
      if (!this.isPreempted) return;
      this.isPreempted = false;
      this.preemptionQueue = [];
      this.isPostPassage = true;
      this.postPassageTicks = Math.round(MIN_AMBER_SEC / dtUnit);
      this.postPassageAmberTimer = this.postPassageTicks * dtUnit;
      this.transitionTimer = 0;
      this.transitionTicks = 0;
      this.targetPhase = PHASE.RED;
      this.setPhase(PHASE.AMBER);
    }
  }

  class SignalManager {
    /**
     * @param {THREE.Scene} scene
     * @param {GeoProjection} projection
     */
    constructor(scene, projection) {
      this.scene = scene;
      this.projection = projection;
      this.signals = new Map(); // id -> TrafficSignalPost
      this.signalsByNode = new Map(); // junction node id -> TrafficSignalPost
      this.preemptedSignals = new Set();

      if (scene && typeof THREE !== 'undefined') {
        this.signalGroup = new THREE.Group();
        this.signalGroup.name = 'TrafficSignalNetwork';
        this.scene.add(this.signalGroup);
      } else {
        this.signalGroup = null;
      }

      this.initFromData();
    }

    initFromData() {
      let geojson = null;
      if (typeof SIGNALS_DATA !== 'undefined') {
        geojson = SIGNALS_DATA;
      } else if (typeof global !== 'undefined' && global.SIGNALS_DATA) {
        geojson = global.SIGNALS_DATA;
      }

      if (!geojson || !geojson.features) {
        return;
      }

      geojson.features.forEach(feat => {
        const signal = new TrafficSignalPost(feat, this.projection);
        this.signals.set(signal.id, signal);
        // Signals declare the junction node they control, so the traffic
        // simulation can resolve an edge's downstream approach to its signal.
        const nodeId = signal.properties && signal.properties.node_id;
        if (nodeId) this.signalsByNode.set(nodeId, signal);
        if (this.signalGroup && signal.group) {
          this.signalGroup.add(signal.group);
        }
      });

      // The routing graph lets several junction nodes share one signal post
      // (e.g. node_trinity and node_anil_kumble_circle). Index those aliases.
      const network = (typeof NETWORK_DATA !== 'undefined') ? NETWORK_DATA
        : (typeof global !== 'undefined' && global.NETWORK_DATA ? global.NETWORK_DATA : null);
      if (network && network.nodes) {
        network.nodes.forEach(node => {
          if (!node.signals) return;
          node.signals.forEach(sigId => {
            const sig = this.signals.get(sigId);
            if (sig) this.signalsByNode.set(node.id, sig);
          });
        });
      }
    }

    /**
     * Signal controlling the given junction node, or null if unsignalised.
     * @param {string} nodeId
     */
    getSignalByNode(nodeId) {
      return this.signalsByNode.get(nodeId) || null;
    }

    /**
     * All signals that have at least one ordinary green (i.e. are cycling
     * autonomously rather than held by preemption).
     */
    getIdleSignals() {
      return this.getAllSignals().filter(s => !s.isPreempted && !s.isPostPassage);
    }

    /**
     * Update preemption based on ambulance telemetry or manual driving.
     * Computes traffic clearance horizon ahead of arrival: d = min(300m, v * 25s).
     *
     * @param {THREE.Vector3|{x: number, y: number, z: number}} ambulancePos
     * @param {number} speedKmh - Ambulance speed in km/h
     * @param {Array<string>} [activeRouteJunctions=[]] - Array of junction signal IDs
     */
    updatePreemption(ambulancePos, speedKmh = 40.0, activeRouteJunctions = []) {
      if (!ambulancePos) return;

      const speedMps = Math.max(5.0, (speedKmh * 1000.0) / 3600.0);
      const horizonMeters = Math.min(300.0, speedMps * 25.0);
      const marginMeters = 30.0;

      this.signals.forEach(signal => {
        if (!signal.worldPos) return;

        const dx = signal.worldPos.x - ambulancePos.x;
        const dz = signal.worldPos.z - ambulancePos.z;
        const dist = Math.hypot(dx, dz);

        const isInRoute = activeRouteJunctions.length === 0 || activeRouteJunctions.includes(signal.id);

        if (isInRoute && dist <= horizonMeters) {
          // Entering preemption horizon
          if (!signal.isPreempted) {
            signal.queuePreemption();
            this.preemptedSignals.add(signal.id);
          }
        } else if (signal.isPreempted) {
          // Out of range or passed junction
          if (!isInRoute || dist > (horizonMeters + marginMeters)) {
            signal.endPreemption();
            this.preemptedSignals.delete(signal.id);
          }
        }
      });
    }

    /**
     * Frame-by-frame update for all signal posts
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
      this.signals.forEach(sig => sig.update(dt));
    }

    getSignal(id) {
      return this.signals.get(id);
    }

    getAllSignals() {
      return Array.from(this.signals.values());
    }

    getPreemptedCount() {
      return this.preemptedSignals.size;
    }
  }

  // Export classes
  SignalManager.SIGNAL_STATES = SIGNAL_STATES;
  SignalManager.TrafficSignalPost = TrafficSignalPost;

  return SignalManager;
}));
