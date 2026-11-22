/**
 * js/config.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin - System Configuration
 * Browser-global (window.CONFIG) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CONFIG = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    GEO: {
      origin: {
        lat: 12.9715987,
        lon: 77.5945627,
        alt: 920.0
      },
      datum: 'WGS84',
      zone: 'UTM43N',
      bounds: {
        minLat: 12.9550,
        maxLat: 12.9900,
        minLon: 77.5650,
        maxLon: 77.6250
      },
      earthRadius: 6378137.0,
      flattening: 1.0 / 298.257223563
    },

    GRAPHICS: {
      antialias: true,
      shadows: true,
      shadowMapSize: 2048,
      maxPixelRatio: 2.0,
      clearColor: 0x070b14,
      toneMappingExposure: 1.15,
      targetFPS: 60
    },

    CAMERA: {
      fov: 60,
      near: 0.5,
      far: 10000,
      initialPosition: { x: 0, y: 380, z: 460 },
      initialTarget: { x: 0, y: 0, z: 0 },
      modes: {
        CHASE: 'chase',
        COCKPIT: 'cockpit',
        AERIAL: 'aerial',
        ORBIT: 'orbit'
      },
      chaseOffset: { x: 0, y: 5.5, z: 12.5 },
      cockpitOffset: { x: 0, y: 1.7, z: 0.8 },
      aerialOffset: { x: 0, y: 140.0, z: 0.0 }
    },

    SIGNALS: {
      poleHeight: 6.2,
      poleRadius: 0.14,
      mastArmLength: 4.5,
      mastArmRadius: 0.09,
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
      },
      preemptionClearanceMarginMeters: 30.0,
      preemptionAmberDurationSec: 3.0,
      maxPreemptionHorizonMeters: 300.0,
      preemptionTimeHorizonSec: 25.0,
      minSpeedMps: 5.0
    },

    ROADS: {
      laneWidth: 3.5,
      curbHeight: 0.15,
      curbWidth: 0.25,
      sidewalkWidth: 2.0,
      setback: 3.0,
      widths: {
        2: 7.0,
        4: 14.0,
        6: 21.0
      },
      stripeWidth: 0.15,
      dashLength: 3.0,
      gapLength: 3.0,
      stopBarWidth: 0.45,
      stopBarDistance: 5.0
    },

    ATMOSPHERE: {
      diurnalCycleHours: 24.0,
      autoCycleSpeed: 0.5,
      rainCount: 15000,
      rainBox: {
        width: 120,
        height: 70,
        depth: 120,
        minYOffset: -15,
        maxYOffset: 55
      },
      rainTerminalSpeedRange: [-34.0, -42.0],
      rainWindSpeed: { x: -2.5, z: 0.8 },
      fogDensityClear: 0.00030,
      fogDensityRain: 0.00130,
      wetAsphaltRoughness: 0.16,
      wetAsphaltMetalness: 0.45,
      dryAsphaltRoughness: 0.85,
      dryAsphaltMetalness: 0.08
    },

    AMBULANCE: {
      maxSpeedKmh: 80.0,
      accelerationMps2: 8.5,
      brakeDecelerationMps2: 14.0,
      reverseMaxSpeedKmh: 25.0,
      steeringSpeed: 2.2,
      dimensions: { length: 5.5, width: 2.2, height: 2.4 },
      clearanceCone: {
        rangeM: 80.0,
        fovRad: 0.7
      },
      strobeRateHz: 4.0
    },

    TRAFFIC: {
      maxVehicles: 200,
      partingWaveShiftMeters: 1.8,
      restoreThresholdMeters: 25.0
    },

    TELEMETRY: {
      wsUrl: 'ws://127.0.0.1:8765',
      reconnectIntervalMs: 3000,
      fallbackSimRateHz: 10
    }
  };
}));
