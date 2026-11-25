/**
 * js/camera_director.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Camera Director
 * MapLibre flyTo presets for Silk Board, Majestic → Victoria, Full City 3D,
 * live Chase Ambulance tracking, and Dual A vs D comparison view.
 * Browser-global (window.CameraDirector / window.cameraDirectorInstance) & CommonJS compatible (UMD).
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CameraDirector = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class CameraDirector {
    constructor(options = {}) {
      this.map = options.map || null;
      this.projection = options.projection || null;
      this.sim = options.sim || null;
      this.ambulance = options.ambulance || null;
      this.currentMode = 'fullCity';
      this._isFlyingToChase = false;
      this._userInteracting = false;
      this._lastChaseUpdateAt = 0;

      this.PRESETS = {
        silkBoard: {
          center: [77.6238, 12.9176], // Silk Board Junction (Hosur Rd / St. John's corridor)
          zoom: 15.4,
          pitch: 60,
          bearing: -15,
          duration: 1600,
          description: 'Silk Board Junction'
        },
        majesticToVictoria: {
          center: [77.5755, 12.9695], // Majestic -> KG Rd / Avenue Rd -> Victoria Hospital
          zoom: 14.3,
          pitch: 58,
          bearing: 160,
          duration: 1800,
          description: 'Majestic → Victoria Hospital'
        },
        fullCity: {
          center: [77.596, 12.954], // Full Bengaluru Digital Twin network
          zoom: 12.3,
          pitch: 52,
          bearing: -10,
          duration: 2000,
          description: 'Full City 3D'
        },
        chaseAmbulance: {
          center: [77.575, 12.974],
          zoom: 17.8,
          pitch: 65,
          bearing: 0,
          duration: 1200,
          description: 'Chase Ambulance'
        },
        dualAvsD: {
          center: [77.580, 12.970], // Primary vs Seshadri bypass corridor
          zoom: 14.1,
          pitch: 56,
          bearing: 15,
          duration: 1600,
          description: 'Dual A vs D'
        }
      };
    }

    configure(options = {}) {
      if (options.map !== undefined) this.map = options.map;
      if (options.projection !== undefined) this.projection = options.projection;
      if (options.sim !== undefined) this.sim = options.sim;
      if (options.ambulance !== undefined) this.ambulance = options.ambulance;
      return this;
    }

    setMap(map) { this.map = map; }
    setProjection(projection) { this.projection = projection; }
    setSimulation(sim) { this.sim = sim; }
    setAmbulance(ambulance) { this.ambulance = ambulance; }

    init() {
      if (!this.map) return Promise.resolve(this);

      // Pause chase tracking if user manually drags/zooms the map
      this.map.on('dragstart', () => {
        if (this.currentMode === 'chaseAmbulance') {
          this.currentMode = 'free';
          this._isFlyingToChase = false;
        }
      });

      return Promise.resolve(this);
    }

    _flyToPreset(modeKey, preset) {
      this.currentMode = modeKey;
      this._isFlyingToChase = false;
      if (!this.map) return;

      this.map.flyTo({
        center: preset.center,
        zoom: preset.zoom,
        pitch: preset.pitch,
        bearing: preset.bearing,
        duration: preset.duration,
        essential: true
      });
    }

    flyToSilkBoard() {
      this._flyToPreset('silkBoard', this.PRESETS.silkBoard);
    }

    flyToMajesticToVictoria() {
      this._flyToPreset('majesticToVictoria', this.PRESETS.majesticToVictoria);
    }

    flyToFullCity() {
      this._flyToPreset('fullCity', this.PRESETS.fullCity);
    }

    /**
     * Resolve current live ambulance [lon, lat] and compass bearing [deg].
     */
    _getLiveAmbulanceGeo() {
      if (this.sim && this.sim.vehicles) {
        const ambVeh = this.sim.vehicles.get('amb_1');
        if (ambVeh && ambVeh.edge) {
          const sample = ambVeh.edge.sampleAt(ambVeh.s);
          const bearing = ((sample.headingRad * 180 / Math.PI) + 360) % 360;
          return { center: [sample.lon, sample.lat], bearing };
        }
      }
      if (this.ambulance && this.projection && typeof this.ambulance.getPosition === 'function') {
        const pos = this.ambulance.getPosition();
        if (pos && typeof this.projection.cartesianToLatLonAlt === 'function') {
          const geo = this.projection.cartesianToLatLonAlt(pos.x, pos.y || 0, pos.z);
          const bearing = this.ambulance.getHeadingDeg ? this.ambulance.getHeadingDeg() : 0;
          return { center: [geo.lon, geo.lat], bearing };
        }
      }
      return { center: this.PRESETS.chaseAmbulance.center, bearing: 0 };
    }

    chaseAmbulance() {
      this.currentMode = 'chaseAmbulance';
      if (!this.map) return;

      const { center, bearing } = this._getLiveAmbulanceGeo();
      const preset = this.PRESETS.chaseAmbulance;

      this._isFlyingToChase = true;
      this.map.flyTo({
        center,
        zoom: preset.zoom,
        pitch: preset.pitch,
        bearing,
        duration: preset.duration,
        essential: true
      });

      this.map.once('moveend', () => {
        this._isFlyingToChase = false;
      });
    }

    setDualMode() {
      this._flyToPreset('dualAvsD', this.PRESETS.dualAvsD);
    }

    flyToDualAvsD() {
      this.setDualMode();
    }

    /**
     * Called each animation frame to smoothly follow the live ambulance in chase mode (~4 Hz).
     */
    update() {
      if (!this.map || this.currentMode !== 'chaseAmbulance' || this._isFlyingToChase) return;

      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - this._lastChaseUpdateAt < 250) return;
      this._lastChaseUpdateAt = now;

      const { center, bearing } = this._getLiveAmbulanceGeo();
      this.map.easeTo({
        center,
        bearing,
        duration: 220,
        easing: (t) => t
      });
    }

    panTo(lng, lat, options = {}) {
      if (!this.map) return;
      this.currentMode = 'custom';
      this.map.flyTo({
        center: [lng, lat],
        zoom: options.zoom !== undefined ? options.zoom : 14.5,
        pitch: options.pitch !== undefined ? options.pitch : 58,
        bearing: options.bearing !== undefined ? options.bearing : 0,
        duration: options.duration !== undefined ? options.duration : 1000,
        essential: true
      });
    }

    getCurrentMode() { return this.currentMode; }
    getPresets() { return this.PRESETS; }
  }

  if (typeof window !== 'undefined') {
    window.cameraDirectorInstance = new CameraDirector();
  }

  return CameraDirector;
}));
