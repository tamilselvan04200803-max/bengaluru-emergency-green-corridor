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
      this.initSimulation();

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
     */
    initSimulation(seed = 42, demandProfile = 'peak', durationSec = 600) {
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
