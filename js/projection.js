/**
 * js/projection.js
 * High-Precision WGS84 Geodetic to Three.js Cartesian (ENU) Transformer
 * Browser-global (window.GeoProjection) & CommonJS (Node.js) compatible.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GeoProjection = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // WGS84 Ellipsoid Geodetic Constants
  const WGS84_A = 6378137.0; // Semi-major axis (meters)
  const WGS84_F = 1.0 / 298.257223563; // Flattening
  const WGS84_B = WGS84_A * (1.0 - WGS84_F); // Semi-minor axis (6356752.3142m)
  const WGS84_E2 = 2.0 * WGS84_F - WGS84_F * WGS84_F; // First eccentricity squared (~0.00669438)
  const DEG2RAD = Math.PI / 180.0;
  const RAD2DEG = 180.0 / Math.PI;

  class GeoProjection {
    /**
     * @param {Object} [origin] - { lat: number, lon: number, alt: number }
     */
    constructor(origin) {
      const defaultOrigin = {
        lat: 12.9715987,
        lon: 77.5945627,
        alt: 920.0
      };
      const o = origin || (typeof CONFIG !== 'undefined' && CONFIG.GEO && CONFIG.GEO.origin ? CONFIG.GEO.origin : defaultOrigin);

      this.lat0 = o.lat;
      this.lon0 = o.lon;
      this.alt0 = o.alt !== undefined ? o.alt : 920.0;

      this.lat0Rad = this.lat0 * DEG2RAD;
      this.lon0Rad = this.lon0 * DEG2RAD;

      this.sinLat0 = Math.sin(this.lat0Rad);
      this.cosLat0 = Math.cos(this.lat0Rad);
      this.sinLon0 = Math.sin(this.lon0Rad);
      this.cosLon0 = Math.cos(this.lon0Rad);

      // Radii of curvature at reference latitude
      const denom = Math.sqrt(1.0 - WGS84_E2 * this.sinLat0 * this.sinLat0);
      this.N0 = WGS84_A / denom; // Prime vertical radius of curvature (~6379212.83m)
      this.M0 = (WGS84_A * (1.0 - WGS84_E2)) / (denom * denom * denom); // Meridian radius of curvature (~6339268.42m)

      // Origin coordinates in ECEF
      const originEcef = this.geodeticToEcef(this.lat0, this.lon0, this.alt0);
      this.ecef0X = originEcef.x;
      this.ecef0Y = originEcef.y;
      this.ecef0Z = originEcef.z;
    }

    /**
     * Convert WGS84 Geodetic (Lat, Lon, Alt) to ECEF Cartesian (X, Y, Z)
     */
    geodeticToEcef(lat, lon, alt) {
      const phi = lat * DEG2RAD;
      const lambda = lon * DEG2RAD;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const sinLambda = Math.sin(lambda);
      const cosLambda = Math.cos(lambda);

      const N = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinPhi * sinPhi);
      const h = alt !== undefined ? alt : this.alt0;

      return {
        x: (N + h) * cosPhi * cosLambda,
        y: (N + h) * cosPhi * sinLambda,
        z: (N * (1.0 - WGS84_E2) + h) * sinPhi
      };
    }

    /**
     * Standard ENU Tangent Plane Cartesian Projection.
     * Maps geodetic WGS84 coordinates into Three.js metric Cartesian space.
     * Three.js Convention:
     *   +X = East
     *   +Y = Elevation (Up)
     *   -Z = North (+Z = South)
     * Origin maps to (0, 0, 0).
     *
     * @param {number} lat - Latitude in degrees
     * @param {number} lon - Longitude in degrees
     * @param {number} [alt=920.0] - Altitude in meters MSL
     * @returns {{x: number, y: number, z: number}}
     */
    latLonAltToCartesian(lat, lon, alt = 920.0) {
      const dLon = (lon - this.lon0) * DEG2RAD;
      const dLat = (lat - this.lat0) * DEG2RAD;

      // Metric East and North distances on WGS84 sphere/ellipsoid
      const east = dLon * WGS84_A * this.cosLat0;
      const north = dLat * WGS84_A;
      const up = (alt !== undefined ? alt : this.alt0) - this.alt0;

      return {
        x: east,
        y: up,
        z: -north // In Three.js: -Z is North, +Z is South
      };
    }

    /**
     * Rigorous ECEF-to-ENU coordinate transformation
     */
    rigorousLatLonAltToCartesian(lat, lon, alt = 920.0) {
      const ecef = this.geodeticToEcef(lat, lon, alt);
      const dx = ecef.x - this.ecef0X;
      const dy = ecef.y - this.ecef0Y;
      const dz = ecef.z - this.ecef0Z;

      // Rotation from ECEF to local ENU frame
      const east = -this.sinLon0 * dx + this.cosLon0 * dy;
      const north = -this.sinLat0 * this.cosLon0 * dx - this.sinLat0 * this.sinLon0 * dy + this.cosLat0 * dz;
      const up = this.cosLat0 * this.cosLon0 * dx + this.cosLat0 * this.sinLon0 * dy + this.sinLat0 * dz;

      return {
        x: east,
        y: up,
        z: -north
      };
    }

    /**
     * Fast alias for tight simulation loops
     */
    fastLatLonToCartesian(lat, lon, alt = 920.0) {
      return this.latLonAltToCartesian(lat, lon, alt);
    }

    /**
     * Inverse Projection: Three.js Cartesian (X, Y, Z) back to WGS84 Geodetic (Lat, Lon, Alt)
     * @param {number} x - East meters
     * @param {number} y - Up meters
     * @param {number} z - South meters (-North)
     * @returns {{lat: number, lon: number, alt: number}}
     */
    cartesianToLatLonAlt(x, y, z) {
      const east = x;
      const north = -z;
      const up = y;

      const dLon = east / (WGS84_A * this.cosLat0);
      const dLat = north / WGS84_A;

      const lon = this.lon0 + (dLon * RAD2DEG);
      const lat = this.lat0 + (dLat * RAD2DEG);
      const alt = this.alt0 + up;

      return { lat, lon, alt };
    }

    /**
     * Convert geographic compass heading in degrees [0..360, 0=North, 90=East]
     * to Three.js Y-axis yaw angle in radians.
     */
    headingToYaw(headingDeg) {
      return -(headingDeg * DEG2RAD);
    }

    /**
     * Convert Three.js Y-axis yaw in radians to geographic compass heading in degrees [0..360]
     */
    yawToHeading(yawRad) {
      let deg = -yawRad * RAD2DEG;
      deg = ((deg % 360) + 360) % 360;
      return deg;
    }

    /**
     * Get forward direction vector in Three.js coordinates from heading in degrees
     */
    headingToVector(headingDeg) {
      const rad = headingDeg * DEG2RAD;
      return {
        x: Math.sin(rad),
        y: 0,
        z: -Math.cos(rad)
      };
    }

    /**
     * Compute 2D Euclidean distance in meters between two Cartesian points
     */
    distance2D(p1, p2) {
      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      return Math.hypot(dx, dz);
    }
  }

  return GeoProjection;
}));
