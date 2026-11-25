/**
 * js/vehicle_layer.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — MapLibre + Three.js Vehicle Layer
 * Implements MapLibre CustomLayerInterface sharing the WebGL context with Three.js r128.
 * Renders a multi-part 3D ambulance (with flashing red/blue lightbar) + up to 250
 * InstancedMesh civilian vehicles (cars, auto-rickshaws, BMTC buses, two-wheelers)
 * aligned to MapLibre streets via MercatorCoordinate.meterInMercatorCoordinateUnits().
 * Browser-global (window.VehicleLayer / window.vehicleLayerInstance) & CommonJS compatible (UMD).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VehicleLayer = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ORIGIN_LON_LAT = [77.5945627, 12.9715987];
  const MAX_FLEET_INSTANCES = 250;

  const ARCHETYPE_SPECS = {
    PASSENGER_CAR: {
      length: 4.2, width: 1.8, height: 1.5,
      colors: [0xe2e8f0, 0x94a3b8, 0xfbbf24, 0x475569, 0x38bdf8]
    },
    AUTO_RICKSHAW: {
      length: 2.8, width: 1.4, height: 1.8,
      colors: [0xfacc15, 0xfde047, 0xeab308]
    },
    BMTC_BUS: {
      length: 11.0, width: 2.6, height: 3.2,
      colors: [0x1d4ed8, 0x0284c7, 0x2563eb]
    },
    TWO_WHEELER: {
      length: 1.9, width: 0.85, height: 1.25,
      colors: [0xef4444, 0x334155, 0x0ea5e9, 0x22c55e]
    }
  };

  class VehicleLayer {
    constructor(options = {}) {
      this.map = options.map || null;
      this.projection = options.projection || null;
      this.signalManager = options.signalManager || null;
      this.sim = options.sim || null;
      this.ambulance = options.ambulance || null;
      this.traffic = options.traffic || null;

      this.maxVehicles = MAX_FLEET_INSTANCES;
      this._headless = (typeof THREE === 'undefined' || typeof maplibregl === 'undefined');
      this._layerAdded = false;

      // Three.js objects owned by the custom layer
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.originMercator = null;
      this.originScale = 1;

      this.ambulanceGroup = null;
      this.leftStrobeMat = null;
      this.rightStrobeMat = null;
      this.instancedMeshes = {};
      this._dummy = (typeof THREE !== 'undefined') ? new THREE.Object3D() : null;
      this._tempColor = (typeof THREE !== 'undefined') ? new THREE.Color() : null;
      this._worldMatrix = (typeof THREE !== 'undefined') ? new THREE.Matrix4() : null;
      this._rotX = (typeof THREE !== 'undefined') ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : null;
      this._lastRepaintAt = 0;
      this._ambientFleet = [];
      this._lastAmbientUpdateAt = 0;

      // Stage 7: Corridor traffic queue & siren parting wave state
      this._sirenPartingWaveActive = false;
      this._partingWaveOffset = 1.8; // ±1.8m curb offset for siren yielding
      this._greenWaveActiveEdges = new Set(); // Edge IDs with active Green Wave discharge
    }

    configure(options = {}) {
      if (options.map !== undefined) this.map = options.map;
      if (options.projection !== undefined) this.projection = options.projection;
      if (options.signalManager !== undefined) this.signalManager = options.signalManager;
      if (options.sim !== undefined) this.sim = options.sim;
      if (options.ambulance !== undefined) this.ambulance = options.ambulance;
      if (options.traffic !== undefined) this.traffic = options.traffic;
      return this;
    }

    setMap(map) {
      this.map = map;
      if (map) this.init();
    }

    setProjection(projection) { this.projection = projection; }
    setSignalManager(signalManager) { this.signalManager = signalManager; }
    setSimulation(sim) { this.sim = sim; }
    setAmbulance(ambulance) { this.ambulance = ambulance; }
    setTraffic(traffic) { this.traffic = traffic; }

    init() {
      if (this._headless || !this.map) {
        return Promise.resolve(this);
      }
      if (this._layerAdded) {
        return Promise.resolve(this);
      }

      const attachLayer = () => {
        if (this._layerAdded || !this.map) return;
        if (this.map.getLayer('vehicle-fleet-layer')) {
          this._layerAdded = true;
          return;
        }
        const customLayer = this._createCustomLayer();
        this.map.addLayer(customLayer);
        this._layerAdded = true;
        console.log('VehicleLayer: CustomLayerInterface registered (250-cap fleet + 3D ambulance)');
      };

      // MapLibre may have already fired 'load' before setMap() is called, even while
      // isStyleLoaded() is temporarily false during source/paint updates. Attach immediately
      // if the map is loaded or has a style, otherwise wait for 'load'.
      if ((this.map.loaded && this.map.loaded()) ||
          (this.map.isStyleLoaded && this.map.isStyleLoaded()) ||
          (this.map.getStyle && this.map.getStyle())) {
        attachLayer();
      } else {
        this.map.once('load', attachLayer);
      }
      return Promise.resolve(this);
    }

    _createCustomLayer() {
      const self = this;
      return {
        id: 'vehicle-fleet-layer',
        type: 'custom',
        renderingMode: '3d',

        onAdd(map, gl) {
          self.map = map;
          self.scene = new THREE.Scene();
          self.camera = new THREE.Camera();

          // Anchor ENU meter space at Bengaluru origin using MercatorCoordinate
          const origin = (typeof CONFIG !== 'undefined' && CONFIG.GEO && CONFIG.GEO.origin)
            ? [CONFIG.GEO.origin.lon, CONFIG.GEO.origin.lat]
            : ORIGIN_LON_LAT;
          self.originMercator = maplibregl.MercatorCoordinate.fromLngLat(origin, 0);
          self.originScale = self.originMercator.meterInMercatorCoordinateUnits();

          // Lighting for 3D ambulance & civilian fleet
          const ambient = new THREE.AmbientLight(0xffffff, 1.15);
          self.scene.add(ambient);

          const hemi = new THREE.HemisphereLight(0xbae6fd, 0x334155, 0.95);
          self.scene.add(hemi);

          const sun = new THREE.DirectionalLight(0xffffff, 1.35);
          sun.position.set(120, 260, 140);
          self.scene.add(sun);

          self._buildAmbulanceMesh();
          self._buildCivilianInstancedFleet();

          self.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
          });
          self.renderer.autoClear = false;
        },

        render(gl, matrix) {
          if (!self.renderer || !self.scene || !self.camera || !self.originMercator) return;

          const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          self._updateStrobes(now);
          self._syncFleetMatrices();

          // Build model matrix mapping ENU meters (+X East, +Y Up, -Z North) -> Mercator clip space
          const m = new THREE.Matrix4().fromArray(matrix);
          const l = new THREE.Matrix4()
            .makeTranslation(self.originMercator.x, self.originMercator.y, self.originMercator.z)
            .scale(new THREE.Vector3(self.originScale, -self.originScale, self.originScale))
            .multiply(self._rotX);

          self.camera.projectionMatrix = m.multiply(l);

          // Reset Three.js WebGL state on EVERY render call before drawing on shared MapLibre context
          self.renderer.resetState();
          self.renderer.render(self.scene, self.camera);
        }
      };
    }

    /**
     * Multi-part 3D Ambulance facing -Z (North when rotation.y = 0).
     * Dimensions: ~5.5m length, 2.2m width, 2.4m height.
     */
    _buildAmbulanceMesh() {
      const group = new THREE.Group();
      group.name = 'Ambulance3D';

      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.15 });
      const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35, metalness: 0.1 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.6 });
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
      const bumperMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.4 });

      // Patient box (rear +Z)
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.85, 3.6), whiteMat);
      box.position.set(0, 1.32, 0.85);
      group.add(box);

      // Front cab (front -Z)
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.40, 1.85), whiteMat);
      cab.position.set(0, 1.08, -1.75);
      group.add(cab);

      // Sloped windshield
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.72, 0.15), glassMat);
      windshield.position.set(0, 1.48, -2.56);
      windshield.rotation.x = 0.35;
      group.add(windshield);

      // Red emergency flank stripes
      const stripeGeo = new THREE.BoxGeometry(2.20, 0.24, 3.62);
      const stripe = new THREE.Mesh(stripeGeo, redMat);
      stripe.position.set(0, 1.05, 0.85);
      group.add(stripe);

      // Roof red cross (bold for aerial & chase readability)
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 1.45), redMat);
      crossV.position.set(0, 2.29, 0.95);
      group.add(crossV);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.08, 0.42), redMat);
      crossH.position.set(0, 2.29, 0.95);
      group.add(crossH);

      // Roof lightbar base
      const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.16, 0.48), bumperMat);
      barBase.position.set(0, 2.34, -0.55);
      group.add(barBase);

      // Flashing Red & Blue strobe pods (oversized for unmistakable visibility)
      this.leftStrobeMat = new THREE.MeshBasicMaterial({ color: 0xff1e38 });
      this.rightStrobeMat = new THREE.MeshBasicMaterial({ color: 0x0ea5e9 });
      const podGeo = new THREE.BoxGeometry(0.84, 0.30, 0.52);

      const leftPod = new THREE.Mesh(podGeo, this.leftStrobeMat);
      leftPod.position.set(-0.48, 2.48, -0.55);
      group.add(leftPod);

      const rightPod = new THREE.Mesh(podGeo, this.rightStrobeMat);
      rightPod.position.set(0.48, 2.48, -0.55);
      group.add(rightPod);

      // Headlights
      const hlMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
      const hlGeo = new THREE.BoxGeometry(0.36, 0.18, 0.10);
      const hlL = new THREE.Mesh(hlGeo, hlMat);
      hlL.position.set(-0.72, 0.65, -2.68);
      const hlR = new THREE.Mesh(hlGeo, hlMat);
      hlR.position.set(0.72, 0.65, -2.68);
      group.add(hlL, hlR);

      // 4 Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.40, 0.40, 0.28, 14);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheelCoords = [
        [-1.02, 0.40, -1.65],
        [1.02, 0.40, -1.65],
        [-1.02, 0.40, 1.55],
        [1.02, 0.40, 1.55]
      ];
      for (const [wx, wy, wz] of wheelCoords) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(wx, wy, wz);
        group.add(w);
      }

      this.ambulanceGroup = group;
      this.ambulanceGroup.traverse((obj) => {
        obj.frustumCulled = false;
      });
      this.scene.add(group);
    }

    /**
     * Create InstancedMesh batches with 250-vehicle capacity for mixed Bengaluru traffic.
     */
    _buildCivilianInstancedFleet() {
      for (const [type, spec] of Object.entries(ARCHETYPE_SPECS)) {
        const geo = this._createVehicleArchetypeGeometry(type, spec);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.40,
          metalness: 0.15,
          emissive: 0x1e293b,
          emissiveIntensity: 0.35
        });

        const mesh = new THREE.InstancedMesh(geo, mat, MAX_FLEET_INSTANCES);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;

        // Pre-allocate instanceColor buffer initialized to white so setColorAt works reliably in r128
        const colorArr = new Float32Array(MAX_FLEET_INSTANCES * 3);
        colorArr.fill(1.0);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArr, 3);

        this.instancedMeshes[type] = mesh;
        this.scene.add(mesh);
      }
    }

    /**
     * Populate lightweight visual ambient traffic along real OSM edges of SimulationNetwork
     * (including Majestic->Victoria, Kempegowda Rd, Avenue Rd, Silk Board, Hosur Rd)
     * without altering deterministic SimulationEngine state.
     */
    _ensureAmbientFleet() {
      if (this._ambientFleet.length > 0) return;
      if (!this.sim || !this.sim.network || typeof this.sim.network.getEdgeList !== 'function') return;

      const edges = this.sim.network.getEdgeList().filter(e => e && e.length > 40 && !e._blocked);
      if (edges.length === 0) return;

      const priorityEdges = edges.filter(e =>
        /kg_|avenue|seshadri|nrupathunga|fort_victoria|nr_road|silk_board|btm|st_johns|hosur/i.test(e.id)
      );
      const types = ['PASSENGER_CAR', 'AUTO_RICKSHAW', 'TWO_WHEELER', 'PASSENGER_CAR', 'BMTC_BUS', 'AUTO_RICKSHAW'];

      const count = 96;
      for (let i = 0; i < count; i += 1) {
        const pool = (i < 48 && priorityEdges.length > 0) ? priorityEdges : edges;
        const edge = pool[i % pool.length];
        const lane = i % Math.max(1, edge.lanes || 2);
        const s = ((i * 73.0) % Math.max(20, edge.length - 10));
        const speedMps = 7.5 + (i % 5) * 1.4;
        this._ambientFleet.push({
          id: `amb_civ_${i}`,
          type: types[i % types.length],
          edge,
          lane,
          s,
          speedMps
        });
      }
    }

    _stepAmbientFleet(nowMs) {
      this._ensureAmbientFleet();
      if (this._ambientFleet.length === 0) return;
      const dt = this._lastAmbientUpdateAt > 0
        ? Math.min(0.1, Math.max(0, (nowMs - this._lastAmbientUpdateAt) * 0.001))
        : 0.016;
      this._lastAmbientUpdateAt = nowMs;

      for (const v of this._ambientFleet) {
        v.s += v.speedMps * dt;
        if (v.s >= v.edge.length) {
          v.s = v.s % v.edge.length;
        }
      }
    }

    _createVehicleArchetypeGeometry(type, spec) {
      const { length, width, height } = spec;
      const bodyHeight = type === 'BMTC_BUS' ? height * 0.88 : height * 0.52;
      const bodyGeo = new THREE.BoxGeometry(width, bodyHeight, length);
      bodyGeo.translate(0, bodyHeight / 2 + 0.18, 0);

      if (typeof THREE.BufferGeometryUtils !== 'undefined' &&
          typeof THREE.BufferGeometryUtils.mergeBufferGeometries === 'function') {
        try {
          const cabinH = type === 'BMTC_BUS' ? height * 0.14 : height * 0.42;
          const cabinL = type === 'BMTC_BUS' ? length * 0.92 : (type === 'TWO_WHEELER' ? length * 0.42 : length * 0.56);
          const cabinW = width * 0.88;
          const cabinGeo = new THREE.BoxGeometry(cabinW, cabinH, cabinL);
          cabinGeo.translate(0, bodyHeight + cabinH / 2 + 0.16, type === 'PASSENGER_CAR' ? length * 0.05 : 0);
          const merged = THREE.BufferGeometryUtils.mergeBufferGeometries([bodyGeo, cabinGeo], false);
          if (merged) return merged;
        } catch (e) {
          // Fall back to single body box
        }
      }
      return bodyGeo;
    }

    _updateStrobes(nowMs) {
      if (!this.leftStrobeMat || !this.rightStrobeMat) return;
      const sirenActive = this.ambulance && typeof this.ambulance.isSirenActive === 'function'
        ? this.ambulance.isSirenActive()
        : true;
      if (!sirenActive) {
        this.leftStrobeMat.color.setHex(0x450a0a);
        this.rightStrobeMat.color.setHex(0x0c4a6e);
        return;
      }
      // 4 Hz alternating Red / Blue emergency strobe
      const phase = ((nowMs * 0.001) * 4.0) % 1.0;
      const redHot = phase < 0.5;
      this.leftStrobeMat.color.setHex(redHot ? 0xff1e38 : 0x3b0712);
      this.rightStrobeMat.color.setHex(!redHot ? 0x00a6ff : 0x082f49);
    }

    /**
     * Convert [lon, lat] to local ENU meters relative to `originMercator` using
     * MapLibre's exact MercatorCoordinate & meterInMercatorCoordinateUnits().
     */
    _lngLatToLocalMeters(lon, lat) {
      const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
      const localScale = mc.meterInMercatorCoordinateUnits();
      const x = (mc.x - this.originMercator.x) / this.originScale;
      const z = (mc.y - this.originMercator.y) / this.originScale;
      const scaleRatio = localScale / this.originScale;
      return { x, z, scaleRatio };
    }

    /**
     * Adaptive visual scale so vehicles have realistic 1:1–1.4x street proportions
     * at close Chase/Junction zooms while remaining visible at city overview zooms.
     */
    _getZoomVisualScale() {
      if (!this.map) return 2.8;
      const zoom = this.map.getZoom();
      if (zoom >= 16.5) return 2.8;
      if (zoom >= 14.0) return 2.8 + (16.5 - zoom) * 1.0;
      return Math.min(7.5, 5.3 + (14.0 - zoom) * 1.2);
    }

    _syncFleetMatrices() {
      if (!this.originMercator || !this._dummy) return;

      const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      this._stepAmbientFleet(nowMs);

      // Stage 7: Update siren parting wave state
      this._updateSirenPartingWave();

      // Stage 7: Update Green Wave active edges for queue discharge visualization
      this._updateGreenWaveEdges();

      const counts = {
        PASSENGER_CAR: 0,
        AUTO_RICKSHAW: 0,
        BMTC_BUS: 0,
        TWO_WHEELER: 0
      };

      const visualScale = this._getZoomVisualScale();
      let ambPlaced = false;
      let totalCivilianAdded = 0;

      const pushCivilian = (typeKey, wx, wz, headingRad, scaleRatio, idStr) => {
        if (totalCivilianAdded >= MAX_FLEET_INSTANCES) return;
        const type = ARCHETYPE_SPECS[typeKey] ? typeKey : 'PASSENGER_CAR';
        const mesh = this.instancedMeshes[type];
        const idx = counts[type];
        if (!mesh || idx >= MAX_FLEET_INSTANCES) return;

        const s = scaleRatio * visualScale;
        this._dummy.position.set(wx, 0.25, wz);
        this._dummy.rotation.set(0, -headingRad, 0);
        this._dummy.scale.set(s, s, s);
        this._dummy.updateMatrix();
        mesh.setMatrixAt(idx, this._dummy.matrix);

        const palette = ARCHETYPE_SPECS[type].colors;
        const colorIdx = this._hashId(idStr) % palette.length;
        this._tempColor.setHex(palette[colorIdx]);
        mesh.setColorAt(idx, this._tempColor);

        counts[type] += 1;
        totalCivilianAdded += 1;
      };

      // 1. Primary vehicles from deterministic SimulationEngine (includes amb_1 + network fleet)
      // Prioritize emergency vehicle + corridor/nearby vehicles so the 250-instance cap
      // never drops queued traffic directly ahead of the ambulance.
      let ambWorldX = null;
      let ambWorldZ = null;
      let ambHeadingRad = 0;
      const routeEdgeSet = new Set(
        (this.sim && this.sim.routingController && Array.isArray(this.sim.routingController.currentRouteEdges))
          ? this.sim.routingController.currentRouteEdges
          : []
      );

      if (this.sim && this.sim.vehicles) {
        const priorityCivilians = [];
        const backgroundCivilians = [];

        for (const veh of this.sim.vehicles.values()) {
          if (!veh || !veh.edge) continue;
          const sample = veh.edge.sampleAt(veh.s);
          const pos = this._lngLatToLocalMeters(sample.lon, sample.lat);

          const lanes = veh.edge.lanes || 2;
          const laneOffsetM = (veh.laneIndex - (lanes - 1) / 2) * 3.0;
          const perpX = Math.cos(sample.headingRad);
          const perpZ = Math.sin(sample.headingRad);
          const wx = pos.x + perpX * laneOffsetM;
          const wz = pos.z + perpZ * laneOffsetM;

          if (veh.cls && veh.cls.isEmergency) {
            ambWorldX = wx;
            ambWorldZ = wz;
            ambHeadingRad = sample.headingRad;
            if (this.ambulanceGroup) {
              const s = pos.scaleRatio * visualScale;
              this.ambulanceGroup.visible = true;
              this.ambulanceGroup.position.set(wx, 0.25, wz);
              this.ambulanceGroup.rotation.set(0, -sample.headingRad, 0);
              this.ambulanceGroup.scale.set(s, s, s);
              ambPlaced = true;
            }
            continue;
          }

          const entry = { veh, sample, pos, wx, wz, perpX, perpZ };
          if (routeEdgeSet.has(veh.edge.id)) {
            priorityCivilians.push(entry);
          } else {
            backgroundCivilians.push(entry);
          }
        }

        const orderedCivilians = priorityCivilians.concat(backgroundCivilians);
        for (const entry of orderedCivilians) {
          if (totalCivilianAdded >= MAX_FLEET_INSTANCES) break;
          const { veh, sample, pos, perpX, perpZ } = entry;
          let { wx, wz } = entry;

          // Stage 7: Lateral curb parting (±1.8m) as ambulance approaches
          if (ambWorldX !== null) {
            const distToAmb = Math.hypot(wx - ambWorldX, wz - ambWorldZ);
            if (distToAmb < 65) {
              const waveIntensity = Math.max(0, 1 - distToAmb / 65);
              const sideMultiplier = (veh.laneIndex % 2 === 0) ? -1 : 1;
              const offsetM = (this._sirenPartingWaveActive ? this._partingWaveOffset : 1.4) * waveIntensity * sideMultiplier;
              wx += perpX * offsetM;
              wz += perpZ * offsetM;
            }
          }

          // Stage 7: Queue discharge visual pulse on Green Wave edges near stop line
          if (this._greenWaveActiveEdges.has(veh.edge.id)) {
            const distToStopLine = Math.max(0, veh.edge.length - veh.s);
            if (distToStopLine < 30 && veh.v > 1.0) {
              wx += -perpZ * 0.6;
              wz += perpX * 0.6;
            }
          }

          const type = (veh.cls && veh.cls.id) ? veh.cls.id : 'PASSENGER_CAR';
          pushCivilian(type, wx, wz, sample.headingRad, pos.scaleRatio, veh.id);
        }
      }

      // 2. Ambient mixed Bengaluru traffic along real OSM SimulationEdges (yields aside for ambulance)
      for (const v of this._ambientFleet) {
        if (totalCivilianAdded >= MAX_FLEET_INSTANCES) break;
        const sample = v.edge.sampleAt(v.s);
        const pos = this._lngLatToLocalMeters(sample.lon, sample.lat);
        const lanes = v.edge.lanes || 2;
        let laneOffsetM = (v.lane - (lanes - 1) / 2) * 3.2;
        const perpX = Math.cos(sample.headingRad);
        const perpZ = Math.sin(sample.headingRad);
        let wx = pos.x + perpX * laneOffsetM;
        let wz = pos.z + perpZ * laneOffsetM;

        // Stage 7: Siren lateral parting wave (±1.8m curb offset)
        if (ambWorldX !== null && this._sirenPartingWaveActive) {
          const distToAmb = Math.hypot(wx - ambWorldX, wz - ambWorldZ);
          if (distToAmb < 60) { // Within 60m of ambulance
            // Calculate lateral offset direction (perpendicular to road)
            const latOffsetX = -perpZ; // Left perpendicular
            const latOffsetZ = perpX;
            // Alternate left/right based on lane for parting wave effect
            const sideMultiplier = (v.lane % 2 === 0) ? -1 : 1;
            const waveIntensity = Math.max(0, 1 - distToAmb / 60); // Fade with distance
            const offset = this._partingWaveOffset * waveIntensity * sideMultiplier;
            wx += latOffsetX * offset;
            wz += latOffsetZ * offset;
          }
        } else if (ambWorldX !== null && Math.hypot(wx - ambWorldX, wz - ambWorldZ) < 45) {
          // Legacy parting wave (non-siren) - smaller shift
          const shift = (v.lane % 2 === 0 ? -3.5 : 3.5);
          wx += perpX * shift;
          wz += perpZ * shift;
        }

        // Stage 7: Queue discharge on Green Wave for ambient fleet too
        if (this._greenWaveActiveEdges.has(v.edge.id)) {
          const distToStopLine = Math.max(0, v.edge.length - v.s);
          if (distToStopLine < 30) {
            wx += perpX * Math.min(2.0, distToStopLine * 0.1);
            wz += perpZ * Math.min(2.0, distToStopLine * 0.1);
          }
        }

        pushCivilian(v.type, wx, wz, sample.headingRad, pos.scaleRatio, v.id);
      }

      // 3. Remaining budget from TrafficSwarmManager if available
      if (this.traffic && Array.isArray(this.traffic.vehicles) && this.projection) {
        for (const v of this.traffic.vehicles) {
          if (totalCivilianAdded >= MAX_FLEET_INSTANCES) break;
          if (!v || !v.position) continue;
          const geo = this.projection.cartesianToLatLonAlt(v.position.x, v.position.y || 0, v.position.z);
          const pos = this._lngLatToLocalMeters(geo.lon, geo.lat);
          const compassHeading = -(v.headingRad || 0);
          pushCivilian(v.type, pos.x, pos.z, compassHeading, pos.scaleRatio, v.id);
        }
      }

      // Fallback ambulance placement if sim hasn't spawned amb_1 or trip completed
      if (!ambPlaced && this.ambulanceGroup && this.ambulance && this.projection) {
        const ambPos = this.ambulance.getPosition();
        if (ambPos && typeof this.projection.cartesianToLatLonAlt === 'function') {
          const geo = this.projection.cartesianToLatLonAlt(ambPos.x, ambPos.y || 0, ambPos.z);
          const pos = this._lngLatToLocalMeters(geo.lon, geo.lat);
          const s = pos.scaleRatio * visualScale;
          const headingRad = this.ambulance.getHeadingRad ? this.ambulance.getHeadingRad() : 0;
          this.ambulanceGroup.visible = true;
          this.ambulanceGroup.position.set(pos.x, 0.25, pos.z);
          this.ambulanceGroup.rotation.set(0, -headingRad, 0);
          this.ambulanceGroup.scale.set(s, s, s);
        }
      }

      for (const [type, mesh] of Object.entries(this.instancedMeshes)) {
        mesh.count = counts[type];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }

    /**
     * Stage 7: Update siren parting wave activation state.
     * Activates when ambulance siren is ON and ambulance is moving.
     */
    _updateSirenPartingWave() {
      if (this.ambulance && typeof this.ambulance.isSirenActive === 'function') {
        this._sirenPartingWaveActive = this.ambulance.isSirenActive();
      } else {
        this._sirenPartingWaveActive = false;
      }
    }

    /**
     * Stage 7: Update set of edges with active Green Wave for queue discharge visualization.
     * Checks signal phases on route edges - if signal is GREEN or PREEMPT_GREEN, vehicles discharge.
     */
    _updateGreenWaveEdges() {
      this._greenWaveActiveEdges.clear();
      if (!this.sim || !this.signalManager || !this.sim.routingController) return;

      const routeEdges = this.sim.routingController.currentRouteEdges || [];
      for (const edgeId of routeEdges) {
        const edge = this.sim.network.getEdge(edgeId);
        if (!edge) continue;

        // Check signal at the downstream node of this edge
        const toNodeId = edge.toNodeId || edge.to_node;
        const sigByNode = (toNodeId && this.signalManager.getSignalByNode)
          ? this.signalManager.getSignalByNode(toNodeId)
          : null;
        if (sigByNode && (sigByNode.currentPhase === 'GREEN' || sigByNode.currentPhase === 'PREEMPT_GREEN')) {
          this._greenWaveActiveEdges.add(edgeId);
          continue;
        }
        const toNode = toNodeId ? this.sim.network.getNode(toNodeId) : null;
        if (toNode && toNode.signals && toNode.signals.length > 0) {
          for (const signalId of toNode.signals) {
            const signal = this.signalManager.getSignal(signalId);
            if (signal && (signal.currentPhase === 'GREEN' || signal.currentPhase === 'PREEMPT_GREEN')) {
              this._greenWaveActiveEdges.add(edgeId);
              break;
            }
          }
        }
      }
    }

    _hashId(id) {
      let h = 0;
      const str = String(id || '');
      for (let i = 0; i < str.length; i += 1) {
        h = (h * 31 + str.charCodeAt(i)) >>> 0;
      }
      return h;
    }

    update() {
      // Trigger MapLibre repaint at ~8 Hz when idle so Three.js vehicles & strobes
      // animate smoothly without starving tile decoding on software WebGL renderers.
      if (this._headless || !this.map || typeof this.map.triggerRepaint !== 'function') return;
      if (typeof this.map.isMoving === 'function' && this.map.isMoving()) return;
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - this._lastRepaintAt >= 125) {
        this._lastRepaintAt = now;
        this.map.triggerRepaint();
      }
    }

    getFleetState() {
      const counts = {};
      let total = 0;
      for (const [type, mesh] of Object.entries(this.instancedMeshes)) {
        counts[type] = mesh.count;
        total += mesh.count;
      }
      return {
        maxCapacity: MAX_FLEET_INSTANCES,
        activeCivilianCount: total,
        byArchetype: counts,
        ambulanceActive: Boolean(this.ambulanceGroup && this.ambulanceGroup.visible)
      };
    }

    isInitialized() {
      return !this._headless && this._layerAdded;
    }
  }

  if (typeof window !== 'undefined') {
    window.vehicleLayerInstance = new VehicleLayer();
  }

  return VehicleLayer;
}));
