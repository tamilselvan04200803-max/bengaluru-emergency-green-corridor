"""
Production-grade Overpass API Extractor for Bengaluru Digital Twin.

Extracts:
1. Roads with hierarchy: motorway, trunk, primary, secondary, tertiary.
   - Normalizes lanes, maxspeed, oneway, highway class, node IDs (for network topology).
2. Hospitals: amenity=hospital, with emergency tag detection.
3. Traffic Signals: highway=traffic_signals.

Outputs standardized GeoJSON files.
"""

import json
import logging
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple, Union

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("OSMExtractor")

# Default Bounding Box for Greater Bengaluru (South, West, North, East)
# Lat: 12.8340 to 13.1436, Lon: 77.4601 to 77.7840
BENGALURU_BBOX = (12.8340, 77.4601, 13.1436, 77.7840)

DEFAULT_ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"]

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def clean_int(val: Any, default: Optional[int] = None) -> Optional[int]:
    """Safely parse integer value, handling strings like '2', '2;3', '1 lane'."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        try:
            return int(val)
        except (ValueError, OverflowError):
            return default
    val_str = str(val).strip()
    match = re.search(r"\d+", val_str)
    if match:
        try:
            return int(match.group(0))
        except ValueError:
            return default
    return default


def clean_float(val: Any, default: Optional[float] = None) -> Optional[float]:
    """Safely parse float value, e.g. for maxspeed '50', '60 km/h', '40 mph'."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    val_str = str(val).strip().lower()
    match = re.search(r"(\d+(\.\d+)?)", val_str)
    if match:
        speed = float(match.group(1))
        if "mph" in val_str:
            speed = speed * 1.60934
        return round(speed, 1)
    return default


def clean_bool(val: Any, default: bool = False) -> bool:
    """Normalize boolean-like OSM tags (yes, 1, true, -1 for oneway reversed)."""
    if val is None:
        return default
    val_str = str(val).strip().lower()
    if val_str in ("yes", "1", "true", "-1"):
        return True
    if val_str in ("no", "0", "false"):
        return False
    return default


def normalize_road_properties(tags: Dict[str, Any], way_id: Union[str, int], node_ids: Optional[List[int]] = None) -> Dict[str, Any]:
    """
    Normalize road segment attributes for routing / simulation topology.
    """
    highway = tags.get("highway", "")
    # Remove link suffix if present (e.g. primary_link -> primary) or preserve base class
    base_highway = highway.replace("_link", "") if highway.endswith("_link") else highway

    lanes = clean_int(tags.get("lanes"), default=1 if clean_bool(tags.get("oneway")) else 2)
    maxspeed = clean_float(tags.get("maxspeed"), default=None)

    oneway_raw = str(tags.get("oneway", "no")).lower()
    oneway = oneway_raw in ("yes", "1", "true", "-1")
    is_reversible = oneway_raw == "-1"

    name = tags.get("name", tags.get("ref", "Unnamed Road"))
    surface = tags.get("surface", "paved")
    bridge = tags.get("bridge", "no") == "yes"
    tunnel = tags.get("tunnel", "no") == "yes"

    return {
        "osm_id": int(way_id) if str(way_id).isdigit() else way_id,
        "name": name,
        "highway": highway,
        "base_highway": base_highway,
        "lanes": lanes,
        "maxspeed_kmh": maxspeed,
        "oneway": oneway,
        "is_reversible": is_reversible,
        "surface": surface,
        "bridge": bridge,
        "tunnel": tunnel,
        "node_ids": node_ids or [],
        "source": "osm_overpass",
    }


def normalize_hospital_properties(tags: Dict[str, Any], osm_id: Union[str, int]) -> Dict[str, Any]:
    """Normalize hospital attributes with emergency facility tagging."""
    emergency = tags.get("emergency", "no").lower() in ("yes", "designated", "true", "1")
    name = tags.get("name", "Unnamed Hospital")
    operator = tags.get("operator", tags.get("operator:type", ""))
    healthcare = tags.get("healthcare", "hospital")
    beds = clean_int(tags.get("beds"), default=None)
    wheelchair = tags.get("wheelchair", "unknown")

    return {
        "osm_id": int(osm_id) if str(osm_id).isdigit() else osm_id,
        "name": name,
        "amenity": "hospital",
        "emergency": emergency,
        "operator": operator,
        "healthcare": healthcare,
        "beds": beds,
        "wheelchair": wheelchair,
        "source": "osm_overpass",
    }


def normalize_signal_properties(tags: Dict[str, Any], osm_id: Union[str, int]) -> Dict[str, Any]:
    """Normalize traffic signal attributes."""
    direction = tags.get("direction", "all")
    crossing = tags.get("crossing", "no")
    traffic_signals_type = tags.get("traffic_signals", tags.get("traffic_signals:direction", "standard"))

    return {
        "osm_id": int(osm_id) if str(osm_id).isdigit() else osm_id,
        "highway": "traffic_signals",
        "direction": direction,
        "crossing": crossing,
        "signal_type": traffic_signals_type,
        "source": "osm_overpass",
    }


class OSMExtractor:
    """Overpass API Extractor for Bengaluru City Features."""

    def __init__(
        self,
        bbox: Tuple[float, float, float, float] = BENGALURU_BBOX,
        road_classes: Optional[List[str]] = None,
        timeout: int = 180,
        output_dir: str = "GeoJSON_Export"
    ):
        self.bbox = bbox  # (s, w, n, e)
        self.road_classes = road_classes or DEFAULT_ROAD_CLASSES
        self.timeout = timeout
        self.output_dir = output_dir

    def _get_bbox_str(self) -> str:
        s, w, n, e = self.bbox
        return f"{s},{w},{n},{e}"

    def build_roads_query(self) -> str:
        bbox_str = self._get_bbox_str()
        hierarchy_regex = "|".join(self.road_classes)
        # Include main highway and *_link roads
        query = f"""
        [out:json][timeout:{self.timeout}];
        (
          way["highway"~"^({hierarchy_regex})(_link)?$"]({bbox_str});
        );
        out body;
        >;
        out skel qt;
        """
        return query.strip()

    def build_hospitals_query(self) -> str:
        bbox_str = self._get_bbox_str()
        query = f"""
        [out:json][timeout:{self.timeout}];
        (
          node["amenity"="hospital"]({bbox_str});
          way["amenity"="hospital"]({bbox_str});
          relation["amenity"="hospital"]({bbox_str});
        );
        out center body;
        >;
        out skel qt;
        """
        return query.strip()

    def build_signals_query(self) -> str:
        bbox_str = self._get_bbox_str()
        query = f"""
        [out:json][timeout:{self.timeout}];
        (
          node["highway"="traffic_signals"]({bbox_str});
        );
        out body;
        """
        return query.strip()

    def query_overpass(self, query: str, max_retries: int = 3) -> Dict[str, Any]:
        """Execute query across multiple mirrors with retry."""
        headers = {"User-Agent": "BengaluruTrafficDigitalTwin/1.0 (contact: admin@digitaltwin.bengaluru)"}
        for endpoint in OVERPASS_ENDPOINTS:
            for attempt in range(max_retries):
                try:
                    logger.info(f"Querying Overpass mirror: {endpoint} (attempt {attempt+1})")
                    resp = requests.post(endpoint, data={"data": query}, headers=headers, timeout=self.timeout + 15)
                    if resp.status_code == 200:
                        return resp.json()
                    elif resp.status_code == 429:
                        logger.warning(f"Rate limited by {endpoint}, waiting 10s...")
                        time.sleep(10)
                    else:
                        logger.warning(f"Error {resp.status_code} from {endpoint}: {resp.text[:100]}")
                        time.sleep(2)
                except Exception as e:
                    logger.warning(f"Connection failure to {endpoint}: {e}")
                    time.sleep(2)
        raise RuntimeError("All Overpass endpoints failed or timed out.")

    def parse_roads(self, osm_data: Dict[str, Any]) -> Dict[str, Any]:
        """Convert Overpass JSON containing ways and nodes into LineString GeoJSON."""
        nodes: Dict[int, Tuple[float, float]] = {}
        ways: List[Dict[str, Any]] = []

        for el in osm_data.get("elements", []):
            el_type = el.get("type")
            if el_type == "node":
                nodes[el["id"]] = (el["lon"], el["lat"])
            elif el_type == "way":
                ways.append(el)

        features = []
        target_highway_set = set(self.road_classes) | {f"{rc}_link" for rc in self.road_classes}
        for way in ways:
            tags = way.get("tags", {})
            highway = tags.get("highway")
            if not highway or highway not in target_highway_set:
                continue

            way_nodes = way.get("nodes", [])
            coords = [nodes[nid] for nid in way_nodes if nid in nodes]
            if len(coords) < 2:
                continue

            props = normalize_road_properties(tags, way["id"], way_nodes)
            features.append({
                "type": "Feature",
                "id": way["id"],
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords
                },
                "properties": props
            })

        return {
            "type": "FeatureCollection",
            "features": features
        }

    def parse_hospitals(self, osm_data: Dict[str, Any]) -> Dict[str, Any]:
        """Parse hospital nodes, ways, relations into Point or Polygon GeoJSON."""
        nodes: Dict[int, Tuple[float, float]] = {}
        for el in osm_data.get("elements", []):
            if el.get("type") == "node" and "lat" in el and "lon" in el:
                nodes[el["id"]] = (el["lon"], el["lat"])

        features = []
        for el in osm_data.get("elements", []):
            tags = el.get("tags", {})
            if tags.get("amenity") != "hospital":
                continue

            osm_id = el["id"]
            props = normalize_hospital_properties(tags, osm_id)
            geom = None

            if el.get("type") == "node" and "lat" in el and "lon" in el:
                geom = {
                    "type": "Point",
                    "coordinates": [el["lon"], el["lat"]]
                }
            elif "center" in el:
                geom = {
                    "type": "Point",
                    "coordinates": [el["center"]["lon"], el["center"]["lat"]]
                }
            elif el.get("type") == "way" and "nodes" in el:
                coords = [nodes[nid] for nid in el["nodes"] if nid in nodes]
                if len(coords) >= 4 and coords[0] == coords[-1]:
                    geom = {
                        "type": "Polygon",
                        "coordinates": [coords]
                    }
                elif len(coords) >= 2:
                    geom = {
                        "type": "LineString",
                        "coordinates": coords
                    }

            if geom:
                features.append({
                    "type": "Feature",
                    "id": osm_id,
                    "geometry": geom,
                    "properties": props
                })

        return {
            "type": "FeatureCollection",
            "features": features
        }

    def parse_signals(self, osm_data: Dict[str, Any]) -> Dict[str, Any]:
        """Parse traffic signal nodes into Point GeoJSON."""
        features = []
        for el in osm_data.get("elements", []):
            if el.get("type") == "node" and el.get("tags", {}).get("highway") == "traffic_signals":
                osm_id = el["id"]
                props = normalize_signal_properties(el.get("tags", {}), osm_id)
                features.append({
                    "type": "Feature",
                    "id": osm_id,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [el["lon"], el["lat"]]
                    },
                    "properties": props
                })

        return {
            "type": "FeatureCollection",
            "features": features
        }

    def export_geojson(self, data: Dict[str, Any], filename: str) -> str:
        """Write GeoJSON to destination directory."""
        os.makedirs(self.output_dir, exist_ok=True)
        file_path = os.path.join(self.output_dir, filename)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        logger.info(f"Successfully exported {len(data.get('features', []))} features to {file_path}")
        return file_path

    def run(self) -> Dict[str, str]:
        """Execute full extraction workflow."""
        results = {}
        logger.info("Extracting road hierarchy...")
        roads_raw = self.query_overpass(self.build_roads_query())
        roads_fc = self.parse_roads(roads_raw)
        results["roads"] = self.export_geojson(roads_fc, "bengaluru_roads.geojson")

        logger.info("Extracting hospitals...")
        hospitals_raw = self.query_overpass(self.build_hospitals_query())
        hospitals_fc = self.parse_hospitals(hospitals_raw)
        results["hospitals"] = self.export_geojson(hospitals_fc, "bengaluru_hospitals.geojson")

        logger.info("Extracting traffic signals...")
        signals_raw = self.query_overpass(self.build_signals_query())
        signals_fc = self.parse_signals(signals_raw)
        results["signals"] = self.export_geojson(signals_fc, "bengaluru_signals.geojson")

        return results


if __name__ == "__main__":
    extractor = OSMExtractor()
    try:
        paths = extractor.run()
        print("Extraction complete. Output files:")
        for k, v in paths.items():
            print(f" - {k}: {v}")
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        sys.exit(1)
