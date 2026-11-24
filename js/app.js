/**
 * js/app.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Application Bootstrap
 * Three.js WebGL Engine, Scene Graph Initialization, 60 FPS Simulation Loop,
 * Dynamic HUD Telemetry, Command Deck Controls & Responsive Event Handling.
 * Browser-global & CommonJS compatible.
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
      this.savingsElement = document.getElementById('stat-savings');

      this.clock = (typeof THREE !== 'undefined') ? new THREE.Clock() : null;
      this.frameCount = 0;
      this.lastFpsUpdate = 0;
      this.fps = 60.0;
      this.activeCameraMode = 'orbit';
      this.aiCorridorActive = true;

      // The deterministic simulation runs on a fixed 0.1 s timestep so the
      // browser world is bit-identical to the Node test runs. Frame deltas
      // arrive at ~60 Hz, so they are accumulated and spent in 0.1 s chunks.
      this._simAccumulator = 0.0;
      this._simStepSec = 0.1;

      this.initThree();
      this.initSubsystems();
      this.initDeckControls();
      this.initEvents();

      // Begin continuous 60 FPS animation loop
      this.animate = this.animate.bind(this);
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(this.animate);
      }

      // Hide loading splash screen
      this.dismissLoadingScreen();
    }

    /**
     * Initializes Three.js WebGL Scene, Camera, Renderer, and Controls.
     */
    initThree() {
      if (typeof THREE === 'undefined') {
        console.warn('Application: THREE.js library not detected. Running headless.');
        return;
      }

      const cfg = (typeof CONFIG !== 'undefined' && CONFIG.GRAPHICS) ? CONFIG.GRAPHICS : {
        antialias: true,
        shadows: true,
        shadowMapSize: 2048,
        maxPixelRatio: 2.0,
        clearColor: 0x070b14,
        toneMappingExposure: 1.15
      };

      const camCfg = (typeof CONFIG !== 'undefined' && CONFIG.CAMERA) ? CONFIG.CAMERA : {
        fov: 60,
        near: 0.5,
        far: 10000,
        initialPosition: { x: 0, y: 380, z: 460 },
        initialTarget: { x: 0, y: 0, z: 0 }
      };

      // 1. Scene
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(cfg.clearColor);
      this.scene.fog = new THREE.FogExp2(cfg.clearColor, 0.00030);

      // 2. Camera
      const aspect = (typeof window !== 'undefined' && window.innerWidth) ? (window.innerWidth / window.innerHeight) : (16 / 9);
      this.camera = new THREE.PerspectiveCamera(camCfg.fov, aspect, camCfg.near, camCfg.far);
      this.camera.position.set(camCfg.initialPosition.x, camCfg.initialPosition.y, camCfg.initialPosition.z);
      this.camera.lookAt(camCfg.initialTarget.x, camCfg.initialTarget.y, camCfg.initialTarget.z);

      // 3. WebGL Renderer
      if (this.canvas) {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          antialias: cfg.antialias,
          powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = cfg.toneMappingExposure;

        if (cfg.shadows) {
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }
      }

      // 4. Orbit Controls (Default view)
      if (typeof THREE.OrbitControls !== 'undefined' && this.renderer) {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent dipping beneath ground
        this.controls.minDistance = 5.0;
        this.controls.maxDistance = 4500.0;
      }
    }

    /**
     * Initializes geospatial projection, environment, atmosphere, and traffic signal subsystems.
     */
    initSubsystems() {
      // 1. Coordinate Projection System
      const geoOrigin = (typeof CONFIG !== 'undefined' && CONFIG.GEO) ? CONFIG.GEO.origin : {
        lat: 12.9715987,
        lon: 77.5945627,
        alt: 920.0
      };

      if (typeof GeoProjection !== 'undefined') {
        this.projection = new GeoProjection(geoOrigin);
      } else {
        this.projection = null;
      }
      window.projectionInstance = this.projection;

      // 2. Procedural 3D Environment (Roads, Curbs, Sidewalks, Buildings)
      if (typeof EnvironmentManager !== 'undefined' && this.scene && this.projection) {
        this.environment = new EnvironmentManager(this.scene, this.projection);
      } else {
        this.environment = null;
      }
      window.environmentInstance = this.environment;

      // 3. 15 3D Traffic Signal Gantries & ITMS Preemption Network
      if (typeof SignalManager !== 'undefined' && this.scene && this.projection) {
        this.signals = new SignalManager(this.scene, this.projection);
      } else {
        this.signals = null;
      }
      window.signalManagerInstance = this.signals;

      // 4. Dynamic Atmosphere, Day/Night Lighting & Rain Weather Controller
      if (typeof AtmosphereController !== 'undefined' && this.scene) {
        this.atmosphere = new AtmosphereController(this.scene, this.camera, this.renderer);
        if (this.environment) {
          this.atmosphere.setEnvironmentManager(this.environment);
        }
      } else {
        this.atmosphere = null;
      }
      window.atmosphereInstance = this.atmosphere;

      // Milestone 2: Dual-Mode Ambulance & Multi-Mode Camera Controller
      if (typeof AmbulanceManager !== 'undefined' && this.scene && this.projection) {
        this.ambulance = new AmbulanceManager(this.scene, this.projection, this.signals);
      } else {
        this.ambulance = null;
      }
      window.ambulanceInstance = this.ambulance;

      if (typeof CameraController !== 'undefined' && this.camera) {
        this.cameraController = new CameraController(
          this.camera,
          this.ambulance,
          this.canvas,
          this.controls
        );
        this.cameraController.setMode(this.activeCameraMode || 'orbit');
      } else {
        this.cameraController = null;
      }
      window.cameraControllerInstance = this.cameraController;

      if (typeof TrafficSwarmManager !== 'undefined' && this.scene) {
        this.traffic = new TrafficSwarmManager(
          this.scene,
          this.projection,
          this.environment,
          this.signals,
          this.ambulance
        );
      } else {
        this.traffic = null;
      }
      window.trafficInstance = this.traffic;
      if (typeof BenchmarkEngine !== 'undefined') {
        this.benchmark = new BenchmarkEngine({ isAiCorridorActive: this.aiCorridorActive });
      } else {
        this.benchmark = null;
      }
      window.benchmarkInstance = this.benchmark;

      if (typeof UIManager !== 'undefined') {
        this.ui = new UIManager(this);
      } else {
        this.ui = null;
      }
      window.uiInstance = this.ui;

      // Stage 4: drive the deterministic simulation engine from the browser
      // loop so the live app uses the same authoritative router, signal
      // machine and bay state machine as the Node test suites.
      this.initSimulation();

      // Phase 5: Initialize interactive control panels after UI and sim are ready
      if (this.ui && typeof this.ui.initPhase5Controls === 'function') {
        // Defer to next frame to ensure DOM is fully ready
        requestAnimationFrame(() => {
          this.ui.initPhase5Controls();
        });
      }
    }

    /**
     * Constructs the deterministic SimulationEngine + SmartRoutingController
     * and dispatches the ambulance onto a router-computed route. The engine
     * is the single authority over ambulance kinematics; the AmbulanceManager
     * mirrors its state onto the Three.js mesh each frame.
     * @param {number} [seed=42] - Random seed for deterministic simulation
     * @param {string} [demandProfile='peak'] - 'peak' or 'off_peak'
     * @param {number} [durationSec=600] - Simulation duration
     */
    initSimulation(seed = 42, demandProfile = 'peak', durationSec = 600) {
      // network.js / simulation.js publish a namespace object on window
      // ({SimulationNetwork, SimulationEdge, ...}) rather than the bare class,
      // so resolve the constructors off the namespace when present.
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

        if (typeof RoutingEngine !== 'undefined') {
          const graph = new RoutingEngine.RoadGraph(NETWORK_DATA, seed);
          const planner = new RoutingEngine.RoutePlanner(graph, this.signals);
          const controller = new RoutingEngine.SmartRoutingController(planner, graph, this.signals, {});
          this.sim.setRoutingController(controller);
          this.sim.setCongestionCallback(map => controller.setLiveTravelTimes(map));
          this.routingController = controller;
          this.simGraph = graph;

          // Plan the ambulance's route with the authoritative router and
          // dispatch it on that exact edge list. The destination is the
          // hospital the ambulance is configured for.
          const amb = this.ambulance;
          const destinationHospital = amb ? amb.destinationHospital : 'hosp_victoria_01';
          const destNode = this._hospitalIngressNode(destinationHospital);
          const startNode = this._nearestNetworkNode(amb ? amb.position : null);
          if (destNode && startNode) {
            const route = planner.findRouteEnhanced(startNode, destNode, { isPreempted: true });
            if (route && route.path.length > 0) {
              const ambId = amb && amb.vehicleId ? amb.vehicleId : 'amb_1';
              this.sim.addAmbulance(ambId, route.path, destinationHospital);
              if (amb) amb.attachSimulation(this.sim, ambId);
              console.log(`[Application] Ambulance dispatched: ${route.path.length} edges, `
                + `${route.distance.toFixed(0)} m, ETA ${route.totalTime.toFixed(1)} s`);
            } else {
              console.warn(`Application: no route from ${startNode} to ${destNode}`);
            }
          }
        }

        window.simInstance = this.sim;
        window.routingControllerInstance = this.routingController || null;
      } catch (e) {
        console.error('Application: simulation initialization failed', e);
        this.sim = null;
      }
    }

    /**
     * Resolve a hospital id to its ingress node id from the network data.
     */
    _hospitalIngressNode(hospitalId) {
      if (!NETWORK_DATA || !NETWORK_DATA.hospitals) return null;
      for (const h of NETWORK_DATA.hospitals) {
        if (h.id === hospitalId) return h.ingress_node;
      }
      return null;
    }

    /**
     * Find the network node nearest the ambulance's current world position.
     */
    _nearestNetworkNode(worldPos) {
      if (!NETWORK_DATA || !NETWORK_DATA.nodes) return null;
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
     * Toggles AI Green Corridor active state (ON vs. Baseline OFF).
     * When toggled OFF: signals do NOT preempt, civilian vehicles do NOT yield (baseline demonstration).
     * When toggled ON: signals preempt and civilian vehicles yield.
     * @returns {boolean} New AI Corridor active state
     */
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

      // If toggled OFF, restore any preempted signals to regular cycle
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

      // Regulate autonomous ambulance cruising speed
      if (this.ambulance) {
        this.ambulance.priorityActive = this.aiCorridorActive;
        this.ambulance.autonomousCruisingSpeedKmh = this.aiCorridorActive ? 50.0 : 16.0;
      }

      return this.aiCorridorActive;
    }

    /**
     * Hooks up the interactive Command Deck buttons and Keyboard shortcuts.
     */
    initDeckControls() {
      // Camera Mode Buttons
      const camBtns = {
        chase: document.getElementById('btn-cam-chase'),
        cockpit: document.getElementById('btn-cam-cockpit'),
        aerial: document.getElementById('btn-cam-aerial'),
        orbit: document.getElementById('btn-cam-orbit')
      };

      const setCameraMode = (mode) => {
        this.activeCameraMode = mode;
        Object.values(camBtns).forEach(b => b && b.classList.remove('active'));
        if (camBtns[mode]) camBtns[mode].classList.add('active');

        if (mode === 'orbit') {
          if (this.controls) this.controls.enabled = true;
        } else {
          if (this.controls) this.controls.enabled = false;
        }

        if (this.cameraController && typeof this.cameraController.setMode === 'function') {
          this.cameraController.setMode(mode);
        }

        // Hide ambulance mesh in cockpit mode, show in all other modes
        if (this.ambulance && typeof this.ambulance.setMeshVisibility === 'function') {
          this.ambulance.setMeshVisibility(mode !== 'cockpit');
        }
      };

      if (camBtns.chase) camBtns.chase.addEventListener('click', () => setCameraMode('chase'));
      if (camBtns.cockpit) camBtns.cockpit.addEventListener('click', () => setCameraMode('cockpit'));
      if (camBtns.aerial) camBtns.aerial.addEventListener('click', () => setCameraMode('aerial'));
      if (camBtns.orbit) camBtns.orbit.addEventListener('click', () => setCameraMode('orbit'));

      // Mission Controls
      const btnMode = document.getElementById('btn-mode-toggle');
      if (btnMode) {
        btnMode.addEventListener('click', () => {
          if (this.ambulance && typeof this.ambulance.toggleMode === 'function') {
            const isManual = this.ambulance.toggleMode();
            btnMode.innerText = isManual ? 'Autonomous [M]' : 'Manual Drive [M]';
            btnMode.classList.toggle('active', isManual);
          }
        });
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

      const btnRain = document.getElementById('btn-rain-toggle');
      if (btnRain) {
        btnRain.addEventListener('click', () => {
          if (this.atmosphere) {
            const w = this.atmosphere.toggleWeather();
            btnRain.innerText = (w === 'rain') ? 'Weather: Rain [R]' : 'Weather: Clear [R]';
            btnRain.classList.toggle('active', w === 'rain');
          }
        });
      }

      const btnDay = document.getElementById('btn-day-toggle');
      if (btnDay) {
        btnDay.addEventListener('click', () => {
          if (this.atmosphere) {
            const preset = this.atmosphere.cycleTimeOfDay();
            const label = preset.charAt(0).toUpperCase() + preset.slice(1);
            btnDay.innerText = `Time: ${label} [N]`;
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
          } else if (this.benchmark && typeof this.benchmark.exportBenchmarkData === 'function') {
            console.log('Benchmark Telemetry Export:', this.benchmark.exportBenchmarkData());
          }
        });
      }

      // Keyboard Shortcuts
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        const key = e.key.toLowerCase();

        if (key === '1') setCameraMode('chase');
        else if (key === '2') setCameraMode('cockpit');
        else if (key === '3') setCameraMode('aerial');
        else if (key === '4') setCameraMode('orbit');
        else if (key === 'r' && btnRain) btnRain.click();
        else if (key === 'n' && btnDay) btnDay.click();
        else if (key === 's' && btnSiren) btnSiren.click();
        else if (key === 'm' && btnMode) btnMode.click();
        else if (key === 'g') {
          if (this.ui && typeof this.ui.toggleCorridorMode === 'function') {
            this.ui.toggleCorridorMode();
          } else {
            this.toggleAiCorridor();
          }
        }
      });
    }

    /**
     * Window viewport resize listener.
     */
    initEvents() {
      if (typeof window === 'undefined') return;

      window.addEventListener('resize', () => {
        if (this.camera && this.renderer) {
          this.camera.aspect = window.innerWidth / window.innerHeight;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(window.innerWidth, window.innerHeight);
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
        }
      });
    }

    /**
     * Smoothly dismisses the loading splash screen.
     */
    dismissLoadingScreen() {
      if (typeof document === 'undefined') return;
      const loader = document.getElementById('loading-screen');
      if (loader) {
        setTimeout(() => {
          loader.style.opacity = '0';
          setTimeout(() => {
            loader.style.display = 'none';
          }, 600);
        }, 350);
      }
    }

    /**
     * Continuous 60 FPS animation loop.
     */
    animate() {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(this.animate);
      }

      const dt = this.clock ? Math.min(this.clock.getDelta(), 0.1) : 0.016;
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

      // FPS Measurement & Telemetry Display Update
      this.frameCount++;
      if (now - this.lastFpsUpdate >= 500) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
        if (this.fpsElement) {
          this.fpsElement.innerText = `${this.fps} FPS`;
        }
        if (this.preemptElement && this.signals) {
          this.preemptElement.innerText = `${this.signals.getPreemptedCount()}`;
        }
        this.frameCount = 0;
        this.lastFpsUpdate = now;
      }

      // Update Subsystems: Camera & Controls
      if (this.cameraController && typeof this.cameraController.update === 'function') {
        this.cameraController.update(dt);
      } else if (this.controls && this.controls.enabled) {
        this.controls.update();
      }

      if (this.atmosphere) {
        const camPos = this.camera ? this.camera.position : null;
        this.atmosphere.update(dt, camPos);
      }

      if (this.signals) {
        this.signals.update(dt);
      }

      // Stage 4: the deterministic simulation engine is the single authority
      // over ambulance kinematics and signal preemption. When it is attached
      // the legacy distance-horizon preemption path is NOT run: the engine's
      // SmartRoutingController owns the priority-hold lifecycle and the signal
      // manager's own state machine walks the safe amber/all-red transition.
      // The engine advances on a fixed 0.1 s accumulator so its tick sequence
      // is frame-rate independent (and identical to the Node benchmark runs).
      if (this.sim) {
        this._simAccumulator += dt;
        let steps = 0;
        while (this._simAccumulator >= this._simStepSec && steps < 20) {
          this.sim.step(this._simStepSec);
          this._simAccumulator -= this._simStepSec;
          steps += 1;
        }
        if (steps >= 20) this._simAccumulator = 0.0;
      }

      // Update downstream modules if present
      if (this.ambulance) {
        this.ambulance.update(dt);
        if (this.speedElement && typeof this.ambulance.getSpeedKmh === 'function') {
          this.speedElement.innerText = `${this.ambulance.getSpeedKmh().toFixed(1)} km/h`;
        }
        // Signal Preemption: Only active when AI Green Corridor is ON, and only
        // when the simulation is NOT driving it (the sim owns preemption).
        if (this.signals && typeof this.ambulance.getPosition === 'function'
            && !this.sim && this.aiCorridorActive) {
          const ambPos = this.ambulance.getPosition();
          const speed = this.ambulance.getSpeedKmh ? this.ambulance.getSpeedKmh() : 40.0;
          const route = this.ambulance.getActiveRouteJunctions ? this.ambulance.getActiveRouteJunctions() : [];
          this.signals.updatePreemption(ambPos, speed, route);
        }
      }

      if (this.traffic) {
        // When AI Green Corridor is OFF: civilian vehicles do NOT yield (parting wave disabled)
        if (!this.aiCorridorActive && this.ambulance) {
          const baselineCone = (typeof this.ambulance.getClearanceCone === 'function')
            ? Object.assign({}, this.ambulance.getClearanceCone(), { sirenActive: false })
            : null;
          this.traffic.update(dt, baselineCone, this.signals);
        } else {
          this.traffic.update(dt, this.ambulance, this.signals);
        }
        
        // Sync civilian vehicles from SimulationEngine if available
        if (this.sim && typeof this.traffic.syncFromSimulation === 'function') {
          this.traffic.syncFromSimulation(this.sim);
        }
      }

      if (this.benchmark) {
        // Pass simulation engine for live metrics
        this.benchmark.update(dt, this.ambulance, this.sim);
        if (this.savingsElement && typeof this.benchmark.getMetrics === 'function') {
          const m = this.benchmark.getMetrics(this.sim);
          this.savingsElement.innerText = `${m.minutesSaved.toFixed(1)} min`;
        }
      }

      if (this.ui) {
        this.ui.update(dt);
      }

      // Render Scene
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  // Auto-instantiate upon DOM readiness in browser environment
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
