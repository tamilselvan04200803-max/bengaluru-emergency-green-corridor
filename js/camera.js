/**
 * js/camera.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Multi-Mode Camera Controller
 * Supports Chase (3rd-person follow), Cockpit (1st-person hood view with suspension roll),
 * Aerial (top-down bird's-eye view), and Orbit (free inspection).
 * Browser-global (window.CameraController) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CameraController = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CAMERA_MODES = {
    CHASE: 'chase',
    COCKPIT: 'cockpit',
    AERIAL: 'aerial',
    ORBIT: 'orbit'
  };

  const CAMERA_CONFIG = {
    CHASE: {
      distance: 14.0,
      height: 4.8,
      lookAhead: 8.0,
      damping: 6.0,
      lookDamping: 8.0
    },
    COCKPIT: {
      forwardOffset: 0.75,
      height: 1.80,
      lookAhead: 25.0,
      rollCoupling: 0.95,
      pitchCoupling: 0.90
    },
    AERIAL: {
      height: 75.0,
      pitchBack: 10.0,
      damping: 5.0
    }
  };

  class CameraController {
    /**
     * @param {THREE.Camera} camera - Three.js perspective camera
     * @param {Object} [target=null] - AmbulanceManager or Object3D to track
     * @param {HTMLElement} [domElement=null] - Canvas element for controls
     * @param {THREE.OrbitControls} [orbitControls=null] - Pre-instantiated OrbitControls
     */
    constructor(camera, target = null, domElement = null, orbitControls = null) {
      this.camera = camera;
      this.target = target;
      this.domElement = domElement;
      this.controls = orbitControls;

      this.mode = CAMERA_MODES.ORBIT;
      this.modesList = [
        CAMERA_MODES.CHASE,
        CAMERA_MODES.COCKPIT,
        CAMERA_MODES.AERIAL,
        CAMERA_MODES.ORBIT
      ];

      // Smooth tracking state
      this.currentPos = { x: 0, y: 380, z: 460 };
      this.currentLook = { x: 0, y: 0, z: 0 };
      this.currentRoll = 0.0;

      if (this.camera && this.camera.position) {
        this.currentPos.x = this.camera.position.x;
        this.currentPos.y = this.camera.position.y;
        this.currentPos.z = this.camera.position.z;
      }

      this.firstUpdate = true;
    }

    setTarget(target) {
      this.target = target;
      this.firstUpdate = true;
    }

    setMode(mode) {
      const lower = String(mode).toLowerCase();
      if (!Object.values(CAMERA_MODES).includes(lower)) {
        console.warn(`CameraController: Unknown mode ${mode}. Defaulting to orbit.`);
        this.mode = CAMERA_MODES.ORBIT;
      } else {
        this.mode = lower;
      }

      if (this.controls) {
        if (this.mode === CAMERA_MODES.ORBIT) {
          this.controls.enabled = true;
        } else {
          this.controls.enabled = false;
        }
      }

      // Reset camera roll upon leaving cockpit
      if (this.mode !== CAMERA_MODES.COCKPIT && this.camera && this.camera.up) {
        this.camera.up.set(0, 1, 0);
      }

      this.firstUpdate = true;
      return this.mode;
    }

    getMode() {
      return this.mode;
    }

    cycleMode() {
      const idx = this.modesList.indexOf(this.mode);
      const nextIdx = (idx + 1) % this.modesList.length;
      return this.setMode(this.modesList[nextIdx]);
    }

    /**
     * Resolves target world position, heading, pitch, and roll.
     */
    resolveTargetState() {
      if (!this.target) {
        return {
          pos: { x: 0, y: 0, z: 0 },
          headingDeg: 0,
          headingRad: 0,
          pitchRad: 0,
          rollRad: 0,
          speedKmh: 0
        };
      }

      let pos = { x: 0, y: 0, z: 0 };
      if (typeof this.target.getPosition === 'function') {
        pos = this.target.getPosition();
      } else if (this.target.position) {
        pos = this.target.position;
      }

      let headingDeg = 0;
      if (typeof this.target.getHeadingDeg === 'function') {
        headingDeg = this.target.getHeadingDeg();
      } else if (this.target.headingDeg !== undefined) {
        headingDeg = this.target.headingDeg;
      } else if (this.target.rotation && this.target.rotation.y !== undefined) {
        headingDeg = (this.target.rotation.y * 180.0) / Math.PI;
      }

      const headingRad = (headingDeg * Math.PI) / 180.0;

      let pitchRad = 0;
      if (typeof this.target.getPitch === 'function') {
        pitchRad = this.target.getPitch();
      } else if (this.target.pitchRad !== undefined) {
        pitchRad = this.target.pitchRad;
      }

      let rollRad = 0;
      if (typeof this.target.getRoll === 'function') {
        rollRad = this.target.getRoll();
      } else if (this.target.rollRad !== undefined) {
        rollRad = this.target.rollRad;
      }

      let speedKmh = 0;
      if (typeof this.target.getSpeedKmh === 'function') {
        speedKmh = this.target.getSpeedKmh();
      }

      return { pos, headingDeg, headingRad, pitchRad, rollRad, speedKmh };
    }

    /**
     * Per-frame camera update.
     * @param {number} dt - Delta time in seconds
     */
    update(dt = 0.016) {
      if (!this.camera) return;

      const { pos, headingRad, pitchRad, rollRad } = this.resolveTargetState();

      // Heading forward and right unit vectors
      const fwdX = Math.sin(headingRad);
      const fwdZ = -Math.cos(headingRad);
      const rightX = Math.cos(headingRad);
      const rightZ = Math.sin(headingRad);

      switch (this.mode) {
        case CAMERA_MODES.CHASE: {
          const cfg = CAMERA_CONFIG.CHASE;
          const desiredX = pos.x - fwdX * cfg.distance;
          const desiredY = pos.y + cfg.height;
          const desiredZ = pos.z - fwdZ * cfg.distance;

          const lookX = pos.x + fwdX * cfg.lookAhead;
          const lookY = pos.y + 1.2;
          const lookZ = pos.z + fwdZ * cfg.lookAhead;

          if (this.firstUpdate) {
            this.currentPos.x = desiredX;
            this.currentPos.y = desiredY;
            this.currentPos.z = desiredZ;
            this.currentLook.x = lookX;
            this.currentLook.y = lookY;
            this.currentLook.z = lookZ;
            this.firstUpdate = false;
          } else {
            const posFactor = Math.min(1.0, dt * cfg.damping);
            const lookFactor = Math.min(1.0, dt * cfg.lookDamping);

            this.currentPos.x += (desiredX - this.currentPos.x) * posFactor;
            this.currentPos.y += (desiredY - this.currentPos.y) * posFactor;
            this.currentPos.z += (desiredZ - this.currentPos.z) * posFactor;

            this.currentLook.x += (lookX - this.currentLook.x) * lookFactor;
            this.currentLook.y += (lookY - this.currentLook.y) * lookFactor;
            this.currentLook.z += (lookZ - this.currentLook.z) * lookFactor;
          }

          if (this.camera.position) {
            this.camera.position.set(this.currentPos.x, this.currentPos.y, this.currentPos.z);
          }
          if (this.camera.up) {
            this.camera.up.set(0, 1, 0);
          }
          if (typeof this.camera.lookAt === 'function') {
            this.camera.lookAt(this.currentLook.x, this.currentLook.y, this.currentLook.z);
          }
          break;
        }

        case CAMERA_MODES.COCKPIT: {
          const cfg = CAMERA_CONFIG.COCKPIT;
          // Position camera inside ambulance driver cockpit
          const camX = pos.x + fwdX * cfg.forwardOffset;
          const camY = pos.y + cfg.height;
          const camZ = pos.z + fwdZ * cfg.forwardOffset;

          // Look ahead along heading with pitch influence
          const lookX = camX + fwdX * cfg.lookAhead;
          const lookY = camY - Math.sin(pitchRad * cfg.pitchCoupling) * cfg.lookAhead + 0.2;
          const lookZ = camZ + fwdZ * cfg.lookAhead;

          if (this.camera.position) {
            this.camera.position.set(camX, camY, camZ);
          }

          // Authentic roll coupling: up-vector tilts into corners based on suspension centripetal roll
          this.currentRoll = rollRad * cfg.rollCoupling;
          const upX = -Math.sin(this.currentRoll) * rightX;
          const upY = Math.cos(this.currentRoll);
          const upZ = -Math.sin(this.currentRoll) * rightZ;

          if (this.camera.up) {
            this.camera.up.set(upX, upY, upZ);
          }
          if (typeof this.camera.lookAt === 'function') {
            this.camera.lookAt(lookX, lookY, lookZ);
          }
          this.firstUpdate = false;
          break;
        }

        case CAMERA_MODES.AERIAL: {
          const cfg = CAMERA_CONFIG.AERIAL;
          const desiredX = pos.x;
          const desiredY = pos.y + cfg.height;
          const desiredZ = pos.z + cfg.pitchBack;

          const lookX = pos.x + fwdX * 12.0;
          const lookY = pos.y;
          const lookZ = pos.z + fwdZ * 12.0;

          if (this.firstUpdate) {
            this.currentPos.x = desiredX;
            this.currentPos.y = desiredY;
            this.currentPos.z = desiredZ;
            this.firstUpdate = false;
          } else {
            const factor = Math.min(1.0, dt * cfg.damping);
            this.currentPos.x += (desiredX - this.currentPos.x) * factor;
            this.currentPos.y += (desiredY - this.currentPos.y) * factor;
            this.currentPos.z += (desiredZ - this.currentPos.z) * factor;
          }

          if (this.camera.position) {
            this.camera.position.set(this.currentPos.x, this.currentPos.y, this.currentPos.z);
          }
          if (this.camera.up) {
            this.camera.up.set(0, 0, -1); // North-up orientation
          }
          if (typeof this.camera.lookAt === 'function') {
            this.camera.lookAt(lookX, lookY, lookZ);
          }
          break;
        }

        case CAMERA_MODES.ORBIT:
        default: {
          // Free Orbit mode delegates to OrbitControls
          if (this.controls) {
            this.controls.enabled = true;
            // Center orbit target on ambulance if available
            if (pos && this.controls.target) {
              const f = Math.min(1.0, dt * 2.0);
              this.controls.target.x += (pos.x - this.controls.target.x) * f;
              this.controls.target.y += (pos.y - this.controls.target.y) * f;
              this.controls.target.z += (pos.z - this.controls.target.z) * f;
            }
          }
          break;
        }
      }
    }

    getCockpitRoll() {
      return this.currentRoll;
    }

    static getOffsets() {
      return {
        CHASE: { x: 0, y: 4.5, z: -9.0 },
        COCKPIT: { x: 0, y: 1.8, z: 0.5 },
        AERIAL: { x: 0, y: 45.0, z: 0.0 }
      };
    }
  }

  CameraController.MODES = CAMERA_MODES;
  CameraController.CONFIG = CAMERA_CONFIG;

  return CameraController;
}));
