/**
 * js/app.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Application Bootstrap
 * MapLibre GL JS integration with Three.js CustomLayerInterface,
 * Camera Director presets, deterministic simulation engine, HUD telemetry.
 * Browser-global & CommonJS compatible (UMD).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Application = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class Application {
    constructor() {
      this.canvas = document.getElementById('webgl-canvas');
      this.fpsElement = document.getElementById('stat-fps');
      this.speedElement = document.getElementById('stat-speed');
      this.preemptElement = document.getElementById('stat-preemptions');

      this.clock = (typeof THREE !== 'undefined') ? new THREE.Clock() : null;
      this.frameCount = 0;
      this.lastFpsUpdate = 0;
      this.fps = 60.0;
      this.aiCorridorActive = true;

      // Deterministic simulation accumulator (0.1 s fixed timestep)
      this._simAccumulator = 0.0;
      this._simStepSec = 0.1;
      this._ambId = 'amb_1';
      this._ambOdometerM = 0.0;

      // Stage 6 MapLibre + Three.js CustomLayer + CameraDirector
      this.map = null;
      this.mapRenderer = null;
      this.vehicleLayer = null;
      this.cameraDirector = null;

      this.initSubsystems();
      this.initMapLibreIntegration();
      this.initDeckControls();
      this.initEvents();

      this.animate = this.animate.bind(this);
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(this.animate);
      }

      this.dismissLoadingScreen();
    }

    initSubsystems() {
      const geoOrigin = (typeof CONFIG !== 'undefined' && CONFIG.GEO) ? CONFIG.GEO.origin : {
        lat: 12.9715987,
        lon: 77.5945627,
        alt: 920.0
      };

      // 1. Coordinate Projection System
      this.projection = (typeof GeoProjection !== 'undefined') ? new GeoProjection(geoOrigin) : null;
      window.projectionInstance = this.projection;

      // 2. 15 Traffic Signals & ITMS Preemption Network (headless state authority)
      this.signals = (typeof SignalManager !== 'undefined' && this.projection)
        ? new SignalManager(null, this.projection)
        : null;
      window.signalManagerInstance = this.signals;
      this.signalManager = this.signals; // alias used by UIManager minimap

      // 3. Ambulance State Controller (mirrors SimulationEngine kinematics)
      this.ambulance = (typeof AmbulanceManager !== 'undefined' && this.projection)
        ? new AmbulanceManager(null, this.projection, this.signals)
        : null;
      window.ambulanceInstance = this.ambulance;

      // 4. Central-Corridor Mixed Civilian Traffic Swarm (renders alongside SimulationEngine fleet)
      this.traffic = (typeof TrafficSwarmManager !== 'undefined' && this.projection)
        ? new TrafficSwarmManager(null, this.projection, null, this.signals, this.ambulance)
        : null;
      if (this.traffic && typeof this.traffic.setVehicleCount === 'function') {
        this.traffic.setVehicleCount(80);
      }
      window.trafficInstance = this.traffic;

      // 4. Analytics Benchmark Engine
      this.benchmark = (typeof BenchmarkEngine !== 'undefined')
        ? new BenchmarkEngine({ isAiCorridorActive: this.aiCorridorActive })
        : null;
      window.benchmarkInstance = this.benchmark;

      // 5. HUD & Interactive UI Manager
      this.ui = (typeof UIManager !== 'undefined') ? new UIManager(this) : null;
      window.uiInstance = this.ui;

      // 6. Deterministic SimulationEngine + SmartRoutingController
      this.initSimulation({ prepopulateCorridor: true });

      // 7. Phase 5 interactive drawers
      if (this.ui && typeof this.ui.initPhase5Controls === 'function') {
        requestAnimationFrame(() => {
          this.ui.initPhase5Controls();
        });
      }
    }

    initMapLibreIntegration() {
      const networkData = (typeof NETWORK_DATA !== 'undefined') ? NETWORK_DATA : null;

      if (typeof window.mapRenderer !== 'undefined' && window.mapRenderer) {
        this.mapRenderer = window.mapRenderer;
      } else if (typeof MapRenderer !== 'undefined') {
        this.mapRenderer = new MapRenderer();
      }

      if (typeof window.vehicleLayerInstance !== 'undefined' && window.vehicleLayerInstance) {
        this.vehicleLayer = window.vehicleLayerInstance;
      } else if (typeof VehicleLayer !== 'undefined') {
        this.vehicleLayer = new VehicleLayer();
      }

      if (typeof window.cameraDirectorInstance !== 'undefined' && window.cameraDirectorInstance) {
        this.cameraDirector = window.cameraDirectorInstance;
      } else if (typeof CameraDirector !== 'undefined') {
        this.cameraDirector = new CameraDirector();
      }

      if (!this.mapRenderer) return;

      this.mapRenderer.configure({
        projection: this.projection,
        signalManager: this.signals,
        routingController: this.routingController,
        sim: this.sim,
        networkData
      });

      this.mapRenderer.initMap().then((map) => {
        if (!map) return;
        this.map = map;
        window.mapInstance = map;
        this.canvas = map.getCanvas();

        if (this.vehicleLayer) {
          this.vehicleLayer.configure({
            map,
            projection: this.projection,
            signalManager: this.signals,
            sim: this.sim,
            ambulance: this.ambulance,
            traffic: this.traffic
          });
          this.vehicleLayer.init();
        }

        if (this.cameraDirector) {
          this.cameraDirector.configure({
            map,
            projection: this.projection,
            sim: this.sim,
            ambulance: this.ambulance
          });
          this.cameraDirector.init();
        }
      });
    }

    /**
     * Constructs the deterministic SimulationEngine + SmartRoutingController
     * and dispatches the ambulance onto a router-computed route.
     * @param {Object} [options] - Configuration options
     * @param {number} [options.seed=42] - PRNG seed for deterministic simulation
     * @param {string} [options.demandProfile='peak'] - Traffic demand profile
     * @param {number} [options.durationSec=600] - Simulation duration
     * @param {boolean} [options.prepopulateCorridor=false] - Pre-populate ambulance's active route with civilian traffic queues (browser-only feature)
     */
    initSimulation(options = {}) {
      const seed = options.seed ?? 42;
      const demandProfile = options.demandProfile ?? 'peak';
      const durationSec = options.durationSec ?? 600;
      const prepopulateCorridor = options.prepopulateCorridor ?? false;
      const networkNs = (typeof SimulationNetwork !== 'undefined') ? SimulationNetwork : null;
      const simNs = (typeof SimulationEngine !== 'undefined') ? SimulationEngine : null;
      const SimulationNetworkCtor = (networkNs && networkNs.SimulationNetwork) ? networkNs.SimulationNetwork : networkNs;
      const SimulationEngineCtor = (simNs && simNs.SimulationEngine) ? simNs.SimulationEngine : simNs;

      if (typeof SimulationNetworkCtor !== 'function' || typeof SimulationEngineCtor !== 'function') {
        console.warn('Application: simulation modules not loaded; running offline');
        return;
      }
      if (typeof NETWORK_DATA === 'undefined') {
        console.warn('Application: NETWORK_DATA not available');
        return;
      }

      try {
        const net = new SimulationNetworkCtor(NETWORK_DATA);
        this.simNetwork = net;

        this.sim = new SimulationEngineCtor(net, this.signals, seed, this.projection);
        this.sim.setDemandProfile(demandProfile);
        this.simSeed = seed;
        this.simDuration = durationSec;
        this._ambOdometerM = 0.0;
        this._simAccumulator = 0.0;

        // Warm up 35 seconds of initial network traffic BEFORE dispatching ambulance
        // so streets & junctions are populated when the ambulance starts from Majestic.
        for (let i = 0; i < 350; i += 1) {
          this.sim.step(this._simStepSec);
          if (this.signals) this.signals.update(this._simStepSec);
        }

        if (typeof RoutingEngine !== 'undefined') {
          const graph = new RoutingEngine.RoadGraph(NETWORK_DATA, seed);
          const planner = new RoutingEngine.RoutePlanner(graph, this.signals);
          const controller = new RoutingEngine.SmartRoutingController(planner, graph, this.signals, {});
          this.sim.setRoutingController(controller);
          this.sim.setCongestionCallback(map => controller.setLiveTravelTimes(map));
          this.routingController = controller;
          this.simGraph = graph;

          const amb = this.ambulance;
          const destinationHospital = amb ? amb.destinationHospital : 'hosp_victoria_01';
          const destNode = this._hospitalIngressNode(destinationHospital);
          const startNode = this._nearestNetworkNode(amb ? amb.position : null) || 'node_majestic';
          if (destNode && startNode) {
            controller.setDestination(destNode, destinationHospital);
            const route = planner.findRouteEnhanced(startNode, destNode, { isPreempted: true });
            if (route && route.path.length > 0) {
              const ambId = amb && amb.vehicleId ? amb.vehicleId : 'amb_1';
              this._ambId = ambId;
              this.sim.addAmbulance(ambId, route.path, destinationHospital);
              if (amb) {
                amb.attachSimulation(this.sim, ambId);
                amb.currentRoute = route.path;
              }
              // Step 26s so amb_1 is actively cruising down Kempegowda Rd with
              // live Tier-2 signal preemption & Green Wave beam active right on load.
              for (let j = 0; j < 260; j += 1) {
                this.sim.step(this._simStepSec);
                if (this.signals) this.signals.update(this._simStepSec);
                const ambVeh = this.sim.vehicles.get(this._ambId);
                if (ambVeh) this._ambOdometerM += ambVeh.v * this._simStepSec;
              }
              console.log(`[Application] Ambulance dispatched: ${route.path.length} edges, `
                + `${route.distance.toFixed(0)} m, ETA ${route.totalTime.toFixed(1)} s`);

              // Stage 7: Pre-populate corridor with civilian traffic queues on ambulance's active route
              if (prepopulateCorridor && this.sim) {
                this._prepopulateCorridorTraffic(route.path);
              }
            } else {
              console.warn(`Application: no route from ${startNode} to ${destNode}`);
            }
          }
        }

        // Re-bind Stage 6 modules if simulation was reset
        if (this.mapRenderer) {
          this.mapRenderer.configure({
            sim: this.sim,
            routingController: this.routingController
          });
        }
        if (this.vehicleLayer) {
          this.vehicleLayer.configure({ sim: this.sim });
        }
        if (this.cameraDirector) {
          this.cameraDirector.configure({ sim: this.sim });
        }

        window.simInstance = this.sim;
        window.routingControllerInstance = this.routingController || null;
      } catch (e) {
        console.error('Application: simulation initialization failed', e);
        this.sim = null;
      }
    }

    _hospitalIngressNode(hospitalId) {
      if (!NETWORK_DATA || !NETWORK_DATA.hospitals) return null;
      for (const h of NETWORK_DATA.hospitals) {
        if (h.id === hospitalId) return h.ingress_node;
      }
      return null;
    }

    _nearestNetworkNode(worldPos) {
      if (!NETWORK_DATA || !NETWORK_DATA.nodes || !worldPos) return null;
      let best = null;
      let bestDist = Infinity;
      for (const n of NETWORK_DATA.nodes) {
        if (this.projection) {
          const w = this.projection.latLonAltToCartesian(n.lat, n.lon, n.alt);
          const d = Math.hypot(w.x - worldPos.x, w.z - worldPos.z);
          if (d < bestDist) { bestDist = d; best = n.id; }
        }
      }
      return best;
    }

    /**
     * Stage 7: Pre-populate ambulance's active corridor route with civilian traffic queues.
     * Seeds vehicles on route edges ahead of ambulance position with deterministic spacing.
     * Browser-only feature gated by prepopulateCorridor option.
     * @param {Array<string>} routeEdgeIds - Ordered list of edge IDs on ambulance route
     */
    _prepopulateCorridorTraffic(routeEdgeIds) {
      if (!this.sim || !this.sim.network || !routeEdgeIds || routeEdgeIds.length === 0) return;

      const simNs = (typeof SimulationEngine !== 'undefined') ? SimulationEngine : null;
      const SimVehicleCtor = (simNs && simNs.SimVehicle) ? simNs.SimVehicle : this.sim.constructor.SimVehicle;
      const vehClasses = (simNs && simNs.VEHICLE_CLASSES) ? simNs.VEHICLE_CLASSES : (this.sim.vehicleClasses || {});
      if (typeof SimVehicleCtor !== 'function') {
        console.warn('[Application] SimVehicle constructor unavailable for corridor prepopulation');
        return;
      }

      const random = this.sim.random;
      const vehicleTypes = ['BMTC_BUS', 'AUTO_RICKSHAW', 'PASSENGER_CAR', 'TWO_WHEELER', 'AUTO_RICKSHAW', 'PASSENGER_CAR'];
      const ambVeh = this.sim.vehicles.get(this._ambId);
      const ambEdgeId = (ambVeh && ambVeh.edge) ? ambVeh.edge.id : routeEdgeIds[0];
      const ambS = ambVeh ? ambVeh.s : 0;

      let startIdx = routeEdgeIds.indexOf(ambEdgeId);
      if (startIdx === -1) startIdx = 0;

      // Focus on ambulance's current edge and next 3 route edges ahead so 12-20+ vehicles
      // are immediately visible directly ahead of the ambulance.
      const endIdx = Math.min(routeEdgeIds.length, startIdx + 4);
      let vehiclesPlaced = 0;
      const MAX_SPAWN_BATCH = 24;

      for (let i = startIdx; i < endIdx && vehiclesPlaced < MAX_SPAWN_BATCH; i += 1) {
        const edgeId = routeEdgeIds[i];
        const edge = this.sim.network.getEdge(edgeId);
        if (!edge || edge.length < 25) continue;

        const lanes = edge.lanes || 2;
        const isAmbulanceEdge = (edgeId === ambEdgeId);
        const startS = isAmbulanceEdge ? Math.max(12, ambS + 18) : 10;
        const maxS = Math.max(startS, (edge.stopLineOffsetM || (edge.length - 8)));
        if (startS >= maxS - 6) continue;

        for (let lane = 0; lane < lanes && vehiclesPlaced < MAX_SPAWN_BATCH; lane += 1) {
          const queueKey = `${edgeId}|${lane}`;
          const existingQueue = this.sim.laneQueues.get(queueKey);
          const existingVehicles = existingQueue ? existingQueue.vehicles : [];

          let candidateS = startS + (lane * 7);
          while (candidateS < maxS - 4 && vehiclesPlaced < MAX_SPAWN_BATCH) {
            const tooClose = existingVehicles.some(ev => Math.abs(ev.s - candidateS) < 11);
            if (!tooClose) {
              const typeIdx = (typeof random.nextInt === 'function')
                ? random.nextInt(vehicleTypes.length)
                : (vehiclesPlaced % vehicleTypes.length);
              const vehType = vehicleTypes[typeIdx] || 'PASSENGER_CAR';
              const vehCls = vehClasses[vehType] || vehClasses.PASSENGER_CAR;
              if (!vehCls) break;
              const randFrac = (typeof random.nextFloat === 'function') ? random.nextFloat() : 0.5;
              const speedMps = 2.0 + randFrac * 4.0; // slow queued traffic 2-6 m/s

              const vehId = `corr_civ_${edgeId}_${lane}_${vehiclesPlaced}_${Math.floor(this.sim.time * 10)}`;
              const veh = new SimVehicleCtor(vehId, vehCls, edge, lane, candidateS, random);
              veh.v = speedMps;
              veh.targetV = Math.min(vehCls.idm ? vehCls.idm.v0 : 12, 11);

              this.sim.vehicles.set(vehId, veh);
              if (existingQueue) existingQueue.enqueue(veh);
              vehiclesPlaced += 1;
            }
            const gapFrac = (typeof random.nextFloat === 'function') ? random.nextFloat() : 0.5;
            candidateS += 14 + gapFrac * 8;
          }
        }
      }

      console.log(`[Application] Pre-populated corridor with ${vehiclesPlaced} civilian vehicles ahead on route`);
    }

    /**
     * Stage 7: Collect and update AI Priority & Clearance Banner data.
     * Called each frame from animate() when AI corridor is active.
     */
    _updateAIPriorityBannerData() {
      const routingCtrl = this.routingController || (this.sim && this.sim.routingController);
      const sigMgr = this.signals || this.signalManager;
      if (!this.aiCorridorActive || !this.sim || !routingCtrl || !sigMgr) {
        if (this.ui && typeof this.ui.updateAIPriorityBanner === 'function') {
          this.ui.updateAIPriorityBanner({ isActive: false });
        }
        return;
      }

      const routeEdges = routingCtrl.currentRouteEdges || [];
      if (routeEdges.length === 0) return;

      const ambVeh = this.sim.vehicles.get(this._ambId);
      if (!ambVeh || !ambVeh.edge) return;

      const currentEdgeId = ambVeh.edge.id;
      let currentIndex = routeEdges.indexOf(currentEdgeId);
      if (currentIndex === -1) currentIndex = 0;

      const speedMps = Math.max(5, ambVeh.v || 14);
      let accumulatedDistance = 0;
      let targetSignal = null;
      let targetSignalObj = null;
      let targetNodeId = null;
      let targetDistance = 0;
      let targetETA = 0;

      // Helper to resolve signal at edge's downstream node
      const findSignalAtEdgeEnd = (edge) => {
        if (!edge) return null;
        const toNodeId = edge.toNodeId || edge.to_node;
        if (!toNodeId) return null;
        let sig = sigMgr.getSignalByNode ? sigMgr.getSignalByNode(toNodeId) : null;
        if (!sig) {
          const toNode = this.sim.network.getNode(toNodeId);
          if (toNode && Array.isArray(toNode.signals) && toNode.signals.length > 0) {
            sig = sigMgr.getSignal(toNode.signals[0]);
          }
        }
        return sig ? { sig, nodeId: toNodeId } : null;
      };

      // Check current edge first
      const currentEdge = this.sim.network.getEdge(currentEdgeId);
      if (currentEdge) {
        accumulatedDistance = Math.max(0, currentEdge.length - ambVeh.s);
        const found = findSignalAtEdgeEnd(currentEdge);
        if (found) {
          targetSignal = found.sig.id;
          targetSignalObj = found.sig;
          targetNodeId = found.nodeId;
          targetDistance = accumulatedDistance;
          targetETA = targetDistance / speedMps;
        }
      }

      // Walk subsequent route edges until the next signalized junction
      if (!targetSignal) {
        for (let i = currentIndex + 1; i < routeEdges.length; i += 1) {
          const edge = this.sim.network.getEdge(routeEdges[i]);
          if (!edge) continue;
          accumulatedDistance += (edge.length || 0);
          const found = findSignalAtEdgeEnd(edge);
          if (found) {
            targetSignal = found.sig.id;
            targetSignalObj = found.sig;
            targetNodeId = found.nodeId;
            targetDistance = accumulatedDistance;
            targetETA = targetDistance / speedMps;
            break;
          }
        }
      }

      // Compute civilian queue length ahead of ambulance along route up to target signal + target incoming edges
      let queueLength = 0;
      const aheadEdgeSet = new Set();
      aheadEdgeSet.add(currentEdgeId);
      for (let i = currentIndex; i < routeEdges.length; i += 1) {
        const eId = routeEdges[i];
        aheadEdgeSet.add(eId);
        const edge = this.sim.network.getEdge(eId);
        if (!edge) break;
        const toNodeId = edge.toNodeId || edge.to_node;
        if (targetNodeId && toNodeId === targetNodeId) break;
      }
      if (targetNodeId && typeof this.sim.network.getIncoming === 'function') {
        const incEdges = this.sim.network.getIncoming(targetNodeId) || [];
        for (const incEdgeId of incEdges) aheadEdgeSet.add(incEdgeId);
      }
      if (this.sim.vehicles) {
        for (const v of this.sim.vehicles.values()) {
          if (!v || !v.edge || v.id === this._ambId || (v.cls && v.cls.isEmergency)) continue;
          if (!aheadEdgeSet.has(v.edge.id)) continue;
          if (v.edge.id === currentEdgeId && v.s <= ambVeh.s) continue;
          queueLength += 1;
        }
      }

      const simMetrics = this.sim.getMetrics ? this.sim.getMetrics() : {};
      const clearRate = simMetrics.routeClearRate || 0;

      let subtitle = 'Tier-2 Preemption Engaged — Signal Clearance In Progress';
      if (targetSignalObj) {
        const rawPhase = targetSignalObj.currentPhase || 'RED';
        const phaseLabel = rawPhase === 'PREEMPT_GREEN' ? 'GREEN WAVE' : rawPhase.replace('_', '-');
        const junctionName = targetSignalObj.name || targetSignal;
        if (rawPhase === 'PREEMPT_GREEN') {
          subtitle = `${junctionName} [${phaseLabel}] — Corridor Cleared`;
        } else if (rawPhase === 'GREEN' && targetSignalObj.isPreempted) {
          subtitle = `${junctionName} [GREEN WAVE] — Priority Granted`;
        } else if (targetSignalObj.isPreempted) {
          subtitle = `${junctionName} [${phaseLabel}] — Preemption Clearing`;
        } else {
          subtitle = `${junctionName} [${phaseLabel}] — Tier-2 Horizon Armed`;
        }
      }

      if (this.ui && typeof this.ui.updateAIPriorityBanner === 'function') {
        this.ui.updateAIPriorityBanner({
          isActive: true,
          nextSignalDistance: targetDistance,
          nextSignalEta: targetETA,
          queueLength: queueLength,
          clearRate: clearRate,
          subtitle: subtitle
        });
      }

      if (this.ui && typeof this.ui.setSpawnTrafficButtonVisible === 'function') {
        this.ui.setSpawnTrafficButtonVisible(true);
      }
    }

    toggleAiCorridor() {
      this.aiCorridorActive = !this.aiCorridorActive;

      if (this.benchmark && typeof this.benchmark.setAiCorridorActive === 'function') {
        this.benchmark.setAiCorridorActive(this.aiCorridorActive);
      }

      if (this.ui && typeof this.ui.updateCorridorToggleUI === 'function') {
        this.ui.updateCorridorToggleUI(this.aiCorridorActive);
      }

      const btnDeckCorridor = document.getElementById('btn-deck-corridor-toggle');
      if (btnDeckCorridor) {
        btnDeckCorridor.innerText = this.aiCorridorActive ? 'Corridor: ON [G]' : 'Corridor: OFF [G]';
        btnDeckCorridor.classList.toggle('highlight-green', this.aiCorridorActive);
      }

      if (!this.aiCorridorActive && this.signals) {
        if (this.signals.preemptedSignals) {
          this.signals.preemptedSignals.clear();
        }
        if (typeof this.signals.getAllSignals === 'function') {
          this.signals.getAllSignals().forEach(sig => {
            if (sig.isPreempted) {
              sig.isPreempted = false;
              sig.isPostPassage = true;
              sig.postPassageAmberTimer = 2.0;
              sig.setPhase('AMBER');
            }
          });
        }
      }

      if (this.ambulance) {
        this.ambulance.priorityActive = this.aiCorridorActive;
        this.ambulance.autonomousCruisingSpeedKmh = this.aiCorridorActive ? 50.0 : 16.0;
      }

      // Stage 7: Hide banner and spawn button when corridor is disabled
      if (!this.aiCorridorActive && this.ui) {
        if (typeof this.ui.updateAIPriorityBanner === 'function') {
          this.ui.updateAIPriorityBanner({ isActive: false });
        }
        if (typeof this.ui.setSpawnTrafficButtonVisible === 'function') {
          this.ui.setSpawnTrafficButtonVisible(false);
        }
      }

      return this.aiCorridorActive;
    }

    initDeckControls() {
      if (this.ui && typeof this.ui.initCameraPresetButtons === 'function') {
        this.ui.initCameraPresetButtons();
      }

      const btnSiren = document.getElementById('btn-siren-toggle');
      if (btnSiren) {
        if (this.ambulance && typeof this.ambulance.isSirenActive === 'function' && this.ambulance.isSirenActive()) {
          btnSiren.classList.add('active');
        }
        btnSiren.addEventListener('click', () => {
          if (this.ambulance && typeof this.ambulance.toggleSiren === 'function') {
            const active = this.ambulance.toggleSiren();
            btnSiren.classList.toggle('active', active);
          }
        });
      }

      const btnCorridor = document.getElementById('btn-deck-corridor-toggle');
      if (btnCorridor) {
        btnCorridor.addEventListener('click', () => {
          if (this.ui && typeof this.ui.toggleCorridorMode === 'function') {
            this.ui.toggleCorridorMode();
          } else {
            this.toggleAiCorridor();
          }
        });
      }

      const btnExport = document.getElementById('btn-export-benchmark');
      if (btnExport) {
        btnExport.addEventListener('click', () => {
          if (this.ui && typeof this.ui.exportBenchmarkJson === 'function') {
            this.ui.exportBenchmarkJson();
          }
        });
      }

      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
        const key = e.key.toLowerCase();
        if (key === 's' && btnSiren) btnSiren.click();
        else if (key === 'g') {
          if (this.ui && typeof this.ui.toggleCorridorMode === 'function') {
            this.ui.toggleCorridorMode();
          } else {
            this.toggleAiCorridor();
          }
        }
      });
    }

    initEvents() {
      if (typeof window === 'undefined') return;
      window.addEventListener('resize', () => {
        if (this.map && typeof this.map.resize === 'function') {
          this.map.resize();
        }
      });
    }

    dismissLoadingScreen() {
      if (typeof document === 'undefined') return;
      const loader = document.getElementById('loading-screen');
      if (loader) {
        setTimeout(() => {
          loader.style.opacity = '0';
          setTimeout(() => {
            loader.style.display = 'none';
          }, 500);
        }, 350);
      }
    }

    animate() {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(this.animate);
      }

      const dt = this.clock ? Math.min(this.clock.getDelta(), 0.1) : 0.016;
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

      this.frameCount++;
      if (now - this.lastFpsUpdate >= 500) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
        if (this.fpsElement) {
          this.fpsElement.innerText = `${this.fps} FPS`;
        }
        if (this.preemptElement && this.signals) {
          const allSigs = typeof this.signals.getAllSignals === 'function' ? this.signals.getAllSignals() : [];
          const activePreempts = allSigs.filter(s => s.isPreempted || s.currentPhase === 'PREEMPT_GREEN').length;
          this.preemptElement.innerText = `${Math.max(this.signals.getPreemptedCount(), activePreempts)}`;
        }
        this.frameCount = 0;
        this.lastFpsUpdate = now;
      }

      if (this.signals) {
        this.signals.update(dt);
      }

      if (this.sim) {
        this._simAccumulator += dt;
        let steps = 0;
        while (this._simAccumulator >= this._simStepSec && steps < 20) {
          this.sim.step(this._simStepSec);
          const ambVeh = this.sim.vehicles.get(this._ambId);
          if (ambVeh) {
            this._ambOdometerM += ambVeh.v * this._simStepSec;
          }
          this._simAccumulator -= this._simStepSec;
          steps += 1;
        }
        if (steps >= 20) this._simAccumulator = 0.0;
      }

      if (this.ambulance) {
        this.ambulance.update(dt);
        if (this.speedElement && typeof this.ambulance.getSpeedKmh === 'function') {
          this.speedElement.innerText = `${this.ambulance.getSpeedKmh().toFixed(1)} km/h`;
        }
      }

      if (this.traffic && typeof this.traffic.update === 'function') {
        const coneOrAmb = this.aiCorridorActive ? this.ambulance : null;
        this.traffic.update(dt, coneOrAmb, this.signals);
      }

      if (this.mapRenderer && typeof this.mapRenderer.syncWithThree === 'function') {
        this.mapRenderer.syncWithThree(dt);
      }

      if (this.vehicleLayer && typeof this.vehicleLayer.update === 'function') {
        this.vehicleLayer.update(dt);
      }

      if (this.cameraDirector && typeof this.cameraDirector.update === 'function') {
        this.cameraDirector.update(dt);
      }

      if (this.benchmark) {
        this.benchmark.update(dt, this.ambulance, this.sim);
      }

      // Stage 7: Update AI Priority & Clearance Banner with live data
      if (this.ui && typeof this.ui.updateAIPriorityBanner === 'function') {
        this._updateAIPriorityBannerData();
      }

      if (this.ui) {
        this.ui.update(dt);
      }
    }
  }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      window.appInstance = new Application();
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        window.appInstance = new Application();
      });
    }
  }

  return Application;
}));
