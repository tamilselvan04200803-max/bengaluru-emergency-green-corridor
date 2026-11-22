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
    PRIORITY_GREEN: 'PRIORITY_GREEN'
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

      this.currentState = SIGNAL_STATES.RED;
      this.isPreempted = false;
      this.preemptionTimer = 0.0;
      this.postPassageAmberTimer = 0.0;
      this.isPostPassage = false;

      // Desynchronize initial regular cycle times among signals
      this.cycleTimer = Math.random() * this.cycleTime;

      // Create Three.js Group
      if (typeof THREE !== 'undefined') {
        this.group = new THREE.Group();
        this.group.name = `Signal_${this.id}`;
        this.group.position.set(this.worldPos.x, this.worldPos.y, this.worldPos.z);
        this.buildMesh(options);
        this.setPhase(SIGNAL_STATES.RED);
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

      // 1. Galvanized dark steel material for structural mast
      const poleMat = new THREE.MeshStandardMaterial({
        color: 0x2b2e35,
        roughness: 0.60,
        metalness: 0.80,
        name: 'signalPole'
      });

      // 2. Matte black enclosure material for signal head
      const housingMat = new THREE.MeshStandardMaterial({
        color: 0x14161a,
        roughness: 0.85,
        metalness: 0.25,
        name: 'signalHousing'
      });

      // 3. Vertical Mast Pole
      const poleGeo = new THREE.CylinderGeometry(cfg.poleRadius * 0.75, cfg.poleRadius, cfg.poleHeight, 16);
      poleGeo.translate(0, cfg.poleHeight / 2, 0);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.castShadow = true;
      pole.receiveShadow = true;
      this.group.add(pole);

      // Base Flange Plate
      const flangeGeo = new THREE.CylinderGeometry(cfg.poleRadius * 2.2, cfg.poleRadius * 2.5, 0.25, 12);
      flangeGeo.translate(0, 0.125, 0);
      const flange = new THREE.Mesh(flangeGeo, poleMat);
      this.group.add(flange);

      // 4. Horizontal Cantilever Arm Overhanging Road Lanes
      const armGeo = new THREE.CylinderGeometry(cfg.poleRadius * 0.55, cfg.poleRadius * 0.7, cfg.mastArmLength, 12);
      armGeo.rotateZ(-Math.PI / 2);
      armGeo.translate(cfg.mastArmLength / 2, cfg.poleHeight - 0.35, 0);
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.castShadow = true;
      this.group.add(arm);

      // Cantilever diagonal support strut
      const strutLen = 1.8;
      const strutGeo = new THREE.CylinderGeometry(cfg.poleRadius * 0.4, cfg.poleRadius * 0.4, strutLen, 8);
      strutGeo.rotateZ(-Math.PI / 4);
      strutGeo.translate(strutLen * 0.35, cfg.poleHeight - 0.9, 0);
      const strut = new THREE.Mesh(strutGeo, poleMat);
      this.group.add(strut);

      // 5. Overhead Signal Housing Box Group
      const headGroup = new THREE.Group();
      headGroup.position.set(cfg.mastArmLength - 0.4, cfg.poleHeight - 0.35, 0);

      const boxGeo = new THREE.BoxGeometry(cfg.housingWidth, cfg.housingHeight, cfg.housingDepth);
      const housing = new THREE.Mesh(boxGeo, housingMat);
      housing.castShadow = true;
      headGroup.add(housing);

      // Backing target board (border shield for high contrast)
      const boardGeo = new THREE.BoxGeometry(cfg.housingWidth + 0.35, cfg.housingHeight + 0.35, 0.04);
      boardGeo.translate(0, 0, -cfg.housingDepth / 2 - 0.02);
      const board = new THREE.Mesh(boardGeo, new THREE.MeshBasicMaterial({ color: 0x05070a }));
      headGroup.add(board);

      // 6. Lenses (Red, Amber, Green) with Sun Visors
      this.lenses = {};
      const lensGeo = new THREE.CylinderGeometry(cfg.lensRadius, cfg.lensRadius, 0.08, 20);
      lensGeo.rotateX(Math.PI / 2);

      const visorGeo = new THREE.CylinderGeometry(
        cfg.lensRadius * 1.1,
        cfg.lensRadius * 1.1,
        0.24,
        16,
        1,
        true,
        0,
        Math.PI
      );
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

        // Sun visor hood
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

      // 7. Dynamic PointLight for ground illumination
      this.pointLight = new THREE.PointLight(cfg.colors.RED.light, 0.0, 16.0, 2.0);
      this.pointLight.position.set(cfg.mastArmLength - 0.4, cfg.poleHeight - 0.35, cfg.housingDepth / 2 + 0.6);
      this.group.add(this.pointLight);

      this.group.add(headGroup);
    }

    /**
     * Switch illuminated aspect
     * @param {string} state - RED, AMBER, GREEN, or PRIORITY_GREEN
     */
    setPhase(state) {
      this.currentState = state;
      const isPriority = (state === SIGNAL_STATES.PRIORITY_GREEN);
      const effectiveState = isPriority ? SIGNAL_STATES.GREEN : state;

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
     * Update signal logic each frame
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
      if (this.isPostPassage) {
        this.postPassageAmberTimer -= dt;
        if (this.postPassageAmberTimer <= 0) {
          this.isPostPassage = false;
          this.setPhase(SIGNAL_STATES.RED);
        }
        return;
      }

      if (this.isPreempted) {
        // High-intensity pulsing green for Priority Green Wave
        const pulse = 4.2 + Math.sin(Date.now() * 0.012) * 1.2;
        if (this.lenses && this.lenses[SIGNAL_STATES.GREEN]) {
          this.lenses[SIGNAL_STATES.GREEN].material.emissiveIntensity = pulse;
        }
        return;
      }

      // Regular Autonomous Signal Cycling:
      // Green duration: 50% of cycle minus amber (5s)
      // Amber duration: 5.0s
      // Red duration: remaining 50%
      this.cycleTimer = (this.cycleTimer + dt) % this.cycleTime;
      const greenDuration = Math.max(10.0, (this.cycleTime - 5.0) * 0.5);
      const amberDuration = 5.0;

      if (this.cycleTimer < greenDuration) {
        if (this.currentState !== SIGNAL_STATES.GREEN) this.setPhase(SIGNAL_STATES.GREEN);
      } else if (this.cycleTimer < greenDuration + amberDuration) {
        if (this.currentState !== SIGNAL_STATES.AMBER) this.setPhase(SIGNAL_STATES.AMBER);
      } else {
        if (this.currentState !== SIGNAL_STATES.RED) this.setPhase(SIGNAL_STATES.RED);
      }
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
        if (this.signalGroup && signal.group) {
          this.signalGroup.add(signal.group);
        }
      });
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
            signal.isPreempted = true;
            signal.isPostPassage = false;
            signal.setPhase(SIGNAL_STATES.PRIORITY_GREEN);
            this.preemptedSignals.add(signal.id);
          }
        } else if (signal.isPreempted) {
          // Out of range or passed junction
          if (!isInRoute || dist > (horizonMeters + marginMeters)) {
            signal.isPreempted = false;
            signal.isPostPassage = true;
            signal.postPassageAmberTimer = 3.0; // 3 seconds amber safety phase
            signal.setPhase(SIGNAL_STATES.AMBER);
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
