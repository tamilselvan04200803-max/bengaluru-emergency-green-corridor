/**
 * js/environment.js
 * Bengaluru Emergency Green Corridor 3D Digital Twin — Procedural 3D Environment Engine
 * Procedural Multi-Lane Roads (2/4/6 lanes), Concrete Curbs, Elevated Sidewalks,
 * Dashed Lane Dividers, Yellow Centerlines, Approach Stop Bars,
 * 12 Articulated Landmark Complexes (Vidhana Soudha, High Court, Victoria Hospital, etc.),
 * Procedural Corridor Parcel Buildings with CanvasTexture Facades & Night Window Emissives,
 * and BufferGeometry Merging for locked 60 FPS (<12 draw calls).
 * Browser-global (window.EnvironmentManager) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EnvironmentManager = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================================
  // 1. GEOMETRY MERGING UTILITY (NATIVE ZERO-DEPENDENCY FALLBACK + THREE SUPPORT)
  // ============================================================================
  function mergeBufferGeometriesSafe(geometries) {
    if (!geometries || geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];

    // Check if THREE.BufferGeometryUtils is available
    if (typeof THREE !== 'undefined' && THREE.BufferGeometryUtils && typeof THREE.BufferGeometryUtils.mergeBufferGeometries === 'function') {
      const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries, false);
      if (merged) return merged;
    }

    // Native standalone buffer geometry merger
    let totalPositions = 0;
    let totalNormals = 0;
    let totalUvs = 0;
    let totalIndices = 0;

    for (let i = 0; i < geometries.length; i++) {
      const g = geometries[i];
      if (!g || !g.attributes || !g.attributes.position) continue;
      totalPositions += g.attributes.position.array.length;
      if (g.attributes.normal) totalNormals += g.attributes.normal.array.length;
      if (g.attributes.uv) totalUvs += g.attributes.uv.array.length;
      if (g.index) totalIndices += g.index.array.length;
      else totalIndices += (g.attributes.position.array.length / 3);
    }

    const mergedPositions = new Float32Array(totalPositions);
    const mergedNormals = totalNormals > 0 ? new Float32Array(totalPositions) : null;
    const mergedUvs = totalUvs > 0 ? new Float32Array((totalPositions / 3) * 2) : null;
    const mergedIndices = new (totalPositions / 3 > 65535 ? Uint32Array : Uint16Array)(totalIndices);

    let posOffset = 0;
    let normalOffset = 0;
    let uvOffset = 0;
    let indexOffset = 0;
    let vertexCountAccum = 0;

    for (let i = 0; i < geometries.length; i++) {
      const g = geometries[i];
      if (!g || !g.attributes || !g.attributes.position) continue;

      const pArr = g.attributes.position.array;
      mergedPositions.set(pArr, posOffset);

      if (mergedNormals) {
        if (g.attributes.normal) {
          mergedNormals.set(g.attributes.normal.array, normalOffset);
        } else {
          // If normals missing, fill with default UP (0, 1, 0)
          for (let k = 0; k < pArr.length; k += 3) {
            mergedNormals[normalOffset + k] = 0;
            mergedNormals[normalOffset + k + 1] = 1;
            mergedNormals[normalOffset + k + 2] = 0;
          }
        }
      }

      if (mergedUvs) {
        if (g.attributes.uv) {
          mergedUvs.set(g.attributes.uv.array, uvOffset);
        } else {
          // Fill default UV 0,0
          const uvLen = (pArr.length / 3) * 2;
          for (let k = 0; k < uvLen; k++) {
            mergedUvs[uvOffset + k] = 0;
          }
        }
      }

      const vCount = pArr.length / 3;
      if (g.index) {
        const idxArr = g.index.array;
        for (let j = 0; j < idxArr.length; j++) {
          mergedIndices[indexOffset + j] = idxArr[j] + vertexCountAccum;
        }
        indexOffset += idxArr.length;
      } else {
        for (let j = 0; j < vCount; j++) {
          mergedIndices[indexOffset + j] = j + vertexCountAccum;
        }
        indexOffset += vCount;
      }

      vertexCountAccum += vCount;
      posOffset += pArr.length;
      normalOffset += pArr.length;
      uvOffset += (vCount * 2);
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
    if (mergedNormals) merged.setAttribute('normal', new THREE.BufferAttribute(mergedNormals, 3));
    if (mergedUvs) merged.setAttribute('uv', new THREE.BufferAttribute(mergedUvs, 2));
    merged.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
    merged.computeVertexNormals();

    return merged;
  }

  // ============================================================================
  // 2. POLYLINE TANGENT & NORMAL COMPUTATION WITH CLAMPED MITERING
  // ============================================================================
  function computePolylineNormals(points) {
    const N = points.length;
    const normals = new Array(N);
    const miters = new Array(N);

    for (let i = 0; i < N; i++) {
      let tx = 0;
      let tz = 0;

      if (i === 0) {
        tx = points[1].x - points[0].x;
        tz = points[1].z - points[0].z;
      } else if (i === N - 1) {
        tx = points[N - 1].x - points[N - 2].x;
        tz = points[N - 1].z - points[N - 2].z;
      } else {
        const d1x = points[i].x - points[i - 1].x;
        const d1z = points[i].z - points[i - 1].z;
        const l1 = Math.hypot(d1x, d1z) || 1.0;

        const d2x = points[i + 1].x - points[i].x;
        const d2z = points[i + 1].z - points[i].z;
        const l2 = Math.hypot(d2x, d2z) || 1.0;

        tx = (d1x / l1) + (d2x / l2);
        tz = (d1z / l1) + (d2z / l2);
      }

      const tLen = Math.hypot(tx, tz) || 1.0;
      tx /= tLen;
      tz /= tLen;

      // Normal perpendicular to tangent in horizontal plane (XZ)
      const nx = -tz;
      const nz = tx;
      normals[i] = { x: nx, z: nz };

      // Clamped miter factor on turns
      if (i > 0 && i < N - 1) {
        const d1x = points[i].x - points[i - 1].x;
        const d1z = points[i].z - points[i - 1].z;
        const l1 = Math.hypot(d1x, d1z) || 1.0;
        const segNx = -d1z / l1;
        const segNz = d1x / l1;
        const dot = nx * segNx + nz * segNz;
        miters[i] = Math.min(Math.max(1.0 / Math.max(dot, 0.5), 1.0), 2.0);
      } else {
        miters[i] = 1.0;
      }
    }

    return { normals, miters };
  }

  // ============================================================================
  // 3. PROCEDURAL FACADE TEXTURE FACTORY & NIGHT WINDOW EMISSIVES
  // ============================================================================
  class FacadeTextureFactory {
    static createFacadeTexture(type = 'commercial') {
      if (typeof document === 'undefined') return null;

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');

      if (type === 'commercial') {
        // Modern reflective glass curtain wall
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 256, 256);

        const cols = 4;
        const rows = 4;
        const cw = 256 / cols;
        const rh = 256 / rows;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = '#0284c7';
            ctx.fillRect(c * cw + 4, r * rh + 5, cw - 8, rh - 10);

            // Specular sheen gradient
            const grad = ctx.createLinearGradient(c * cw, r * rh, c * cw + cw, r * rh + rh);
            grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.45)');
            grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.05)');
            grad.addColorStop(1.0, 'rgba(15, 23, 42, 0.65)');
            ctx.fillStyle = grad;
            ctx.fillRect(c * cw + 4, r * rh + 5, cw - 8, rh - 10);
          }
        }
      } else if (type === 'heritage') {
        // Vidhana Soudha carved grey granite ashlar
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(0, 0, 256, 256);

        // Horizontal carved stone courses
        ctx.fillStyle = '#64748b';
        for (let y = 0; y < 256; y += 64) {
          ctx.fillRect(0, y, 256, 4);
        }

        // Stone arched niches & deep windows
        ctx.fillStyle = '#334155';
        for (let c = 0; c < 4; c++) {
          for (let r = 0; r < 4; r++) {
            ctx.fillRect(c * 64 + 16, r * 64 + 18, 32, 38);
          }
        }
      } else if (type === 'civic') {
        // High Court Attara Kacheri classical terracotta red brick with white columns
        ctx.fillStyle = '#991b1b';
        ctx.fillRect(0, 0, 256, 256);

        // White classical pilasters & cornices
        ctx.fillStyle = '#f8fafc';
        for (let c = 0; c <= 4; c++) {
          ctx.fillRect(c * 64 - 3, 0, 6, 256);
        }
        for (let r = 0; r <= 4; r++) {
          ctx.fillRect(0, r * 64 - 4, 256, 8);
        }

        // Dark recessed windows
        ctx.fillStyle = '#1c1917';
        for (let c = 0; c < 4; c++) {
          for (let r = 0; r < 4; r++) {
            ctx.fillRect(c * 64 + 16, r * 64 + 14, 32, 40);
          }
        }
      } else if (type === 'hospital') {
        // Clean sterile off-white clinical stucco with emergency green accent belt
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, 256, 256);

        // Emerald hospital identity horizontal band
        ctx.fillStyle = '#059669';
        ctx.fillRect(0, 115, 256, 26);

        // Patient ward windows
        ctx.fillStyle = '#0f172a';
        for (let c = 0; c < 4; c++) {
          for (let r = 0; r < 4; r++) {
            if (r === 2) continue; // Beltline row
            ctx.fillRect(c * 64 + 12, r * 64 + 14, 40, 36);
          }
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }

    static createNightEmissiveTexture(type = 'commercial') {
      if (typeof document === 'undefined') return null;

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');

      // Unlit background (pitch black walls)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 256, 256);

      const cols = 4;
      const rows = 4;
      const cw = 256 / cols;
      const rh = 256 / rows;

      // Deterministic pseudo-random window distribution based on facade type
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const pseudoRand = Math.sin((r * 17.1 + c * 31.7) * 43758.5453) * 0.5 + 0.5;
          if (pseudoRand > 0.42) {
            // Warm interior lighting vs cool monitor glow
            ctx.fillStyle = (pseudoRand > 0.70) ? '#fef08a' : '#a5f3fc';
            ctx.fillRect(c * cw + 6, r * rh + 8, cw - 12, rh - 16);
          }
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }
  }

  // ============================================================================
  // 4. ROAD GEOMETRY BUILDER (ASPHALT, CURBS, SIDEWALKS, MARKINGS)
  // ============================================================================
  class RoadGeometryBuilder {
    /**
     * Builds paved asphalt ribbon geometry for multi-lane road polyline.
     */
    static buildAsphaltGeometry(points, lanes) {
      const N = points.length;
      const roadWidth = lanes * 3.5; // IRC standards: 2=7m, 4=14m, 6=21m
      const halfW = roadWidth / 2.0;

      const { normals, miters } = computePolylineNormals(points);

      const positions = [];
      const uvs = [];
      const indices = [];

      let accumDist = 0.0;

      for (let i = 0; i < N; i++) {
        if (i > 0) {
          const dx = points[i].x - points[i - 1].x;
          const dy = points[i].y - points[i - 1].y;
          const dz = points[i].z - points[i - 1].z;
          accumDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        const p = points[i];
        const n = normals[i];
        const m = miters[i];

        const leftX = p.x + n.x * (halfW * m);
        const leftZ = p.z + n.z * (halfW * m);
        const rightX = p.x - n.x * (halfW * m);
        const rightZ = p.z - n.z * (halfW * m);
        const y = 0.0; // FIXED: Road deck at exactly y=0.0; ground plane is at y=-0.3

        positions.push(leftX, y, leftZ);
        uvs.push(0.0, accumDist / 10.0);

        positions.push(rightX, y, rightZ);
        uvs.push(1.0, accumDist / 10.0);

        if (i < N - 1) {
          const v0 = 2 * i;
          const v1 = 2 * i + 1;
          const v2 = 2 * (i + 1);
          const v3 = 2 * (i + 1) + 1;

          indices.push(v0, v1, v2);
          indices.push(v1, v3, v2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    /**
     * Builds 3D concrete curbs with 15cm step risers flanking both sides of the road.
     */
    static buildCurbsGeometry(points, lanes) {
      const N = points.length;
      const halfW = (lanes * 3.5) / 2.0;
      const curbW = 0.25;
      const curbH = 0.15;

      const { normals, miters } = computePolylineNormals(points);

      const positions = [];
      const indices = [];

      for (let side = -1; side <= 1; side += 2) {
        const baseIdx = positions.length / 3;

        for (let i = 0; i < N; i++) {
          const p = points[i];
          const n = normals[i];
          const m = miters[i];

          const innerDist = side * halfW * m;
          const outerDist = side * (halfW + curbW) * m;

          const innerX = p.x + n.x * innerDist;
          const innerZ = p.z + n.z * innerDist;
          const outerX = p.x + n.x * outerDist;
          const outerZ = p.z + n.z * outerDist;

          const yBottom = 0.0; // FIXED: Road deck at y=0.0
          const yTop = curbH;  // 0.15m curb height

          // 3 vertices per polyline step for curb:
          // 0: Bottom inner riser
          // 1: Top inner riser
          // 2: Top outer tread
          positions.push(innerX, yBottom, innerZ);
          positions.push(innerX, yTop, innerZ);
          positions.push(outerX, yTop, outerZ);
        }

        for (let i = 0; i < N - 1; i++) {
          const v0 = baseIdx + i * 3;
          const v1 = baseIdx + (i + 1) * 3;

          // Vertical curb riser face
          indices.push(v0, v0 + 1, v1);
          indices.push(v0 + 1, v1 + 1, v1);

          // Horizontal curb top tread face
          indices.push(v0 + 1, v0 + 2, v1 + 1);
          indices.push(v0 + 2, v1 + 2, v1 + 1);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    /**
     * Builds 2.0m wide pedestrian sidewalks elevated at curb height (+0.15m).
     */
    static buildSidewalksGeometry(points, lanes) {
      const N = points.length;
      const halfW = (lanes * 3.5) / 2.0;
      const curbW = 0.25;
      const walkW = 2.0;

      const { normals, miters } = computePolylineNormals(points);

      const positions = [];
      const uvs = [];
      const indices = [];

      for (let side = -1; side <= 1; side += 2) {
        const baseIdx = positions.length / 3;
        let accumDist = 0.0;

        for (let i = 0; i < N; i++) {
          if (i > 0) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            const dz = points[i].z - points[i - 1].z;
            accumDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }

          const p = points[i];
          const n = normals[i];
          const m = miters[i];

          const innerDist = side * (halfW + curbW) * m;
          const outerDist = side * (halfW + curbW + walkW) * m;

          const innerX = p.x + n.x * innerDist;
          const innerZ = p.z + n.z * innerDist;
          const outerX = p.x + n.x * outerDist;
          const outerZ = p.z + n.z * outerDist;
          const y = 0.15; // FIXED: Sidewalk at curb top level (y=0.15)

          positions.push(innerX, y, innerZ);
          uvs.push(0.0, accumDist / 2.0);

          positions.push(outerX, y, outerZ);
          uvs.push(1.0, accumDist / 2.0);
        }

        for (let i = 0; i < N - 1; i++) {
          const v0 = baseIdx + 2 * i;
          const v1 = baseIdx + 2 * i + 1;
          const v2 = baseIdx + 2 * (i + 1);
          const v3 = baseIdx + 2 * (i + 1) + 1;

          indices.push(v0, v1, v2);
          indices.push(v1, v3, v2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    /**
     * Builds dashed lane dividers, yellow centerlines, and approach stop bars.
     */
    static buildMarkingsGeometry(points, lanes, oneway) {
      const whitePositions = [];
      const whiteIndices = [];
      const yellowPositions = [];
      const yellowIndices = [];

      const halfW = (lanes * 3.5) / 2.0;
      const stripeW = 0.15;
      const dashLen = 3.0;
      const gapLen = 3.0;
      const cycle = dashLen + gapLen;

      const { normals, miters } = computePolylineNormals(points);

      // 1. Centerline: Double solid yellow lines on 2-way roads
      if (!oneway) {
        for (let side = -1; side <= 1; side += 2) {
          const offset = side * 0.12; // 12cm separation from center
          const baseIdx = yellowPositions.length / 3;

          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const n = normals[i];
            const m = miters[i];

            const lx = p.x + n.x * (offset - stripeW / 2) * m;
            const lz = p.z + n.z * (offset - stripeW / 2) * m;
            const rx = p.x + n.x * (offset + stripeW / 2) * m;
            const rz = p.z + n.z * (offset + stripeW / 2) * m;
            const y = 0.04; // FIXED: Yellow centerlines at y=0.04 (4cm above road deck at y=0.0)

            yellowPositions.push(lx, y, lz, rx, y, rz);
          }

          for (let i = 0; i < points.length - 1; i++) {
            const v0 = baseIdx + 2 * i;
            const v1 = baseIdx + 2 * i + 1;
            const v2 = baseIdx + 2 * (i + 1);
            const v3 = baseIdx + 2 * (i + 1) + 1;

            yellowIndices.push(v0, v1, v2, v1, v3, v2);
          }
        }
      }

      // 2. Dashed white lane dividers
      const laneOffsets = [];
      if (lanes === 4) {
        laneOffsets.push(-3.5, 3.5);
      } else if (lanes === 6) {
        laneOffsets.push(-7.0, -3.5, 3.5, 7.0);
      }

      for (let seg = 0; seg < points.length - 1; seg++) {
        const p1 = points[seg];
        const p2 = points[seg + 1];
        const segDx = p2.x - p1.x;
        const segDz = p2.z - p1.z;
        const segLen = Math.hypot(segDx, segDz) || 1.0;
        const dirX = segDx / segLen;
        const dirZ = segDz / segLen;
        const normX = -dirZ;
        const normZ = dirX;

        for (const off of laneOffsets) {
          let cur = 1.0;
          while (cur + dashLen <= segLen) {
            const startX = p1.x + dirX * cur + normX * off;
            const startZ = p1.z + dirZ * cur + normZ * off;
            const endX = p1.x + dirX * (cur + dashLen) + normX * off;
            const endZ = p1.z + dirZ * (cur + dashLen) + normZ * off;
            const y = 0.04; // FIXED: Lane dividers at y=0.04 (4cm above road deck at y=0.0)

            const baseIdx = whitePositions.length / 3;

            const v0x = startX + normX * (stripeW / 2);
            const v0z = startZ + normZ * (stripeW / 2);
            const v1x = startX - normX * (stripeW / 2);
            const v1z = startZ - normZ * (stripeW / 2);

            const v2x = endX + normX * (stripeW / 2);
            const v2z = endZ + normZ * (stripeW / 2); // FIXED: was endX, should be endZ
            const v3x = endX - normX * (stripeW / 2);
            const v3z = endZ - normZ * (stripeW / 2); // FIXED: was endX, should be endZ

            whitePositions.push(v0x, y, v0z, v1x, y, v1z, v2x, y, v2z, v3x, y, v3z);
            whiteIndices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx + 1, baseIdx + 3, baseIdx + 2);

            cur += cycle;
          }
        }

        // Stop Bar at segment end (inbound lane crossbar 5m before junction)
        const stopDist = Math.max(0, segLen - 5.0);
        const stopCenterX = p1.x + dirX * stopDist;
        const stopCenterZ = p1.z + dirZ * stopDist;
        const stopBaseIdx = whitePositions.length / 3;
        const barThickness = 0.45;

        const barStartX = stopCenterX + normX * 0.2;
        const barStartZ = stopCenterZ + normZ * 0.2;
        const barEndX = stopCenterX + normX * (halfW - 0.2);
        const barEndZ = stopCenterZ + normZ * (halfW - 0.2);
        const yStop = 0.08; // FIXED: Stop bars at y=0.08 (8cm above road deck at y=0.0)

        const s0x = barStartX - dirX * (barThickness / 2);
        const s0z = barStartZ - dirZ * (barThickness / 2);
        const s1x = barStartX + dirX * (barThickness / 2);
        const s1z = barStartZ + dirZ * (barThickness / 2);

        const s2x = barEndX - dirX * (barThickness / 2);
        const s2z = barEndZ - dirZ * (barThickness / 2);
        const s3x = barEndX + dirX * (barThickness / 2);
        const s3z = barEndZ + dirZ * (barThickness / 2);

        whitePositions.push(s0x, yStop, s0z, s1x, yStop, s1z, s2x, yStop, s2z, s3x, yStop, s3z);
        whiteIndices.push(stopBaseIdx, stopBaseIdx + 1, stopBaseIdx + 2, stopBaseIdx + 1, stopBaseIdx + 3, stopBaseIdx + 2);
      }

      const whiteGeo = new THREE.BufferGeometry();
      if (whitePositions.length > 0) {
        whiteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(whitePositions), 3));
        whiteGeo.setIndex(whiteIndices);
        whiteGeo.computeVertexNormals();
      }

      const yellowGeo = new THREE.BufferGeometry();
      if (yellowPositions.length > 0) {
        yellowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(yellowPositions), 3));
        yellowGeo.setIndex(yellowIndices);
        yellowGeo.computeVertexNormals();
      }

      return { whiteGeo, yellowGeo };
    }
  }

  // ============================================================================
  // 5. LANDMARK DEFINITIONS & ARTICULATED ARCHITECTURE
  // ============================================================================
  const LANDMARK_DEFINITIONS = [
    {
      id: 'vidhana_soudha',
      name: 'Vidhana Soudha (Karnataka State Legislature)',
      facadeType: 'heritage',
      center: [-419.0, -890.7],
      baseWidth: 180.0,
      baseDepth: 110.0,
      height: 38.0,
      hasDome: true,
      domeRadius: 16.0,
      domeHeight: 22.0
    },
    {
      id: 'high_court',
      name: 'Karnataka High Court (Attara Kacheri)',
      facadeType: 'civic',
      center: [-350.0, -850.0],
      baseWidth: 140.0,
      baseDepth: 70.0,
      height: 22.0,
      hasDome: false
    },
    {
      id: 'victoria_hospital',
      name: 'Victoria Hospital Trauma & Emergency Complex',
      facadeType: 'hospital',
      center: [-2165.5, 979.5],
      baseWidth: 90.0,
      baseDepth: 65.0,
      height: 30.0,
      hasDome: false
    },
    {
      id: 'bowring_hospital',
      name: 'Bowring and Lady Curzon Hospital',
      facadeType: 'hospital',
      center: [882.7, -1258.1],
      baseWidth: 85.0,
      baseDepth: 60.0,
      height: 25.0,
      hasDome: false
    },
    {
      id: 'kr_market',
      name: 'K.R. Market Wholesale Terminal & Flyover Concourse',
      facadeType: 'commercial',
      center: [-1959.4, 645.5],
      baseWidth: 120.0,
      baseDepth: 95.0,
      height: 20.0,
      hasDome: false
    },
    {
      id: 'town_hall',
      name: 'Sir Puttanna Chetty Town Hall',
      facadeType: 'civic',
      center: [-760.0, 580.0],
      baseWidth: 55.0,
      baseDepth: 38.0,
      height: 18.0,
      hasDome: false
    },
    {
      id: 'ub_city_tower',
      name: 'UB City Skyscraper Towers',
      facadeType: 'commercial',
      center: [125.0, 105.0],
      baseWidth: 48.0,
      baseDepth: 48.0,
      height: 85.0,
      hasDome: false
    },
    {
      id: 'mallya_hospital',
      name: 'Mallya Hospital Emergency Center',
      facadeType: 'hospital',
      center: [100.0, 125.0],
      baseWidth: 55.0,
      baseDepth: 42.0,
      height: 28.0,
      hasDome: false
    },
    {
      id: 'st_marthas_hospital',
      name: "St. Martha's Hospital",
      facadeType: 'hospital',
      center: [-787.8, 155.7],
      baseWidth: 70.0,
      baseDepth: 50.0,
      height: 24.0,
      hasDome: false
    },
    {
      id: 'mysore_bank_heritage',
      name: 'Mysore Bank Heritage Building',
      facadeType: 'heritage',
      center: [-1417.0, -211.7],
      baseWidth: 55.0,
      baseDepth: 45.0,
      height: 22.0,
      hasDome: false
    },
    {
      id: 'lic_building',
      name: 'LIC Building (MG Road)',
      facadeType: 'commercial',
      center: [1078.0, -356.4],
      baseWidth: 42.0,
      baseDepth: 32.0,
      height: 52.0,
      hasDome: false
    },
    {
      id: 'majestic_transit_hub',
      name: 'Majestic KSR & BMTC Transit Terminal',
      facadeType: 'commercial',
      center: [-2349.9, -690.3],
      baseWidth: 160.0,
      baseDepth: 75.0,
      height: 24.0,
      hasDome: false
    }
  ];

  // ============================================================================
  // 6. PROCEDURAL BUILDING GEOMETRY BUILDER
  // ============================================================================
  class BuildingGeometryBuilder {
    static createBoxBuildingGeometry(cx, cz, width, depth, height, angle = 0.0) {
      const geo = new THREE.BoxGeometry(width, height, depth);
      geo.translate(0, height / 2, 0); // Reposition pivot to base Y=0

      if (angle !== 0.0) {
        geo.rotateY(angle);
      }

      geo.translate(cx, 0, cz);
      return geo;
    }

    /**
     * Builds procedural buildings flanking both sides of the road corridor network.
     * FIXED: Enforces minimum clearance from road centerline (roadHalfWidth + 6m).
     * Uses clean low-profile context blocks instead of uniform tall cubes.
     * Hospital complexes are handled separately.
     */
    static buildCorridorBuildings(roadFeatures, projection) {
      const geometriesByClass = {
        commercial: [],
        heritage: [],
        civic: [],
        hospital: []
      };
      const rooftopGeometries = [];

      // Collect all road segments for spatial clearance checking
      const roadSegments = [];
      for (const feat of roadFeatures) {
        const coords = feat.geometry.coordinates;
        const lanes = feat.properties.lanes || 4;
        const roadW = lanes * 3.5;
        const halfW = roadW / 2.0;
        const pts = coords.map(c => projection.latLonAltToCartesian(c[1], c[0], c[2]));
        for (let i = 0; i < pts.length - 1; i++) {
          roadSegments.push({
            p1: pts[i],
            p2: pts[i + 1],
            halfW: halfW,
            lanes: lanes
          });
        }
      }

      // Minimum clearance from road centerline = roadHalfWidth + 6m (task requirement)
      const MIN_CLEARANCE_FACTOR = 1.0; // We'll add 6m to halfW

      for (const feat of roadFeatures) {
        const coords = feat.geometry.coordinates;
        const lanes = feat.properties.lanes || 4;
        const roadW = lanes * 3.5;
        const halfW = roadW / 2.0;

        const pts = coords.map(c => projection.latLonAltToCartesian(c[1], c[0], c[2]));

        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const segDx = p2.x - p1.x;
          const segDz = p2.z - p1.z;
          const segLen = Math.hypot(segDx, segDz);
          if (segLen < 30.0) continue; // Skip very short segments

          const dirX = segDx / segLen;
          const dirZ = segDz / segLen;
          const normX = -dirZ;
          const normZ = dirX;
          const roadAngle = Math.atan2(dirX, dirZ);

          // FIXED: Larger step (80m) for lower building density, cleaner look
          const step = 80.0;
          let cur = 20.0;

          while (cur + 40.0 < segLen) {
            const midX = p1.x + dirX * cur;
            const midZ = p1.z + dirZ * cur;

            // FIXED: Smaller, lower buildings for clean context
            const bWidth = 24.0 + (Math.random() * 16);  // 24-40m
            const bDepth = 18.0 + (Math.random() * 12);  // 18-30m

            // Height and facade class based on road tier - MUCH LOWER
            let bHeight = 8.0 + (Math.random() * 10);  // 8-18m (was 12-60m)
            let facadeClass = 'heritage';

            if (lanes >= 6) {
              bHeight = 15.0 + (Math.random() * 20); // 15-35m
              facadeClass = 'commercial';
            } else if (lanes === 4) {
              bHeight = 10.0 + (Math.random() * 15); // 10-25m
              facadeClass = (Math.random() < 0.3) ? 'civic' : 'commercial';
            } else {
              bHeight = 8.0 + (Math.random() * 10);  // 8-18m
              facadeClass = 'heritage';
            }

            // FIXED: Minimum clearance = roadHalfWidth + 6m (safety buffer from road)
            const minClearance = halfW + 6.0;
            // Setback = clearance + sidewalk (2m) + curb (0.25m) + half building depth
            const setbackDist = minClearance + 2.25 + bDepth / 2.0;

            // Check left side clearance against ALL road segments
            const leftX = midX + normX * setbackDist;
            const leftZ = midZ + normZ * setbackDist;
            if (this._checkBuildingClearance(leftX, leftZ, bWidth, bDepth, roadAngle, roadSegments, halfW)) {
              geometriesByClass[facadeClass].push(
                this.createBoxBuildingGeometry(leftX, leftZ, bWidth, bDepth, bHeight, roadAngle)
              );
              // Rooftop structures
              const roofBox = new THREE.BoxGeometry(bWidth * 0.35, 2.5, bDepth * 0.35);
              roofBox.translate(leftX, bHeight + 1.25, leftZ);
              rooftopGeometries.push(roofBox);
            }

            // Check right side clearance
            const rightX = midX - normX * setbackDist;
            const rightZ = midZ - normZ * setbackDist;
            if (this._checkBuildingClearance(rightX, rightZ, bWidth, bDepth, roadAngle, roadSegments, halfW)) {
              geometriesByClass[facadeClass].push(
                this.createBoxBuildingGeometry(rightX, rightZ, bWidth, bDepth, bHeight, roadAngle)
              );
              // Rooftop structures
              const roofBox = new THREE.BoxGeometry(bWidth * 0.35, 2.5, bDepth * 0.35);
              roofBox.translate(rightX, bHeight + 1.25, rightZ);
              rooftopGeometries.push(roofBox);
            }

            cur += step;
          }
        }
      }

      return { geometriesByClass, rooftopGeometries };
    }

    /**
     * Checks if a building at (x,z) with given dimensions and rotation
     * has sufficient clearance from ALL road segments.
     * Returns true if safe to place, false if too close to any road.
     */
    static _checkBuildingClearance(bx, bz, bw, bd, angle, roadSegments, currentRoadHalfW) {
      // Building corner offsets in local space (before rotation)
      const hw = bw / 2;
      const hd = bd / 2;
      const corners = [
        { x: -hw, z: -hd },
        { x: hw, z: -hd },
        { x: hw, z: hd },
        { x: -hw, z: hd }
      ];

      // Rotate corners by road angle
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const worldCorners = corners.map(c => ({
        x: bx + c.x * cosA - c.z * sinA,
        z: bz + c.x * sinA + c.z * cosA
      }));

      // Check each corner against all road segments
      for (const corner of worldCorners) {
        for (const seg of roadSegments) {
          // Skip checking against the current road segment we're building alongside
          // (we're already at the correct setback from this road)
          if (seg.halfW === currentRoadHalfW) {
            // Still need to check distance to THIS road segment's centerline
            const distToSeg = this._pointToSegmentDistance(corner.x, corner.z, seg.p1.x, seg.p1.z, seg.p2.x, seg.p2.z);
            if (distToSeg < seg.halfW + 6.0) {
              return false; // Too close to this road
            }
          } else {
            // Check distance to OTHER road segments
            const distToSeg = this._pointToSegmentDistance(corner.x, corner.z, seg.p1.x, seg.p1.z, seg.p2.x, seg.p2.z);
            if (distToSeg < seg.halfW + 6.0) {
              return false; // Too close to another road
            }
          }
        }
      }
      return true;
    }

    /**
     * Distance from point to line segment.
     */
    static _pointToSegmentDistance(px, pz, x1, z1, x2, z2) {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len2 = dx * dx + dz * dz;
      if (len2 === 0) return Math.hypot(px - x1, pz - z1);
      let t = ((px - x1) * dx + (pz - z1) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const projX = x1 + t * dx;
      const projZ = z1 + t * dz;
      return Math.hypot(px - projX, pz - projZ);
    }
  }

  // ============================================================================
  // 7. MATERIAL PALETTE FACTORY
  // ============================================================================
  function createEnvironmentMaterials() {
    const commTexture = FacadeTextureFactory.createFacadeTexture('commercial');
    const commEmissive = FacadeTextureFactory.createNightEmissiveTexture('commercial');
    if (commTexture) {
      commTexture.repeat.set(4, 8);
      commEmissive.repeat.set(4, 8);
    }

    const heritageTexture = FacadeTextureFactory.createFacadeTexture('heritage');
    const heritageEmissive = FacadeTextureFactory.createNightEmissiveTexture('heritage');
    if (heritageTexture) {
      heritageTexture.repeat.set(4, 4);
      heritageEmissive.repeat.set(4, 4);
    }

    const civicTexture = FacadeTextureFactory.createFacadeTexture('civic');
    const civicEmissive = FacadeTextureFactory.createNightEmissiveTexture('civic');
    if (civicTexture) {
      civicTexture.repeat.set(4, 3);
      civicEmissive.repeat.set(4, 3);
    }

    const hospTexture = FacadeTextureFactory.createFacadeTexture('hospital');
    const hospEmissive = FacadeTextureFactory.createNightEmissiveTexture('hospital');
    if (hospTexture) {
      hospTexture.repeat.set(4, 4);
      hospEmissive.repeat.set(4, 4);
    }

    return {
      asphalt: new THREE.MeshStandardMaterial({
        color: 0x222428,
        roughness: 0.85,
        metalness: 0.08,
        name: 'asphalt'
      }),
      curb: new THREE.MeshStandardMaterial({
        color: 0x82878d,
        roughness: 0.90,
        metalness: 0.05,
        name: 'curb'
      }),
      sidewalk: new THREE.MeshStandardMaterial({
        color: 0x9ca3af,
        roughness: 0.88,
        metalness: 0.04,
        name: 'sidewalk'
      }),
      whiteMarkings: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.40,
        metalness: 0.10,
        emissive: 0x222222,
        name: 'whiteMarkings'
      }),
      yellowCenterline: new THREE.MeshStandardMaterial({
        color: 0xf5a623, // Amber-yellow
        roughness: 0.40,
        metalness: 0.10,
        emissive: 0x332200,
        name: 'yellowCenterline'
      }),
      buildingCommercial: new THREE.MeshStandardMaterial({
        map: commTexture,
        emissiveMap: commEmissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.0,
        roughness: 0.15,
        metalness: 0.85,
        name: 'buildingCommercial'
      }),
      buildingHeritage: new THREE.MeshStandardMaterial({
        map: heritageTexture,
        emissiveMap: heritageEmissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.0,
        roughness: 0.80,
        metalness: 0.05,
        name: 'buildingHeritage'
      }),
      buildingCivic: new THREE.MeshStandardMaterial({
        map: civicTexture,
        emissiveMap: civicEmissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.0,
        roughness: 0.85,
        metalness: 0.02,
        name: 'buildingCivic'
      }),
      buildingHospital: new THREE.MeshStandardMaterial({
        map: hospTexture,
        emissiveMap: hospEmissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.0,
        roughness: 0.70,
        metalness: 0.05,
        name: 'buildingHospital'
      }),
      rooftop: new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.90,
        metalness: 0.10,
        name: 'rooftop'
      })
    };
  }

  // ============================================================================
  // 8. MASTER ENVIRONMENT MANAGER CLASS
  // ============================================================================
  class EnvironmentManager {
    /**
     * @param {THREE.Scene} scene
     * @param {GeoProjection} projection
     */
    constructor(scene, projection) {
      this.scene = scene;
      this.projection = projection;
      this.materials = (typeof THREE !== 'undefined') ? createEnvironmentMaterials() : null;
      this.meshes = {};
      this.group = null;

      if (this.scene && this.projection) {
        this.build();
      }
    }

    /**
     * Builds and merges the 3D procedural environment from ROADS_DATA into <12 draw calls.
     */
    build() {
      let roadsData = null;
      if (typeof ROADS_DATA !== 'undefined') {
        roadsData = ROADS_DATA;
      } else if (typeof global !== 'undefined' && global.ROADS_DATA) {
        roadsData = global.ROADS_DATA;
      }

      if (!roadsData || !roadsData.features) {
        console.warn('EnvironmentManager: ROADS_DATA not found. Roads pending.');
        return null;
      }

      const group = new THREE.Group();
      group.name = 'EnvironmentGroup';

      const asphaltGeos = [];
      const curbGeos = [];
      const sidewalkGeos = [];
      const whiteMarkingGeos = [];
      const yellowCenterlineGeos = [];

      // 1. Process All Road Corridors
      for (const feat of roadsData.features) {
        const coords = feat.geometry.coordinates;
        const lanes = feat.properties.lanes || 4;
        const oneway = feat.properties.oneway || false;

        const pts = coords.map(c => this.projection.latLonAltToCartesian(c[1], c[0], c[2]));

        // Asphalt ribbon
        asphaltGeos.push(RoadGeometryBuilder.buildAsphaltGeometry(pts, lanes));

        // Curbs
        curbGeos.push(RoadGeometryBuilder.buildCurbsGeometry(pts, lanes));

        // Sidewalks
        sidewalkGeos.push(RoadGeometryBuilder.buildSidewalksGeometry(pts, lanes));

        // Markings
        const { whiteGeo, yellowGeo } = RoadGeometryBuilder.buildMarkingsGeometry(pts, lanes, oneway);
        if (whiteGeo.attributes.position && whiteGeo.attributes.position.count > 0) {
          whiteMarkingGeos.push(whiteGeo);
        }
        if (yellowGeo.attributes.position && yellowGeo.attributes.position.count > 0) {
          yellowCenterlineGeos.push(yellowGeo);
        }
      }

      // 2. Process Buildings & Parcels
      const { geometriesByClass, rooftopGeometries } = BuildingGeometryBuilder.buildCorridorBuildings(
        roadsData.features,
        this.projection
      );

      // Add 12 Landmark Buildings into their respective facade classes
      for (const lm of LANDMARK_DEFINITIONS) {
        const geo = BuildingGeometryBuilder.createBoxBuildingGeometry(
          lm.center[0],
          lm.center[1],
          lm.baseWidth,
          lm.baseDepth,
          lm.height
        );
        geometriesByClass[lm.facadeType].push(geo);

        if (lm.hasDome) {
          const domeGeo = new THREE.CylinderGeometry(lm.domeRadius * 0.7, lm.domeRadius, lm.domeHeight, 16);
          domeGeo.translate(lm.center[0], lm.height + lm.domeHeight / 2, lm.center[1]);
          geometriesByClass[lm.facadeType].push(domeGeo);
        }
      }

      // 3. Buffer Geometry Merging for Locked 60 FPS
      if (asphaltGeos.length > 0) {
        const mergedAsphalt = mergeBufferGeometriesSafe(asphaltGeos);
        if (mergedAsphalt) {
          this.meshes.asphalt = new THREE.Mesh(mergedAsphalt, this.materials.asphalt);
          this.meshes.asphalt.receiveShadow = true;
          group.add(this.meshes.asphalt);
        }
      }

      if (curbGeos.length > 0) {
        const mergedCurbs = mergeBufferGeometriesSafe(curbGeos);
        if (mergedCurbs) {
          this.meshes.curbs = new THREE.Mesh(mergedCurbs, this.materials.curb);
          this.meshes.curbs.receiveShadow = true;
          this.meshes.curbs.castShadow = true;
          group.add(this.meshes.curbs);
        }
      }

      if (sidewalkGeos.length > 0) {
        const mergedSidewalks = mergeBufferGeometriesSafe(sidewalkGeos);
        if (mergedSidewalks) {
          this.meshes.sidewalks = new THREE.Mesh(mergedSidewalks, this.materials.sidewalk);
          this.meshes.sidewalks.receiveShadow = true;
          group.add(this.meshes.sidewalks);
        }
      }

      if (whiteMarkingGeos.length > 0) {
        const mergedWhite = mergeBufferGeometriesSafe(whiteMarkingGeos);
        if (mergedWhite) {
          this.meshes.whiteMarkings = new THREE.Mesh(mergedWhite, this.materials.whiteMarkings);
          group.add(this.meshes.whiteMarkings);
        }
      }

      if (yellowCenterlineGeos.length > 0) {
        const mergedYellow = mergeBufferGeometriesSafe(yellowCenterlineGeos);
        if (mergedYellow) {
          this.meshes.yellowCenterlines = new THREE.Mesh(mergedYellow, this.materials.yellowCenterline);
          group.add(this.meshes.yellowCenterlines);
        }
      }

      // Merged Buildings (1 draw call per facade class = 4 draw calls total)
      const facadeMapping = {
        commercial: this.materials.buildingCommercial,
        heritage: this.materials.buildingHeritage,
        civic: this.materials.buildingCivic,
        hospital: this.materials.buildingHospital
      };

      for (const [fType, geos] of Object.entries(geometriesByClass)) {
        if (geos.length > 0) {
          const merged = mergeBufferGeometriesSafe(geos);
          if (merged) {
            const mesh = new THREE.Mesh(merged, facadeMapping[fType]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.meshes[`building_${fType}`] = mesh;
            group.add(mesh);
          }
        }
      }

      if (rooftopGeometries.length > 0) {
        const mergedRoof = mergeBufferGeometriesSafe(rooftopGeometries);
        if (mergedRoof) {
          this.meshes.rooftops = new THREE.Mesh(mergedRoof, this.materials.rooftop);
          this.meshes.rooftops.castShadow = true;
          group.add(this.meshes.rooftops);
        }
      }

      // 4. Ground Terrain Plane (Base Bengaluru terrain) - LOWERED to y=-0.3 to prevent z-fighting with roads at y=0.02
      const groundGeo = new THREE.PlaneGeometry(8000, 6000);
      groundGeo.rotateX(-Math.PI / 2);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x141820,
        roughness: 0.95,
        metalness: 0.05,
        name: 'ground'
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.position.y = -0.3; // FIXED: Lowered from -0.05 to -0.3 for proper vertical layering
      ground.receiveShadow = true;
      group.add(ground);
      this.meshes.ground = ground;

      this.group = group;
      this.scene.add(group);

      console.log(`EnvironmentManager: Environment successfully built and merged into ${group.children.length} draw calls.`);
      return group;
    }

    /**
     * Called by AtmosphereController to update wet-asphalt shader reflections during rain.
     * @param {number} rainIntensity - [0..1]
     */
    setWetAsphalt(rainIntensity) {
      if (!this.materials || !this.materials.asphalt) return;

      const baseRoughness = 0.85;
      const wetRoughness = 0.16;
      const baseMetalness = 0.08;
      const wetMetalness = 0.45;

      this.materials.asphalt.roughness = THREE.MathUtils.lerp(baseRoughness, wetRoughness, rainIntensity);
      this.materials.asphalt.metalness = THREE.MathUtils.lerp(baseMetalness, wetMetalness, rainIntensity);
      this.materials.asphalt.needsUpdate = true;
    }

    /**
     * Called by AtmosphereController to modulate building window lights at dusk/night.
     * @param {number} nightFactor - [0..1] (0 = noon, 1 = midnight)
     */
    setNightFactor(nightFactor) {
      if (!this.materials) return;

      if (this.materials.buildingCommercial) this.materials.buildingCommercial.emissiveIntensity = nightFactor * 0.95;
      if (this.materials.buildingHeritage) this.materials.buildingHeritage.emissiveIntensity = nightFactor * 0.55;
      if (this.materials.buildingCivic) this.materials.buildingCivic.emissiveIntensity = nightFactor * 0.65;
      if (this.materials.buildingHospital) this.materials.buildingHospital.emissiveIntensity = nightFactor * 0.85;
    }
  }

  // Export classes
  EnvironmentManager.LANDMARK_DEFINITIONS = LANDMARK_DEFINITIONS;
  EnvironmentManager.RoadGeometryBuilder = RoadGeometryBuilder;
  EnvironmentManager.BuildingGeometryBuilder = BuildingGeometryBuilder;
  EnvironmentManager.FacadeTextureFactory = FacadeTextureFactory;

  return EnvironmentManager;
}));
