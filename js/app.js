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

      // Update downstream modules if present
      if (this.ambulance) {
        this.ambulance.update(dt);
        if (this.speedElement && typeof this.ambulance.getSpeedKmh === 'function') {
          this.speedElement.innerText = `${this.ambulance.getSpeedKmh().toFixed(1)} km/h`;
        }
        // Signal Preemption: Only active when AI Green Corridor is ON
        if (this.signals && typeof this.ambulance.getPosition === 'function') {
          if (this.aiCorridorActive) {
            const ambPos = this.ambulance.getPosition();
            const speed = this.ambulance.getSpeedKmh ? this.ambulance.getSpeedKmh() : 40.0;
            const route = this.ambulance.getActiveRouteJunctions ? this.ambulance.getActiveRouteJunctions() : [];
            this.signals.updatePreemption(ambPos, speed, route);
          }
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
      }

      if (this.benchmark) {
        this.benchmark.update(dt, this.ambulance);
        if (this.savingsElement && typeof this.benchmark.getMetrics === 'function') {
          const m = this.benchmark.getMetrics();
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
