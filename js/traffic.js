/**
 * js/traffic.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Civilian Traffic Swarm & Pre-emptive Clearance AI
 * 
 * Features:
 * 1. 4 Heterogeneous Bengaluru Civilian Vehicle Classes:
 *    - AUTO_RICKSHAW: Iconic yellow/green 3-wheelers (nimble, compact).
 *    - BMTC_BUS: Large city transit buses (heavy footprint, slow acceleration).
 *    - TWO_WHEELER: Scooters and motorcycles (lane-filtering, rapid acceleration).
 *    - PASSENGER_CAR: Sedans, hatchbacks, and app cabs.
 * 2. High-Performance Batch Rendering:
 *    - THREE.InstancedMesh for 80-150+ vehicles in <5 draw calls (1 per archetype) maintaining locked 60 FPS.
 * 3. Parting Wave Yielding AI:
 *    - Forward clearance cone integration (80.0m range, 0.7 rad FOV).
 *    - Dynamic outward steering toward road shoulder (+/- 1.8m lateral offset lerp).
 *    - Road curb boundary clamping (does not overshoot curb on 2-lane roads).
 *    - Acoustic gating: strictly no yield if siren is OFF.
 *    - Post-passage restoration: smoothly lerps back to 0.0m lane center once ambulance is >25m past.
 * 4. Early Junction Preemption & Queue Flushing:
 *    - Intersection queue detection and advance flushing upon green wave preemption.
 * 5. Full Browser & Headless Node.js Compatibility (Isomorphic UMD).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.TrafficSwarmManager = exportsObj.TrafficSwarmManager;
    root.TrafficManager = exportsObj.TrafficManager;
    root.CivilianVehicle = exportsObj.CivilianVehicle;
    root.VEHICLE_CLASSES = exportsObj.VEHICLE_CLASSES;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================================
  // 1. VEHICLE CLASS ARCHETYPES & SPECIFICATIONS (Test T1.3.1 Contract)
  // ============================================================================
  const VEHICLE_CLASSES = {
    AUTO_RICKSHAW: {
      id: 'AUTO_RICKSHAW',
      name: 'Auto-Rickshaw',
      wheels: 3,
      lengthM: 2.8,
      widthM: 1.4,
      heightM: 1.8,
      baseSpeedKmh: 36.0,
      maxSpeedKmh: 45.0,
      accelMps2: 3.2,
      decelMps2: 5.0,
      safeGapM: 2.8,
      defaultColor: 0xffcc00, // Iconic Yellow Top
      secondaryColor: 0x006633, // Dark Green Lower Body
      palette: [0xffcc00, 0xfacc15, 0xeab308]
    },
    BMTC_BUS: {
      id: 'BMTC_BUS',
      name: 'BMTC Transit Bus',
      wheels: 6,
      lengthM: 11.0,
      widthM: 2.6,
      heightM: 3.2,
      baseSpeedKmh: 32.0,
      maxSpeedKmh: 48.0,
      accelMps2: 1.4,
      decelMps2: 3.0,
      safeGapM: 7.0,
      defaultColor: 0x0044aa, // BMTC Classic Royal Blue
      secondaryColor: 0xffffff, // White Horizontal Stripe
      palette: [0x0044aa, 0x0284c7, 0x0369a1]
    },
    TWO_WHEELER: {
      id: 'TWO_WHEELER',
      name: 'Two-Wheeler (Motorcycle / Scooter)',
      wheels: 2,
      lengthM: 1.9,
      widthM: 0.8,
      heightM: 1.2,
      baseSpeedKmh: 42.0,
      maxSpeedKmh: 55.0,
      accelMps2: 4.5,
      decelMps2: 6.0,
      safeGapM: 2.0,
      defaultColor: 0xcc2222,
      secondaryColor: 0x111111,
      palette: [0xcc2222, 0x1f2937, 0x0284c7, 0x4b5563, 0x15803d]
    },
    PASSENGER_CAR: {
      id: 'PASSENGER_CAR',
      name: 'Passenger Car',
      wheels: 4,
      lengthM: 4.2,
      widthM: 1.8,
      heightM: 1.5,
      baseSpeedKmh: 40.0,
      maxSpeedKmh: 60.0,
      accelMps2: 2.6,
      decelMps2: 4.5,
      safeGapM: 4.5,
      defaultColor: 0xf3f4f6,
      secondaryColor: 0x1f2937,
      palette: [0xf3f4f6, 0x9ca3af, 0xf59e0b, 0x374151, 0x1e3a8a]
    }
  };

  const CONSTANTS = {
    DEFAULT_MAX_VEHICLES: 200,
    DEFAULT_SPAWN_COUNT: 120,
    CLEARANCE_RANGE_M: 80.0,
    CLEARANCE_FOV_RAD: 0.70, // ~40 degrees
    PARTING_WAVE_SHIFT_M: 1.8, // Lateral yield to shoulder
    RESTORE_THRESHOLD_M: 25.0, // Distance past ambulance before returning to lane
    ROAD_LANE_WIDTH_M: 3.5,
    CURB_SAFETY_MARGIN_M: 0.40,
    QUEUE_STOP_MARGIN_M: 6.0
  };

  // ============================================================================
  // 2. GEOSPATIAL COORDINATE PROJECTION HELPER
  // ============================================================================
  function projectCoord(lat, lon, alt, projectionInstance) {
    if (projectionInstance && typeof projectionInstance.latLonAltToCartesian === 'function') {
      return projectionInstance.latLonAltToCartesian(lat, lon, alt);
    }
    // Standard ENU Tangent Plane centered at K.R. Circle (12.9715987, 77.5945627, 920.0m)
    const lat0 = 12.9715987;
    const lon0 = 77.5945627;
    const alt0 = 920.0;
    const cosLat0 = Math.cos((lat0 * Math.PI) / 180.0);
    const radPerDeg = Math.PI / 180.0;
    const x = (lon - lon0) * radPerDeg * 6378137.0 * cosLat0;
    const z = -(lat - lat0) * radPerDeg * 6378137.0; // -Z is North in Three.js
    const y = (alt !== undefined ? alt : alt0) - alt0;
    return { x, y, z };
  }

  // ============================================================================
  // 3. ROAD SPLINE / NETWORK PARSER
  // ============================================================================
  function parseRoads(roadsData, projectionInstance) {
    const roadMap = new Map();
    if (!roadsData || !roadsData.features) return roadMap;

    roadsData.features.forEach(feat => {
      const coords = feat.geometry && feat.geometry.coordinates;
      if (!coords || coords.length < 2) return;

      const points = [];
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        points.push(projectCoord(c[1], c[0], c[2], projectionInstance));
      }

      const segments = [];
      let totalLength = 0;

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.001) continue;

        const fwdX = dx / len;
        const fwdZ = dz / len;
        const normX = -fwdZ; // Normal pointing to right of forward direction
        const normZ = fwdX;
        const headingRad = Math.atan2(fwdX, -fwdZ);

        segments.push({
          p1,
          p2,
          dx,
          dy,
          dz,
          length: len,
          fwdX,
          fwdZ,
          normX,
          normZ,
          headingRad,
          startDist: totalLength,
          endDist: totalLength + len
        });

        totalLength += len;
      }

      if (segments.length === 0) return;

      const lanes = feat.properties.lanes || 4;
      const roadWidth = (typeof CONFIG !== 'undefined' && CONFIG.ROADS && CONFIG.ROADS.widths && CONFIG.ROADS.widths[lanes])
        ? CONFIG.ROADS.widths[lanes]
        : (lanes * CONSTANTS.ROAD_LANE_WIDTH_M);

      roadMap.set(feat.id, {
        id: feat.id,
        name: feat.properties.name || feat.id,
        lanes,
        oneway: feat.properties.oneway !== false,
        speedLimitMps: (feat.properties.maxspeed || 40) / 3.6,
        startNode: feat.properties.start_node,
        endNode: feat.properties.end_node,
        points,
        segments,
        totalLength,
        width: roadWidth,
        feature: feat
      });
    });

    return roadMap;
  }

  // ============================================================================
  // 4. CIVILIAN VEHICLE ENTITY
  // ============================================================================
  class CivilianVehicle {
    /**
     * @param {string} id - Unique vehicle identifier
     * @param {string} type - Key from VEHICLE_CLASSES
     * @param {Object} road - Road network segment definition
     * @param {number} [laneIndex=0] - Lane assignment [0..lanes-1]
     * @param {number} [initialDistance=0.0] - Starting distance along road in meters
     */
    constructor(id, type, road, laneIndex = 0, initialDistance = 0.0) {
      this.id = id;
      this.type = VEHICLE_CLASSES[type] ? type : 'PASSENGER_CAR';
      this.classDef = VEHICLE_CLASSES[this.type];

      this.road = road;
      this.laneIndex = laneIndex;
      this.distanceAlongRoad = initialDistance;

      this.speedKmh = this.classDef.baseSpeedKmh * (0.85 + Math.random() * 0.30);
      this.speedMps = (this.speedKmh * 1000.0) / 3600.0;
      this.targetSpeedKmh = this.speedKmh;

      // Parting Wave Lateral Offset (0.0m = lane center, +1.8m or -1.8m = road shoulder)
      this.lateralOffset = 0.0;
      this.targetLateralOffset = 0.0;
      this.yieldDirection = (this.laneIndex >= (this.road.lanes / 2)) ? 1.0 : -1.0;

      // Position & Orientation
      this.position = { x: 0, y: 0, z: 0 };
      this.headingRad = 0.0;
      this.headingDeg = 0.0;

      // State Flags
      this.isYielding = false;
      this.isPastAmbulance = false;
      this.isQueued = false;
      this.isFlushing = false;

      // Palette Color
      const palette = this.classDef.palette;
      this.colorHex = palette[Math.floor(Math.random() * palette.length)];

      // Initialize position
      this.updatePositionFromSpline();
    }

    /**
     * Updates world position and heading from road spline, lane center, and lateral offset.
     */
    updatePositionFromSpline() {
      if (!this.road || !this.road.segments || this.road.segments.length === 0) return;

      let d = this.distanceAlongRoad;
      if (d < 0) d = 0;
      if (d > this.road.totalLength) d = this.road.totalLength;

      let seg = this.road.segments[0];
      for (let i = 0; i < this.road.segments.length; i++) {
        const s = this.road.segments[i];
        if (d >= s.startDist && d <= s.endDist) {
          seg = s;
          break;
        }
        if (i === this.road.segments.length - 1) {
          seg = s;
        }
      }

      const segDist = d - seg.startDist;
      const t = seg.length > 0.001 ? (segDist / seg.length) : 0.0;

      const cx = seg.p1.x + t * seg.dx;
      const cy = seg.p1.y + t * seg.dy;
      const cz = seg.p1.z + t * seg.dz;

      // Centerline offset for the assigned lane
      const lanes = this.road.lanes;
      const laneWidth = CONSTANTS.ROAD_LANE_WIDTH_M;
      const laneCenterOffset = (this.laneIndex + 0.5 - (lanes / 2.0)) * laneWidth;

      // Combined lateral displacement
      let totalLateral = laneCenterOffset + this.lateralOffset;

      // Road boundary clamping: never cross curb/sidewalk boundary (Test T3.8)
      const maxHalfWidth = (this.road.width / 2.0) - CONSTANTS.CURB_SAFETY_MARGIN_M;
      totalLateral = Math.max(-maxHalfWidth, Math.min(maxHalfWidth, totalLateral));

      this.position.x = cx + seg.normX * totalLateral;
      this.position.y = cy + 0.05;
      this.position.z = cz + seg.normZ * totalLateral;

      this.headingRad = seg.headingRad;
      this.headingDeg = (this.headingRad * 180.0) / Math.PI;
    }

    /**
     * Evaluates whether vehicle is inside the ambulance forward clearance cone.
     * Range = 80.0m, FOV angle = 0.7 rad (~40 deg). (Test T1.3.2, T2.3.4).
     *
     * @param {Object} cone - { position, forward, range, fovAngleRad, sirenActive }
     * @returns {boolean}
     */
    isInsideClearanceCone(cone) {
      if (!cone || !cone.position || !cone.forward) return false;

      const dx = this.position.x - cone.position.x;
      const dz = this.position.z - cone.position.z;
      const dist = Math.hypot(dx, dz);

      const range = cone.range !== undefined ? cone.range : CONSTANTS.CLEARANCE_RANGE_M;
      const fovRad = cone.fovAngleRad !== undefined ? cone.fovAngleRad : CONSTANTS.CLEARANCE_FOV_RAD;

      if (dist > range + 1e-5 || dist < 0.001) return false;

      const toVehX = dx / dist;
      const toVehZ = dz / dist;

      // Forward vector dot product
      const dot = cone.forward.x * toVehX + cone.forward.z * toVehZ;
      const minDot = Math.cos(fovRad / 2.0);

      return dot >= (minDot - 1e-5);
    }

    /**
     * Frame-by-frame autonomous AI update loop.
     *
     * @param {number} dt - Frame delta time in seconds
     * @param {Object} [ambulanceCone=null] - Forward clearance cone
     * @param {TrafficSignalPost} [junctionSignal=null] - Signal at upcoming intersection
     * @param {CivilianVehicle} [vehicleAhead=null] - Preceding vehicle in same lane
     */
    update(dt = 0.016, ambulanceCone = null, junctionSignal = null, vehicleAhead = null) {
      // ----------------------------------------------------------------------
      // 1. Parting Wave Clearance AI (Forward Raycast / Cone Sensor Integration)
      // ----------------------------------------------------------------------
      const sirenActive = ambulanceCone ? (ambulanceCone.sirenActive !== false) : false;

      if (ambulanceCone && sirenActive) {
        const dx = this.position.x - ambulanceCone.position.x;
        const dz = this.position.z - ambulanceCone.position.z;
        const dist = Math.hypot(dx, dz);

        const insideCone = this.isInsideClearanceCone(ambulanceCone);

        if (insideCone) {
          // Inside forward clearance cone: determine outward shoulder direction
          // Right normal vector of ambulance forward
          const ambRightX = -ambulanceCone.forward.z;
          const ambRightZ = ambulanceCone.forward.x;
          const lateralProjection = dx * ambRightX + dz * ambRightZ;

          // Steer outward: if vehicle is to the right of ambulance path, steer right (+1.8m), else left (-1.8m)
          const dir = lateralProjection >= 0 ? 1.0 : -1.0;
          this.yieldDirection = dir;

          // Compute max allowable lateral yield on this road without breaching curb
          const lanes = this.road.lanes;
          const laneWidth = CONSTANTS.ROAD_LANE_WIDTH_M;
          const laneCenter = (this.laneIndex + 0.5 - (lanes / 2.0)) * laneWidth;
          const maxHalfW = (this.road.width / 2.0) - CONSTANTS.CURB_SAFETY_MARGIN_M;

          let targetOffset = dir * CONSTANTS.PARTING_WAVE_SHIFT_M;
          if (dir > 0 && (laneCenter + targetOffset) > maxHalfW) {
            targetOffset = Math.max(0.0, maxHalfW - laneCenter);
          } else if (dir < 0 && (laneCenter + targetOffset) < -maxHalfW) {
            targetOffset = Math.min(0.0, -maxHalfW - laneCenter);
          }

          this.targetLateralOffset = targetOffset;
          this.isYielding = true;
          this.isPastAmbulance = false;

          // Decelerate while yielding to open central corridor
          this.targetSpeedKmh = this.classDef.baseSpeedKmh * 0.40;
        } else {
          // Check if ambulance has passed vehicle
          const fwdDot = ambulanceCone.forward.x * dx + ambulanceCone.forward.z * dz;

          // Ambulance has passed if vehicle is behind ambulance (fwdDot < 0) and distance > 25.0m
          if (fwdDot < 0 && dist >= CONSTANTS.RESTORE_THRESHOLD_M) {
            this.isPastAmbulance = true;
            this.targetLateralOffset = 0.0; // Restore to lane center (Test T1.3.4)
            this.targetSpeedKmh = this.classDef.baseSpeedKmh;
          } else if (!this.isYielding) {
            this.targetLateralOffset = 0.0;
          }
        }
      } else {
        // Acoustic gating: if siren is inactive, vehicle does NOT yield (Test T3.2)
        this.targetLateralOffset = 0.0;
        this.isYielding = false;
        this.targetSpeedKmh = this.classDef.baseSpeedKmh;
      }

      // Smooth lateral steering lerp towards target lateral offset
      const steerLerpSpeed = this.isYielding ? 4.0 : 2.5;
      this.lateralOffset += (this.targetLateralOffset - this.lateralOffset) * Math.min(1.0, steerLerpSpeed * dt);
      if (Math.abs(this.lateralOffset - this.targetLateralOffset) < 0.005) {
        this.lateralOffset = this.targetLateralOffset;
        if (this.targetLateralOffset === 0.0) {
          this.isYielding = false;
        }
      }

      // ----------------------------------------------------------------------
      // 2. Traffic Signal Interaction & Early Preemption Queue Flushing
      // ----------------------------------------------------------------------
      this.isQueued = false;
      this.isFlushing = false;

      if (junctionSignal && this.road) {
        const distToEnd = this.road.totalLength - this.distanceAlongRoad;

        // If approaching intersection within stop threshold
        if (distToEnd > 0 && distToEnd <= 35.0) {
          const state = junctionSignal.currentState;
          const isPreempted = junctionSignal.isPreempted || state === 'PRIORITY_GREEN';

          if (state === 'RED' || state === 'AMBER') {
            if (!isPreempted) {
              // Red signal: decelerate smoothly to stop before stop bar
              const stopTargetDist = Math.max(0.0, distToEnd - CONSTANTS.QUEUE_STOP_MARGIN_M);
              if (stopTargetDist < 25.0) {
                this.targetSpeedKmh = Math.max(0.0, (stopTargetDist / 25.0) * this.classDef.baseSpeedKmh * 0.5);
                if (stopTargetDist < 1.0) {
                  this.targetSpeedKmh = 0.0;
                  this.isQueued = true;
                }
              }
            }
          } else if (state === 'GREEN' || isPreempted) {
            // Signal turned Green (or Early Preemption Green Wave activated):
            // Queued civilian vehicles flush intersection rapidly (Test T3.5)
            this.isFlushing = isPreempted;
            this.targetSpeedKmh = this.classDef.baseSpeedKmh * (isPreempted ? 1.25 : 1.0);
          }
        }
      }

      // ----------------------------------------------------------------------
      // 3. Car-Following Model (Anti-Collision Gap Maintenance)
      // ----------------------------------------------------------------------
      if (vehicleAhead && vehicleAhead.road && vehicleAhead.road.id === this.road.id && vehicleAhead.laneIndex === this.laneIndex) {
        const gap = vehicleAhead.distanceAlongRoad - this.distanceAlongRoad - (this.classDef.lengthM / 2 + vehicleAhead.classDef.lengthM / 2);
        const safeGap = this.classDef.safeGapM;

        if (gap > 0 && gap < safeGap * 3.0) {
          if (gap < safeGap * 0.8) {
            this.targetSpeedKmh = 0.0; // Emergency brake to prevent collision
          } else {
            const headwayRatio = Math.max(0.1, (gap - safeGap * 0.8) / (safeGap * 2.2));
            this.targetSpeedKmh = Math.min(this.targetSpeedKmh, vehicleAhead.speedKmh * headwayRatio);
          }
        }
      }

      // ----------------------------------------------------------------------
      // 4. Longitudinal Speed Integration
      // ----------------------------------------------------------------------
      const targetSpeedMps = (this.targetSpeedKmh * 1000.0) / 3600.0;
      if (this.speedMps < targetSpeedMps) {
        this.speedMps = Math.min(targetSpeedMps, this.speedMps + this.classDef.accelMps2 * dt);
      } else if (this.speedMps > targetSpeedMps) {
        this.speedMps = Math.max(targetSpeedMps, this.speedMps - this.classDef.decelMps2 * dt);
      }
      this.speedKmh = (this.speedMps * 3600.0) / 1000.0;

      // Advance distance along road spline
      this.distanceAlongRoad += this.speedMps * dt;

      // ----------------------------------------------------------------------
      // 5. Update World Position & Orientation
      // ----------------------------------------------------------------------
      this.updatePositionFromSpline();
    }

    getPosition() {
      return this.position;
    }

    getHeadingDeg() {
      return this.headingDeg;
    }

    getSpeedKmh() {
      return this.speedKmh;
    }

    getPartingWaveOffset() {
      return this.lateralOffset;
    }

    /**
     * Syncs this CivilianVehicle state from a SimVehicle (SimulationEngine).
     * Used when the deterministic simulation engine is the authority.
     * @param {SimVehicle} simVeh
     */
    syncFromSimulation(simVeh) {
      this.id = simVeh.id;
      this.type = simVeh.cls.id;
      this.classDef = simVeh.cls;
      this.distanceAlongRoad = simVeh.s;
      this.speedMps = simVeh.v;
      this.speedKmh = simVeh.v * 3.6;
      this.lateralOffset = 0.0; // Sim vehicles don't have lateral offset

      // Update world position from edge sample
      const sample = simVeh.edge.sampleAt(simVeh.s);
      if (this.road && this.road.segments && this.road.segments.length > 0) {
        // Find the corresponding segment
        const proj = (typeof window !== 'undefined' && window.projectionInstance) ? window.projectionInstance : null;
        if (proj) {
          const world = proj.latLonAltToCartesian(sample.lat, sample.lon, sample.alt);
          this.position.x = world.x;
          this.position.y = 0.05; // Slightly above road deck (y=0.0)
          this.position.z = world.z;
          this.headingRad = sample.headingRad;
          this.headingDeg = (this.headingRad * 180.0) / Math.PI;
        }
      }
    }
  }

  // ============================================================================
  // 5. PROCEDURAL 3D VEHICLE GEOMETRY GENERATOR (InstancedMesh Compatibility)
  // ============================================================================
  function createVehicleGeometry(type) {
    if (typeof THREE === 'undefined') return null;

    const def = VEHICLE_CLASSES[type] || VEHICLE_CLASSES.PASSENGER_CAR;
    const w = def.widthM;
    const l = def.lengthM;
    const h = def.heightM;

    // Stylized compound box geometry with proportional dimensions
    const geo = new THREE.BoxGeometry(w, h * 0.75, l);
    // FIXED: Road deck is at y=0.0, wheels should touch at y=0.0
    // Vehicle body center at y = (h * 0.75) / 2, so bottom of body at y = 0
    // But we want wheels at y=0.0, so translate by wheel radius (approx 0.3m)
    const wheelRadius = 0.3;
    geo.translate(0, (h * 0.75) / 2 + wheelRadius, 0);
    return geo;
  }

  // ============================================================================
  // 6. TRAFFIC SWARM MANAGER
  // ============================================================================
  class TrafficSwarmManager {
    /**
     * @param {THREE.Scene} scene
     * @param {...any} args - Can accept projection, environment, signals, ambulance in any order
     */
    constructor(scene, arg1 = null, arg2 = null, arg3 = null, arg4 = null, options = {}) {
      this.scene = scene;

      // Flexible argument resolution supporting all caller conventions
      const candidateArgs = [arg1, arg2, arg3, arg4];
      let resolvedProjection = null;
      let resolvedEnvironment = null;
      let resolvedSignals = null;
      let resolvedAmbulance = null;
      let resolvedOptions = (options && typeof options === 'object') ? options : {};

      candidateArgs.forEach(a => {
        if (!a) return;
        if (typeof a.latLonAltToCartesian === 'function') {
          resolvedProjection = a;
        } else if (a.meshes || a.materials || (a.projection && typeof a.projection.latLonAltToCartesian === 'function')) {
          resolvedEnvironment = a;
          if (!resolvedProjection && a.projection) resolvedProjection = a.projection;
        } else if (typeof a.updatePreemption === 'function' || (a.signals && a.signals instanceof Map)) {
          resolvedSignals = a;
        } else if (typeof a.getClearanceCone === 'function' || typeof a.toggleSiren === 'function') {
          resolvedAmbulance = a;
        } else if (typeof a === 'object' && (a.maxVehicles || a.count)) {
          resolvedOptions = a;
        }
      });

      this.projection = resolvedProjection || (typeof window !== 'undefined' ? window.projectionInstance : null);
      this.environment = resolvedEnvironment || (typeof window !== 'undefined' ? window.environmentInstance : null);
      this.signals = resolvedSignals || (typeof window !== 'undefined' ? window.signalManagerInstance : null);
      this.ambulance = resolvedAmbulance || (typeof window !== 'undefined' ? window.ambulanceInstance : null);
      this.options = resolvedOptions;

      this.maxVehicles = this.options.maxVehicles || CONSTANTS.DEFAULT_MAX_VEHICLES;
      this.activeVehicleCount = this.options.count || CONSTANTS.DEFAULT_SPAWN_COUNT;

      this.roads = new Map();
      this.vehicles = [];
      this.nodeToSignalMap = new Map();
      this.roadConnections = new Map();

      // Three.js InstancedMesh batches
      this.trafficGroup = null;
      this.instancedMeshes = {};
      this.dummyTransform = (typeof THREE !== 'undefined') ? new THREE.Object3D() : null;

      // 1. Ingest road network & build road topology
      this.initRoadNetwork();

      // 2. Map traffic signal posts by node_id
      this.initSignalMap();

      // 3. Build Three.js InstancedMeshes (<5 draw calls total)
      this.initInstancedRendering();

      // 4. Populate civilian traffic swarm
      this.spawnSwarm(this.activeVehicleCount);
    }

    /**
     * Ingests and parses Central Bengaluru road network GeoJSON.
     */
    initRoadNetwork() {
      let roadsData = null;
      if (typeof ROADS_DATA !== 'undefined') {
        roadsData = ROADS_DATA;
      } else if (typeof global !== 'undefined' && global.ROADS_DATA) {
        roadsData = global.ROADS_DATA;
      } else {
        try {
          // Fallback loader for headless test runner
          const path = require('path');
          const fs = require('fs');
          const p = path.resolve(__dirname, '..', 'preview_data.js');
          if (fs.existsSync(p)) {
            const code = fs.readFileSync(p, 'utf8');
            const sandbox = {};
            const vm = require('vm');
            vm.runInNewContext(code, sandbox);
            roadsData = sandbox.ROADS_DATA;
          }
        } catch (e) {}
      }

      if (roadsData) {
        this.roads = parseRoads(roadsData, this.projection);
      }

      // Build road node connectivity graph
      this.roads.forEach(road => {
        if (!this.roadConnections.has(road.startNode)) {
          this.roadConnections.set(road.startNode, []);
        }
        this.roadConnections.get(road.startNode).push(road);
      });
    }

    /**
     * Maps traffic signal posts by OSM intersection node ID.
     */
    initSignalMap() {
      this.nodeToSignalMap.clear();

      if (this.signals && typeof this.signals.getAllSignals === 'function') {
        const sigList = this.signals.getAllSignals();
        sigList.forEach(sig => {
          if (sig.properties && sig.properties.node_id) {
            this.nodeToSignalMap.set(sig.properties.node_id, sig);
          }
          if (sig.id) {
            this.nodeToSignalMap.set(sig.id, sig);
          }
        });
      }
    }

    /**
     * Constructs THREE.InstancedMesh batches for the 4 vehicle archetypes.
     * Guarantees 60 FPS performance with exactly 4 draw calls.
     */
    initInstancedRendering() {
      if (typeof THREE === 'undefined' || !this.scene) return;

      this.trafficGroup = new THREE.Group();
      this.trafficGroup.name = 'CivilianTrafficSwarm';
      this.scene.add(this.trafficGroup);

      const archetypes = Object.keys(VEHICLE_CLASSES);

      archetypes.forEach(archetype => {
        const geo = createVehicleGeometry(archetype);
        if (!geo) return;

        const mat = new THREE.MeshStandardMaterial({
          roughness: 0.50,
          metalness: 0.35,
          vertexColors: false
        });

        // Maximum capacity per archetype InstancedMesh
        const instMesh = new THREE.InstancedMesh(geo, mat, this.maxVehicles);
        instMesh.name = `InstancedMesh_${archetype}`;
        instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instMesh.castShadow = true;
        instMesh.receiveShadow = true;
        instMesh.count = 0; // Set dynamically in update

        this.instancedMeshes[archetype] = instMesh;
        this.trafficGroup.add(instMesh);
      });
    }

    /**
     * Populates civilian vehicle swarm distributed across road network.
     * Proportions: 35% Two-Wheelers, 25% Auto-Rickshaws, 25% Passenger Cars, 15% BMTC Buses.
     *
     * @param {number} count - Number of vehicles to spawn
     */
    spawnSwarm(count = CONSTANTS.DEFAULT_SPAWN_COUNT) {
      this.vehicles = [];
      if (this.roads.size === 0) return;

      const roadList = Array.from(this.roads.values());
      const archetypeDistribution = [
        'TWO_WHEELER', 'TWO_WHEELER', 'TWO_WHEELER', 'TWO_WHEELER', 'TWO_WHEELER', 'TWO_WHEELER', 'TWO_WHEELER',
        'AUTO_RICKSHAW', 'AUTO_RICKSHAW', 'AUTO_RICKSHAW', 'AUTO_RICKSHAW', 'AUTO_RICKSHAW',
        'PASSENGER_CAR', 'PASSENGER_CAR', 'PASSENGER_CAR', 'PASSENGER_CAR', 'PASSENGER_CAR',
        'BMTC_BUS', 'BMTC_BUS', 'BMTC_BUS'
      ];

      for (let i = 0; i < count; i++) {
        const road = roadList[i % roadList.length];
        const archetype = archetypeDistribution[i % archetypeDistribution.length];
        const lane = i % road.lanes;
        const initialDist = ((i * 37.5) % Math.max(10.0, road.totalLength - 10.0));

        const veh = new CivilianVehicle(`veh_${i}`, archetype, road, lane, initialDist);
        this.vehicles.push(veh);
      }
    }

    /**
     * Master simulation update loop called at 60 FPS.
     *
     * @param {number} dt - Frame delta time in seconds
     * @param {AmbulanceManager|Object} [ambulanceOrCone=null] - Ambulance instance or clearance cone
     * @param {SignalManager} [signals=null] - Traffic signals manager
     */
    update(dt = 0.016, ambulanceOrCone = null, signals = null) {
      if (signals) {
        this.signals = signals;
        if (this.nodeToSignalMap.size === 0) {
          this.initSignalMap();
        }
      }

      // Extract forward clearance cone
      let cone = null;
      if (ambulanceOrCone) {
        if (typeof ambulanceOrCone.getClearanceCone === 'function') {
          cone = ambulanceOrCone.getClearanceCone();
        } else if (ambulanceOrCone.forward && ambulanceOrCone.position) {
          cone = ambulanceOrCone;
        }
      } else if (this.ambulance && typeof this.ambulance.getClearanceCone === 'function') {
        cone = this.ambulance.getClearanceCone();
      }

      // Group vehicles by road and lane for collision detection
      const vehiclesByRoadLane = new Map();
      this.vehicles.forEach(v => {
        const key = `${v.road.id}_${v.laneIndex}`;
        if (!vehiclesByRoadLane.has(key)) {
          vehiclesByRoadLane.set(key, []);
        }
        vehiclesByRoadLane.get(key).push(v);
      });

      // Sort vehicles by distance along road descending
      vehiclesByRoadLane.forEach(list => {
        list.sort((a, b) => b.distanceAlongRoad - a.distanceAlongRoad);
      });

      // Update each civilian vehicle
      for (let i = 0; i < this.vehicles.length; i++) {
        const veh = this.vehicles[i];
        const road = veh.road;

        // 1. Identify vehicle ahead in same lane
        const laneList = vehiclesByRoadLane.get(`${road.id}_${veh.laneIndex}`);
        let vehAhead = null;
        if (laneList) {
          const idx = laneList.indexOf(veh);
          if (idx > 0) {
            vehAhead = laneList[idx - 1];
          }
        }

        // 2. Identify traffic signal at road end
        let junctionSignal = null;
        if (this.nodeToSignalMap.has(road.endNode)) {
          junctionSignal = this.nodeToSignalMap.get(road.endNode);
        }

        // 3. Autonomous state update
        veh.update(dt, cone, junctionSignal, vehAhead);

        // 4. Handle end-of-road transitions
        if (veh.distanceAlongRoad >= road.totalLength) {
          const nextRoads = this.roadConnections.get(road.endNode);
          if (nextRoads && nextRoads.length > 0) {
            // Transfer to connected road segment
            const nextRoad = nextRoads[Math.floor(Math.random() * nextRoads.length)];
            veh.road = nextRoad;
            veh.laneIndex = veh.laneIndex % nextRoad.lanes;
            veh.distanceAlongRoad = 0.0;
          } else {
            // Loop back to start of current road
            veh.distanceAlongRoad = 0.0;
          }
          veh.updatePositionFromSpline();
        }
      }

      // 5. Synchronize Three.js InstancedMesh transformation matrices
      this.updateInstancedMeshes();
    }

    /**
     * Synchronizes 3D transform matrices and colors to THREE.InstancedMesh.
     */
    updateInstancedMeshes() {
      if (typeof THREE === 'undefined' || !this.trafficGroup || !this.dummyTransform) return;

      const instancesByClass = {
        AUTO_RICKSHAW: 0,
        BMTC_BUS: 0,
        TWO_WHEELER: 0,
        PASSENGER_CAR: 0
      };

      const threeColor = new THREE.Color();

      for (let i = 0; i < this.vehicles.length; i++) {
        const v = this.vehicles[i];
        const mesh = this.instancedMeshes[v.type];
        if (!mesh) continue;

        const idx = instancesByClass[v.type];
        if (idx >= this.maxVehicles) continue;

        this.dummyTransform.position.set(v.position.x, v.position.y, v.position.z);
        this.dummyTransform.rotation.set(0, v.headingRad, 0);
        this.dummyTransform.scale.set(1, 1, 1);
        this.dummyTransform.updateMatrix();

        mesh.setMatrixAt(idx, this.dummyTransform.matrix);

        threeColor.setHex(v.colorHex);
        mesh.setColorAt(idx, threeColor);

        instancesByClass[v.type]++;
      }

      // Update draw counts and flag buffers
      Object.keys(instancesByClass).forEach(archetype => {
        const mesh = this.instancedMeshes[archetype];
        if (mesh) {
          mesh.count = instancesByClass[archetype];
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
          }
        }
      });
    }

    /**
     * Resizes active vehicle swarm count.
     * @param {number} count
     */
    setVehicleCount(count) {
      const clamped = Math.max(0, Math.min(this.maxVehicles, count));
      this.activeVehicleCount = clamped;
      this.spawnSwarm(clamped);
      return clamped;
    }

    /**
     * Scales vehicle swarm density.
     * @param {number} density - Between 0.0 and 1.0
     */
    setTrafficDensity(density) {
      const d = Math.max(0.0, Math.min(1.0, density));
      const targetCount = Math.round(d * this.maxVehicles);
      return this.setVehicleCount(targetCount);
    }

    getVehicles() {
      return this.vehicles;
    }

    getVehicleCount() {
      return this.vehicles.length;
    }

    getVehicle(id) {
      return this.vehicles.find(v => v.id === id);
    }

    /**
     * Synchronizes the civilian vehicle swarm with the SimulationEngine's live vehicles.
     * This is called when the deterministic SimulationEngine is the authority.
     * 
     * @param {SimulationEngine} sim - The simulation engine instance
     */
    syncFromSimulation(sim) {
      if (!sim || !sim.vehicles) return;

      // Map simulation vehicles to our civilian vehicles
      // We'll reuse existing CivilianVehicle instances where possible
      const simVehicles = Array.from(sim.vehicles.values()).filter(v => !v.cls.isEmergency);
      
      // If we have fewer vehicles than sim, create new ones
      // If we have more, we'll only sync the first N
      const targetCount = Math.min(simVehicles.length, this.maxVehicles);
      
      // Reuse or create CivilianVehicle instances
      for (let i = 0; i < targetCount; i++) {
        const simVeh = simVehicles[i];
        
        if (i < this.vehicles.length) {
          // Sync existing vehicle
          this.vehicles[i].syncFromSimulation(simVeh);
        } else {
          // Create new vehicle from sim data
          const road = this._findRoadForEdge(simVeh.edge.id);
          if (road) {
            const veh = new CivilianVehicle(simVeh.id, simVeh.cls.id, road, simVeh.laneIndex, simVeh.s);
            veh.speedMps = simVeh.v;
            veh.speedKmh = simVeh.v * 3.6;
            veh.distanceAlongRoad = simVeh.s;
            this.vehicles.push(veh);
          }
        }
      }
      
      // Trim excess vehicles
      if (this.vehicles.length > targetCount) {
        this.vehicles.length = targetCount;
      }
    }

    /**
     * Helper to find road segment matching a simulation edge.
     * @param {string} edgeId
     */
    _findRoadForEdge(edgeId) {
      for (const road of this.roads.values()) {
        if (road.id === edgeId || road.feature?.properties?.id === edgeId) {
          return road;
        }
      }
      // Fallback: return first road
      return this.roads.values().next().value;
    }
  }

  // Common aliases
  TrafficSwarmManager.TrafficManager = TrafficSwarmManager;
  TrafficSwarmManager.CivilianVehicle = CivilianVehicle;
  TrafficSwarmManager.VEHICLE_CLASSES = VEHICLE_CLASSES;
  TrafficSwarmManager.CONSTANTS = CONSTANTS;

  return {
    TrafficSwarmManager,
    TrafficManager: TrafficSwarmManager,
    CivilianVehicle,
    VEHICLE_CLASSES,
    CONSTANTS
  };
}));
