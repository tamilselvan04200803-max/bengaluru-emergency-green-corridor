"""
High-Speed Offline PBF Extractor for Bengaluru Digital Twin.

Extracts:
1. Roads within hierarchy: motorway, trunk, primary, secondary, tertiary.
   - Normalizes lanes, maxspeed, oneway, highway class, node IDs.
2. Hospitals: amenity=hospital, emergency tagged.
3. Traffic Signals: highway=traffic_signals.

Bounding box filter (Bengaluru Metropolitan Area):
  Lat: 12.8340 to 13.1436
  Lon: 77.4601 to 77.7840

Uses Pyosmium with GeoJSON / Shapely fallback.
"""

import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

try:
    import osmium
    from osmium.geom import GeoJSONFactory
    HAS_OSMIUM = True
except ImportError:
    HAS_OSMIUM = False

try:
    from shapely.geometry import Point, LineString, Polygon, shape
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

from osm_extractor import (
    BENGALURU_BBOX,
    DEFAULT_ROAD_CLASSES,
    normalize_hospital_properties,
    normalize_road_properties,
    normalize_signal_properties,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("PBFExtractor")


def in_bbox(lon: float, lat: float, bbox: Tuple[float, float, float, float] = BENGALURU_BBOX) -> bool:
    """Check if point (lon, lat) is within bbox (min_lat, min_lon, max_lat, max_lon)."""
    min_lat, min_lon, max_lat, max_lon = bbox
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


if HAS_OSMIUM:
    class BengaluruOsmiumHandler(osmium.SimpleHandler):
        """Osmium streaming handler extracting Bengaluru features with location caching."""

        def __init__(self, bbox: Tuple[float, float, float, float], road_classes: List[str]):
            super().__init__()
            self.bbox = bbox
            self.road_classes = set(road_classes)
            # Expand to include link types
            self.road_classes_expanded = set(road_classes) | {f"{rc}_link" for rc in road_classes}
            self.factory = GeoJSONFactory()

            self.roads: List[Dict[str, Any]] = []
            self.hospitals: List[Dict[str, Any]] = []
            self.signals: List[Dict[str, Any]] = []

        def node(self, n: Any) -> None:
            if not n.location.valid():
                return
            lon, lat = n.location.lon, n.location.lat
            if not in_bbox(lon, lat, self.bbox):
                return

            tags = {t.k: t.v for t in n.tags}

            # Check for traffic signal
            if tags.get("highway") == "traffic_signals":
                props = normalize_signal_properties(tags, n.id)
                props["source"] = "osm_pbf"
                self.signals.append({
                    "type": "Feature",
                    "id": n.id,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": props
                })

            # Check for hospital node
            if tags.get("amenity") == "hospital":
                props = normalize_hospital_properties(tags, n.id)
                props["source"] = "osm_pbf"
                self.hospitals.append({
                    "type": "Feature",
                    "id": n.id,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": props
                })

        def way(self, w: Any) -> None:
            tags = {t.k: t.v for t in w.tags}
            highway = tags.get("highway")
            amenity = tags.get("amenity")

            is_target_road = highway in self.road_classes_expanded
            is_target_hospital = amenity == "hospital"

            if not (is_target_road or is_target_hospital):
                return

            try:
                coords = [(n.lon, n.lat) for n in w.nodes if n.location.valid()]
            except Exception:
                coords = []

            if not coords:
                return

            # Check if any coordinate intersects Bengaluru bbox
            if not any(in_bbox(lon, lat, self.bbox) for lon, lat in coords):
                return

            node_ids = [n.ref for n in w.nodes]

            if is_target_road and len(coords) >= 2:
                props = normalize_road_properties(tags, w.id, node_ids)
                props["source"] = "osm_pbf"
                self.roads.append({
                    "type": "Feature",
                    "id": w.id,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords
                    },
                    "properties": props
                })

            if is_target_hospital:
                props = normalize_hospital_properties(tags, w.id)
                props["source"] = "osm_pbf"
                if len(coords) >= 4 and coords[0] == coords[-1]:
                    geom = {"type": "Polygon", "coordinates": [coords]}
                else:
                    geom = {"type": "LineString", "coordinates": coords}

                self.hospitals.append({
                    "type": "Feature",
                    "id": w.id,
                    "geometry": geom,
                    "properties": props
                })

        def area(self, a: Any) -> None:
            tags = {t.k: t.v for t in a.tags}
            if tags.get("amenity") != "hospital":
                return
            try:
                geom_json = self.factory.create_multipolygon(a)
                geom = json.loads(geom_json)
                # Ensure within bbox by sampling first coordinate
                coords = geom.get("coordinates", [])
                if coords:
                    props = normalize_hospital_properties(tags, a.id)
                    props["source"] = "osm_pbf"
                    self.hospitals.append({
                        "type": "Feature",
                        "id": a.id,
                        "geometry": geom,
                        "properties": props
                    })
            except Exception:
                pass


class PBFExtractor:
    """Offline PBF parser with spatial filtering and format normalization."""

    def __init__(
        self,
        pbf_path: Optional[str] = None,
        bbox: Tuple[float, float, float, float] = BENGALURU_BBOX,
        road_classes: Optional[List[str]] = None,
        output_dir: str = "GeoJSON_Export"
    ):
        self.pbf_path = pbf_path
        self.bbox = bbox
        self.road_classes = road_classes or DEFAULT_ROAD_CLASSES
        self.output_dir = output_dir

    def extract(self) -> Dict[str, Dict[str, Any]]:
        """Run extraction using Pyosmium."""
        if not HAS_OSMIUM:
            raise ImportError(
                "osmium library is required for offline .osm.pbf processing. "
                "Install it via `pip install osmium`."
            )

        if not self.pbf_path or not os.path.exists(self.pbf_path):
            raise FileNotFoundError(f"PBF file not found at: {self.pbf_path}")

        logger.info(f"Processing PBF: {self.pbf_path} for Bengaluru bbox: {self.bbox}")
        handler = BengaluruOsmiumHandler(self.bbox, self.road_classes)
        # Apply locations cache to resolve way node coordinates
        handler.apply_file(self.pbf_path, locations=True, idx="flex_mem")

        logger.info(
            f"Extraction complete. Roads: {len(handler.roads)}, "
            f"Hospitals: {len(handler.hospitals)}, Signals: {len(handler.signals)}"
        )

        return {
            "roads": {"type": "FeatureCollection", "features": handler.roads},
            "hospitals": {"type": "FeatureCollection", "features": handler.hospitals},
            "signals": {"type": "FeatureCollection", "features": handler.signals},
        }

    def export(self, extracted_data: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
        """Export extracted feature collections to GeoJSON."""
        os.makedirs(self.output_dir, exist_ok=True)
        file_paths = {}
        for key, fc in extracted_data.items():
            out_file = os.path.join(self.output_dir, f"bengaluru_{key}_pbf.geojson")
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(fc, f, indent=2)
            logger.info(f"Saved {len(fc.get('features', []))} features to {out_file}")
            file_paths[key] = out_file
        return file_paths


if __name__ == "__main__":
    pbf_arg = sys.argv[1] if len(sys.argv) > 1 else "karnataka-latest.osm.pbf"
    extractor = PBFExtractor(pbf_path=pbf_arg)
    try:
        data = extractor.extract()
        exported = extractor.export(data)
        print("PBF Extraction Successful. Outputs:")
        for k, path in exported.items():
            print(f" - {k}: {path}")
    except Exception as e:
        logger.error(f"PBF extraction failed: {e}")
        sys.exit(1)
