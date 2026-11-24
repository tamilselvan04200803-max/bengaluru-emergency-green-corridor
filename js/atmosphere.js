/**
 * js/atmosphere.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Atmosphere & Weather Controller
 * Dynamic Solar Trajectory, Day/Dusk/Night Transitions, Camera-Anchored Rain Particle System,
 * and Wet-Asphalt Specular Surface Reflections.
 * Browser-global (window.AtmosphereController) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const cls = factory();
    root.AtmosphereController = cls;
    root.AtmosphereManager = cls; // Alias for seamless integration
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class AtmosphereController {
    /**
     * @param {THREE.Scene} [scene]
     * @param {THREE.Camera} [camera]
     * @param {THREE.WebGLRenderer} [renderer]
     */
    constructor(scene, camera, renderer) {
      this.scene = scene || null;
      this.camera = camera || null;
      this.renderer = renderer || null;

      // Lighting components
      this.sunLight = null;
      this.hemiLight = null;
      this.ambientLight = null;
      this.fog = null;

      // Diurnal & Weather States
      this.currentHour = 12.0;       // 0.0 to 24.0 (12.0 = Solar Noon)
      this.targetHour = 12.0;
      this.timePreset = 'day';        // 'day' | 'dusk' | 'night' | 'custom'
      this.weather = 'clear';         // 'clear' | 'rain'
      this.wetness = 0.0;             // 0.0 (dry) to 1.0 (fully wet)
      this.targetWetness = 0.0;
      this.autoCycle = false;
      this.autoCycleSpeed = 0.5;      // Hours per real second

      // Rain Particle System
      this.rainParticles = null;
      this.rainCount = 15000;
      this.rainPositions = null;
      this.rainVelocities = null;
      this.rainBox = { width: 120, height: 70, depth: 120, minYOffset: -15, maxYOffset: 55 };

      // Registered Materials for Wet Surface Updates
      this.roadMaterials = new Set();
      this.puddleMaterials = new Set();
      this.environmentManager = null;

      // Diurnal Keyframes (Astronomically calibrated for Bengaluru: 12.97° N)
      this.keyframes = [
        { hour: 0.0,  sunInt: 0.22, sunCol: 0x3d5a80, hemiSky: 0x0f172a, hemiGnd: 0x050811, ambCol: 0x141e30, ambInt: 0.18, fogCol: 0x0a0f1d, fogDens: 0.00075, skyCol: 0x070b14 },
        { hour: 5.5,  sunInt: 0.22, sunCol: 0x3d5a80, hemiSky: 0x0f172a, hemiGnd: 0x050811, ambCol: 0x141e30, ambInt: 0.18, fogCol: 0x0a0f1d, fogDens: 0.00075, skyCol: 0x070b14 },
        { hour: 6.5,  sunInt: 0.90, sunCol: 0xffa050, hemiSky: 0xd96f43, hemiGnd: 0x2e1d23, ambCol: 0x4a2e3b, ambInt: 0.28, fogCol: 0x9e6047, fogDens: 0.00055, skyCol: 0x9c4f30 },
        { hour: 8.0,  sunInt: 1.30, sunCol: 0xfff3db, hemiSky: 0x82b4ff, hemiGnd: 0x3a4b35, ambCol: 0xd0e0ff, ambInt: 0.32, fogCol: 0x8fb8e0, fogDens: 0.00035, skyCol: 0x87ceeb },
        { hour: 12.0, sunInt: 1.45, sunCol: 0xfffaed, hemiSky: 0x78a7ff, hemiGnd: 0x3a4b35, ambCol: 0xe8f0ff, ambInt: 0.35, fogCol: 0x9bc2e6, fogDens: 0.00030, skyCol: 0x78a7ff },
        { hour: 16.5, sunInt: 1.30, sunCol: 0xffecd0, hemiSky: 0x82b4ff, hemiGnd: 0x354432, ambCol: 0xd0e0ff, ambInt: 0.32, fogCol: 0x8fb8e0, fogDens: 0.00035, skyCol: 0x82b4ff },
        { hour: 18.0, sunInt: 1.05, sunCol: 0xff7a36, hemiSky: 0xff6b4a, hemiGnd: 0x2a1a24, ambCol: 0x5c3a4d, ambInt: 0.25, fogCol: 0xb85d43, fogDens: 0.00060, skyCol: 0xd45d39 },
        { hour: 19.5, sunInt: 0.35, sunCol: 0x554070, hemiSky: 0x1f1938, hemiGnd: 0x0c0817, ambCol: 0x221833, ambInt: 0.20, fogCol: 0x141029, fogDens: 0.00070, skyCol: 0x15102a },
        { hour: 24.0, sunInt: 0.22, sunCol: 0x3d5a80, hemiSky: 0x0f172a, hemiGnd: 0x050811, ambCol: 0x141e30, ambInt: 0.18, fogCol: 0x0a0f1d, fogDens: 0.00075, skyCol: 0x070b14 }
      ];

      if (this.scene) {
        this.init(this.scene, this.renderer, this.camera);
      }
    }

    /**
     * Initializes lights, shadows, fog, and rain streak system.
     */
    init(scene, renderer, camera) {
      this.scene = scene;
      this.renderer = renderer;
      this.camera = camera;

      if (typeof THREE === 'undefined') return;

      // 1. Directional Sun/Moon Light with Dynamic Shadow Camera
      this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.45);
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.width = 2048;
      this.sunLight.shadow.mapSize.height = 2048;
      this.sunLight.shadow.camera.near = 10;
      this.sunLight.shadow.camera.far = 3000;
      this.sunLight.shadow.camera.left = -400;
      this.sunLight.shadow.camera.right = 400;
      this.sunLight.shadow.camera.top = 400;
      this.sunLight.shadow.camera.bottom = -400;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.04;
      this.scene.add(this.sunLight);
      this.scene.add(this.sunLight.target);

      // 2. Hemisphere Sky/Ground Light
      this.hemiLight = new THREE.HemisphereLight(0x78a7ff, 0x3a4b35, 0.65);
      this.scene.add(this.hemiLight);

      // 3. Ambient Fill Light
      this.ambientLight = new THREE.AmbientLight(0xe8f0ff, 0.35);
      this.scene.add(this.ambientLight);

      // 4. Exponential Distance Fog
      this.fog = new THREE.FogExp2(0x9bc2e6, 0.00030);
      this.scene.fog = this.fog;

      // 5. Camera-Anchored Rain Particle System
      this.initRain();

      // 6. Set Initial State
      this.setTimeOfDay('day');
      this.updateLighting(new THREE.Vector3(0, 15, 0));
    }

    /**
     * Generates a 16x64 procedural rain streak canvas texture.
     */
    createRainTexture() {
      if (typeof document === 'undefined') return null;

      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');

      const gradient = ctx.createLinearGradient(8, 0, 8, 64);
      gradient.addColorStop(0.0, 'rgba(180, 215, 255, 0.0)');
      gradient.addColorStop(0.3, 'rgba(195, 225, 255, 0.35)');
      gradient.addColorStop(0.8, 'rgba(230, 245, 255, 0.85)');
      gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.95)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(8, 48, 4, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      return texture;
    }

    /**
     * Initializes the 15,000 particle rain system.
     */
    initRain() {
      if (typeof THREE === 'undefined') return;

      const geo = new THREE.BufferGeometry();
      this.rainPositions = new Float32Array(this.rainCount * 3);
      this.rainVelocities = new Float32Array(this.rainCount * 3);

      const camX = this.camera ? this.camera.position.x : 0;
      const camY = this.camera ? this.camera.position.y : 15;
      const camZ = this.camera ? this.camera.position.z : 0;

      for (let i = 0; i < this.rainCount; i++) {
        const i3 = i * 3;
        // Distribute uniformly in camera-anchored volume
        this.rainPositions[i3]     = camX + (Math.random() - 0.5) * this.rainBox.width;
        this.rainPositions[i3 + 1] = camY + this.rainBox.minYOffset + Math.random() * this.rainBox.height;
        this.rainPositions[i3 + 2] = camZ + (Math.random() - 0.5) * this.rainBox.depth;

        // Terminal downward fall + southwest monsoon wind drift
        this.rainVelocities[i3]     = -2.5 + (Math.random() - 0.5) * 1.5;
        this.rainVelocities[i3 + 1] = -34.0 - Math.random() * 8.0;
        this.rainVelocities[i3 + 2] = 0.8 + (Math.random() - 0.5) * 1.0;
      }

      geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));

      const tex = this.createRainTexture();
      const mat = new THREE.PointsMaterial({
        color: 0xbcd8f8,
        size: 2.2,
        map: tex,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
      });

      this.rainParticles = new THREE.Points(geo, mat);
      this.rainParticles.visible = false;
      this.scene.add(this.rainParticles);
    }

    /**
     * Links EnvironmentManager for synchronized building window emissives & asphalt wetness.
     */
    setEnvironmentManager(envManager) {
      this.environmentManager = envManager;
      if (envManager && envManager.materials) {
        if (envManager.materials.asphalt) this.registerPuddleMaterial(envManager.materials.asphalt);
        if (envManager.materials.whiteMarkings) this.registerRoadMaterial(envManager.materials.whiteMarkings);
        if (envManager.materials.yellowCenterline) this.registerRoadMaterial(envManager.materials.yellowCenterline);
      }
    }

    /**
     * Registers a road MeshStandardMaterial for reactive wetness modulation.
     */
    registerRoadMaterial(material) {
      if (!material) return;
      this.roadMaterials.add(material);
      material.userData.dryRoughness = material.roughness !== undefined ? material.roughness : 0.85;
      material.userData.dryMetalness = material.metalness !== undefined ? material.metalness : 0.08;
      material.userData.dryColor = material.color ? material.color.clone() : null;
      material.userData.wetColor = new THREE.Color(0x111317);
    }

    /**
     * Registers a road material with procedural puddle onBeforeCompile shader injection.
     */
    registerPuddleMaterial(material) {
      this.registerRoadMaterial(material);
      this.puddleMaterials.add(material);

      if (typeof THREE === 'undefined' || !material) return;

      material.onBeforeCompile = (shader) => {
        shader.uniforms.uWetness = { value: 0.0 };
        shader.uniforms.uTime = { value: 0.0 };

        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
           varying vec3 vCustomWorldPosition;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vCustomWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
           uniform float uWetness;
           uniform float uTime;
           varying vec3 vCustomWorldPosition;

           float hash21(vec2 p) {
             p = fract(p * vec2(123.34, 456.21));
             p += dot(p, p + 45.32);
             return fract(p.x * p.y);
           }

           float smoothNoise2(vec2 p) {
             vec2 i = floor(p);
             vec2 f = fract(p);
             f = f * f * (3.0 - 2.0 * f);
             float a = hash21(i);
             float b = hash21(i + vec2(1.0, 0.0));
             float c = hash21(i + vec2(0.0, 1.0));
             float d = hash21(i + vec2(1.0, 1.0));
             return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
           }

           float fbm2(vec2 p) {
             float v = 0.0;
             float a = 0.5;
             for (int i = 0; i < 3; i++) {
               v += a * smoothNoise2(p);
               p *= 2.04;
               a *= 0.5;
             }
             return v;
           }
          `
        );

        // `roughnessFactor` and `metalnessFactor` are declared by their own
        // chunks, in that order. Writing to both from the roughness hook fails
        // to compile ('metalnessFactor' : undeclared identifier) because the
        // metalness chunk has not run yet, so each write goes in its own hook.
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           if (uWetness > 0.001) {
             float n = fbm2(vCustomWorldPosition.xz * 0.06) * uWetness;
             float puddle = smoothstep(0.40, 0.65, n) * uWetness;
             float wetR = mix(0.24, 0.04, puddle);
             roughnessFactor = mix(roughnessFactor, wetR, uWetness);
             diffuseColor.rgb *= mix(1.0, mix(0.72, 0.50, puddle), uWetness);
           }
          `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
           if (uWetness > 0.001) {
             float nm = fbm2(vCustomWorldPosition.xz * 0.06) * uWetness;
             float puddleM = smoothstep(0.40, 0.65, nm) * uWetness;
             metalnessFactor = mix(metalnessFactor, mix(0.35, 0.55, puddleM), uWetness);
           }
          `
        );

        material.userData.shader = shader;
      };
    }

    /**
     * Sets time of day: 'day' (12h), 'dusk' (18h), 'night' (23h), or numeric hour [0..24].
     * @param {string|number} presetOrHour
     * @param {boolean} [instant=true] - Whether to immediately jump to target hour
     */
    setTimeOfDay(presetOrHour, instant = true) {
      if (typeof presetOrHour === 'string') {
        const mode = presetOrHour.toLowerCase();
        if (mode === 'day') {
          this.targetHour = 12.0;
          this.timePreset = 'day';
        } else if (mode === 'dusk') {
          this.targetHour = 18.0;
          this.timePreset = 'dusk';
        } else if (mode === 'night') {
          this.targetHour = 23.0;
          this.timePreset = 'night';
        }
      } else if (typeof presetOrHour === 'number') {
        this.targetHour = Math.max(0.0, Math.min(24.0, presetOrHour));
        this.timePreset = 'custom';
      }

      if (instant) {
        this.currentHour = this.targetHour;
      }
    }

    cycleTimeOfDay() {
      if (this.timePreset === 'day') {
        this.setTimeOfDay('dusk');
      } else if (this.timePreset === 'dusk') {
        this.setTimeOfDay('night');
      } else {
        this.setTimeOfDay('day');
      }
      return this.timePreset;
    }

    /**
     * Sets weather mode: 'clear' or 'rain'.
     */
    setWeather(mode) {
      const clean = (mode || '').toLowerCase();
      if (clean === 'rain') {
        this.weather = 'rain';
        this.targetWetness = 1.0;
        if (this.rainParticles) this.rainParticles.visible = true;
      } else {
        this.weather = 'clear';
        this.targetWetness = 0.0;
      }
    }

    toggleWeather() {
      this.setWeather(this.weather === 'rain' ? 'clear' : 'rain');
      return this.weather;
    }

    getWetness() {
      return this.wetness;
    }

    getWeather() {
      return this.weather;
    }

    getTimePreset() {
      return this.timePreset;
    }

    getCurrentHour() {
      return this.currentHour;
    }

    /**
     * Computes the night factor [0..1] for building window illumination.
     * 0.0 at noon, 1.0 at midnight.
     */
    getNightFactor() {
      const h = this.currentHour;
      if (h >= 7.0 && h <= 17.0) return 0.0;
      if (h >= 20.0 || h <= 5.0) return 1.0;
      if (h > 17.0 && h < 20.0) return (h - 17.0) / 3.0;
      return (7.0 - h) / 2.0;
    }

    /**
     * Per-frame update called inside the 60 FPS animation loop.
     * @param {number} deltaSeconds
     * @param {THREE.Vector3} [cameraPos]
     */
    update(deltaSeconds = 0.016, cameraPos) {
      const cam = cameraPos || (this.camera ? this.camera.position : new THREE.Vector3(0, 15, 0));

      // 1. Advance auto-cycle or smoothly lerp currentHour towards targetHour
      if (this.autoCycle) {
        this.currentHour = (this.currentHour + this.autoCycleSpeed * deltaSeconds) % 24.0;
        this.targetHour = this.currentHour;
      } else {
        this.currentHour += (this.targetHour - this.currentHour) * Math.min(1.0, deltaSeconds * 4.0);
      }

      // 2. Smoothly lerp wetness factor
      this.wetness += (this.targetWetness - this.wetness) * Math.min(1.0, deltaSeconds * 1.8);
      if (this.wetness < 0.001 && this.targetWetness === 0.0) {
        this.wetness = 0.0;
        if (this.rainParticles) this.rainParticles.visible = false;
      }

      // 3. Update solar orbit & diurnal lighting
      if (this.scene) {
        this.updateLighting(cam);
      }

      // 4. Update rain particles if visible
      if (this.rainParticles && this.rainParticles.visible && this.wetness > 0.001) {
        this.updateRainParticles(deltaSeconds, cam);
      }

      // 5. Update wet road materials
      this.updateRoadMaterials();

      // 6. Update environment manager night factor and wet asphalt
      if (this.environmentManager) {
        if (typeof this.environmentManager.setWetAsphalt === 'function') {
          this.environmentManager.setWetAsphalt(this.wetness);
        }
        if (typeof this.environmentManager.setNightFactor === 'function') {
          this.environmentManager.setNightFactor(this.getNightFactor());
        }
      }
    }

    /**
     * Computes solar trajectory orbit and Hermite-smoothstep lighting values.
     */
    updateLighting(cam) {
      if (!this.sunLight || !this.hemiLight || !this.ambientLight) return;

      const h = this.currentHour;
      let kA = this.keyframes[0];
      let kB = this.keyframes[1];

      for (let i = 0; i < this.keyframes.length - 1; i++) {
        if (h >= this.keyframes[i].hour && h <= this.keyframes[i + 1].hour) {
          kA = this.keyframes[i];
          kB = this.keyframes[i + 1];
          break;
        }
      }

      const t = (h - kA.hour) / (kB.hour - kA.hour);
      const s = t * t * (3.0 - 2.0 * t); // Hermite smoothstep

      // Interpolate base diurnal values
      const sunColor = this.lerpColor(kA.sunCol, kB.sunCol, s);
      let sunIntensity = this.lerp(kA.sunInt, kB.sunInt, s);
      const hemiSky = this.lerpColor(kA.hemiSky, kB.hemiSky, s);
      const hemiGnd = this.lerpColor(kA.hemiGnd, kB.hemiGnd, s);
      const ambColor = this.lerpColor(kA.ambCol, kB.ambCol, s);
      let ambIntensity = this.lerp(kA.ambInt, kB.ambInt, s);
      let fogColor = this.lerpColor(kA.fogCol, kB.fogCol, s);
      let fogDensity = this.lerp(kA.fogDens, kB.fogDens, s);
      let skyColor = this.lerpColor(kA.skyCol, kB.skyCol, s);

      // Rain Overcast Storm Modulation
      if (this.wetness > 0.001) {
        sunIntensity *= (1.0 - 0.65 * this.wetness);
        ambIntensity = this.lerp(ambIntensity, 0.45, this.wetness);
        fogDensity = this.lerp(fogDensity, 0.00130, this.wetness);
        fogColor = this.lerpColor(fogColor, 0x2d3748, this.wetness);
        skyColor = this.lerpColor(skyColor, 0x1f2937, this.wetness);
      }

      // Apply to Three.js light instances
      this.sunLight.color.setHex(sunColor);
      this.sunLight.intensity = sunIntensity;
      this.hemiLight.color.setHex(hemiSky);
      this.hemiLight.groundColor.setHex(hemiGnd);
      this.ambientLight.color.setHex(ambColor);
      this.ambientLight.intensity = ambIntensity;

      if (this.fog) {
        this.fog.color.setHex(fogColor);
        this.fog.density = fogDensity;
      }
      if (this.renderer) {
        this.renderer.setClearColor(skyColor, 1.0);
      }

      // Solar Orbit Geometry: Bengaluru latitude = 12.9716° N
      const R = 1500.0;
      const phi = 12.9716 * (Math.PI / 180.0);
      const H = (this.currentHour - 12.0) * (Math.PI / 12.0); // Solar hour angle

      let sunX = -R * Math.sin(H);
      let sunY = R * Math.cos(H) * Math.cos(phi);
      let sunZ = R * Math.cos(H) * Math.sin(phi);

      // Sinking below horizon -> Nocturnal moon takes over from opposite sky
      if (sunY < 50.0) {
        sunX = -sunX;
        sunY = Math.max(250.0, -sunY * 0.75);
        sunZ = -sunZ;
      }

      // Anchor shadow camera target directly on camera position
      this.sunLight.target.position.set(cam.x, 0, cam.z);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.position.set(cam.x + sunX * 0.5, sunY, cam.z + sunZ * 0.5);
    }

    /**
     * Camera-anchored rain particle system wrapping update.
     */
    updateRainParticles(deltaSeconds, cam) {
      if (!this.rainPositions || !this.rainVelocities) return;

      const pos = this.rainPositions;
      const vel = this.rainVelocities;
      const count = this.rainCount;
      const box = this.rainBox;

      const minY = cam.y + box.minYOffset;
      const maxY = cam.y + box.maxYOffset;
      const rangeY = maxY - minY;
      const halfW = box.width * 0.5;
      const halfD = box.depth * 0.5;

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        pos[i3]     += vel[i3]     * deltaSeconds;
        pos[i3 + 1] += vel[i3 + 1] * deltaSeconds;
        pos[i3 + 2] += vel[i3 + 2] * deltaSeconds;

        // Vertical recycle
        if (pos[i3 + 1] < minY) {
          pos[i3 + 1] += rangeY;
          pos[i3]     = cam.x + (Math.random() - 0.5) * box.width;
          pos[i3 + 2] = cam.z + (Math.random() - 0.5) * box.depth;
        }

        // Horizontal camera-tracking wrap
        if (pos[i3] < cam.x - halfW) pos[i3] += box.width;
        if (pos[i3] > cam.x + halfW) pos[i3] -= box.width;
        if (pos[i3 + 2] < cam.z - halfD) pos[i3 + 2] += box.depth;
        if (pos[i3 + 2] > cam.z + halfD) pos[i3 + 2] -= box.depth;
      }

      this.rainParticles.geometry.attributes.position.needsUpdate = true;
      this.rainParticles.material.opacity = 0.70 * this.wetness;
    }

    /**
     * Modulates registered road materials for wet specular sheen.
     */
    updateRoadMaterials() {
      const w = this.wetness;
      const time = performance.now() * 0.001;

      for (const mat of this.roadMaterials) {
        const dryR = mat.userData.dryRoughness || 0.85;
        const dryM = mat.userData.dryMetalness || 0.08;
        const dryCol = mat.userData.dryColor;
        const wetCol = mat.userData.wetColor;

        mat.roughness = this.lerp(dryR, 0.16, w);
        mat.metalness = this.lerp(dryM, 0.45, w);

        if (dryCol && wetCol && mat.color) {
          mat.color.r = this.lerp(dryCol.r, wetCol.r, w);
          mat.color.g = this.lerp(dryCol.g, wetCol.g, w);
          mat.color.b = this.lerp(dryCol.b, wetCol.b, w);
        }

        if (mat.userData.shader && mat.userData.shader.uniforms) {
          if (mat.userData.shader.uniforms.uWetness) {
            mat.userData.shader.uniforms.uWetness.value = w;
          }
          if (mat.userData.shader.uniforms.uTime) {
            mat.userData.shader.uniforms.uTime.value = time;
          }
        }
      }
    }

    // Mathematical Interpolation Helpers
    lerp(a, b, t) {
      return a + (b - a) * t;
    }

    lerpColor(hexA, hexB, t) {
      const rA = (hexA >> 16) & 255, gA = (hexA >> 8) & 255, bA = hexA & 255;
      const rB = (hexB >> 16) & 255, gB = (hexB >> 8) & 255, bB = hexB & 255;
      const r = Math.round(this.lerp(rA, rB, t));
      const g = Math.round(this.lerp(gA, gB, t));
      const b = Math.round(this.lerp(bA, bB, t));
      return (r << 16) | (g << 8) | b;
    }
  }

  return AtmosphereController;
}));
