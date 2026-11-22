"""
Unit tests and synthetic GeoJSON generator validating geospatial pipeline data schemas,
property normalizations, and geometry validity (LineString, Point, Polygon).
"""

import json
import os
import sys
import pytest

from osm_extractor import (
    clean_int,
    clean_float,
    clean_bool,
    normalize_road_properties,
    normalize_hospital_properties,
    normalize_signal_properties,
    OSMExtractor,
    BENGALURU_BBOX,
)
from pbf_extractor import in_bbox

try:
    from shapely.geometry import shape, Point, LineString, Polygon
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False


def create_synthetic_overpass_payload():
    """Generates synthetic Overpass API elements mirroring raw OSM structure."""
    return {
        "version": 0.6,
        "generator": "SyntheticOverpassGenerator",
        "elements": [
            # Node 1 for Road A
            {"type": "node", "id": 1001, "lat": 12.9716, "lon": 77.5946},
            # Node 2 for Road A
            {"type": "node", "id": 1002, "lat": 12.9750, "lon": 77.5980},
            # Node 3 for Road A
            {"type": "node", "id": 1003, "lat": 12.9800, "lon": 77.6020},
            # Way: MG Road (primary road)
            {
                "type": "way",
                "id": 5001,
                "nodes": [1001, 1002, 1003],
                "tags": {
                    "name": "Mahatma Gandhi Road",
                    "highway": "primary",
                    "lanes": "4",
                    "maxspeed": "50 km/h",
                    "oneway": "no",
                    "surface": "asphalt"
                }
            },
            # Way: Outer Ring Road Link (trunk_link)
            {
                "type": "way",
                "id": 5002,
                "nodes": [1002, 1003],
                "tags": {
                    "name": "ORR Ramp",
                    "highway": "trunk_link",
                    "lanes": "1",
                    "oneway": "yes",
                    "bridge": "yes"
                }
            },
            # Node: Victoria Hospital (Emergency designated)
            {
                "type": "node",
                "id": 6001,
                "lat": 12.9634,
                "lon": 77.5750,
                "tags": {
                    "amenity": "hospital",
                    "name": "Victoria Hospital",
                    "emergency": "yes",
                    "beds": "1000",
                    "operator": "Government"
                }
            },
            # Way: Manipal Hospital (Area polygon)
            {"type": "node", "id": 7001, "lat": 12.9580, "lon": 77.6480},
            {"type": "node", "id": 7002, "lat": 12.9590, "lon": 77.6480},
            {"type": "node", "id": 7003, "lat": 12.9590, "lon": 77.6500},
            {"type": "node", "id": 7004, "lat": 12.9580, "lon": 77.6480},
            {
                "type": "way",
                "id": 6002,
                "nodes": [7001, 7002, 7003, 7004],
                "tags": {
                    "amenity": "hospital",
                    "name": "Manipal Hospital Old Airport Rd",
                    "emergency": "designated",
                    "healthcare": "hospital"
                }
            },
            # Node: Traffic signal at Richmond Circle
            {
                "type": "node",
                "id": 8001,
                "lat": 12.9660,
                "lon": 77.5990,
                "tags": {
                    "highway": "traffic_signals",
                    "direction": "all",
                    "crossing": "traffic_signals"
                }
            }
        ]
    }


# =====================================================================
# Unit Tests: Normalization and Parsing Helper Functions
# =====================================================================

def test_clean_int():
    assert clean_int(4) == 4
    assert clean_int("3") == 3
    assert clean_int("2;3") == 2
    assert clean_int("4 lanes") == 4
    assert clean_int(None, default=1) == 1
    assert clean_int("invalid", default=2) == 2


def test_clean_float():
    assert clean_float(60.0) == 60.0
    assert clean_float("50") == 50.0
    assert clean_float("80 km/h") == 80.0
    # 40 mph ≈ 64.4 km/h
    assert abs(clean_float("40 mph") - 64.4) < 0.2
    assert clean_float(None) is None
    assert clean_float("unknown", default=30.0) == 30.0


def test_clean_bool():
    assert clean_bool("yes") is True
    assert clean_bool("1") is True
    assert clean_bool("true") is True
    assert clean_bool("-1") is True
    assert clean_bool("no") is False
    assert clean_bool("0") is False
    assert clean_bool(None, default=False) is False


def test_road_properties_normalization():
    tags = {
        "name": "Hosur Road",
        "highway": "trunk",
        "lanes": "6",
        "maxspeed": "80",
        "oneway": "yes"
    }
    props = normalize_road_properties(tags, 12345, [10, 20, 30])
    assert props["osm_id"] == 12345
    assert props["name"] == "Hosur Road"
    assert props["highway"] == "trunk"
    assert props["base_highway"] == "trunk"
    assert props["lanes"] == 6
    assert props["maxspeed_kmh"] == 80.0
    assert props["oneway"] is True
    assert props["node_ids"] == [10, 20, 30]


def test_road_link_properties_normalization():
    tags = {
        "highway": "primary_link",
        "lanes": "1",
        "oneway": "-1"
    }
    props = normalize_road_properties(tags, 999)
    assert props["highway"] == "primary_link"
    assert props["base_highway"] == "primary"
    assert props["oneway"] is True
    assert props["is_reversible"] is True


def test_hospital_emergency_tagging():
    # Emergency designated
    t1 = {"name": "Apollo Clinic", "amenity": "hospital", "emergency": "yes"}
    p1 = normalize_hospital_properties(t1, 100)
    assert p1["emergency"] is True
    assert p1["amenity"] == "hospital"

    # No emergency
    t2 = {"name": "Ayurvedic Center", "amenity": "hospital", "emergency": "no"}
    p2 = normalize_hospital_properties(t2, 200)
    assert p2["emergency"] is False


def test_signal_normalization():
    tags = {"highway": "traffic_signals", "direction": "forward"}
    props = normalize_signal_properties(tags, 555)
    assert props["osm_id"] == 555
    assert props["highway"] == "traffic_signals"
    assert props["direction"] == "forward"


def test_bengaluru_bbox_filtering():
    # Inside Bengaluru (Cubbon Park: 12.9763, 77.5929)
    assert in_bbox(77.5929, 12.9763, BENGALURU_BBOX) is True
    # Outside Bengaluru (Mysuru: 12.2958, 76.6394)
    assert in_bbox(76.6394, 12.2958, BENGALURU_BBOX) is False
    # Outside Bengaluru (Delhi: 28.6139, 77.2090)
    assert in_bbox(77.2090, 28.6139, BENGALURU_BBOX) is False


# =====================================================================
# Synthetic GeoJSON & Schema Validation Tests
# =====================================================================

def test_osm_extractor_synthetic_parsing(tmp_path):
    raw_payload = create_synthetic_overpass_payload()
    extractor = OSMExtractor(output_dir=str(tmp_path))

    # 1. Test Roads Parsing
    roads_fc = extractor.parse_roads(raw_payload)
    assert roads_fc["type"] == "FeatureCollection"
    assert len(roads_fc["features"]) == 2
    road_1 = roads_fc["features"][0]
    assert road_1["geometry"]["type"] == "LineString"
    assert len(road_1["geometry"]["coordinates"]) == 3
    assert road_1["properties"]["name"] == "Mahatma Gandhi Road"
    assert road_1["properties"]["lanes"] == 4
    assert road_1["properties"]["base_highway"] == "primary"
    assert road_1["properties"]["node_ids"] == [1001, 1002, 1003]

    # 2. Test Hospitals Parsing
    hosp_fc = extractor.parse_hospitals(raw_payload)
    assert hosp_fc["type"] == "FeatureCollection"
    assert len(hosp_fc["features"]) == 2

    # Victoria hospital is a Point
    pt_hosp = next(f for f in hosp_fc["features"] if f["id"] == 6001)
    assert pt_hosp["geometry"]["type"] == "Point"
    assert pt_hosp["properties"]["emergency"] is True
    assert pt_hosp["properties"]["beds"] == 1000

    # Manipal hospital is a Polygon
    poly_hosp = next(f for f in hosp_fc["features"] if f["id"] == 6002)
    assert poly_hosp["geometry"]["type"] == "Polygon"
    assert poly_hosp["properties"]["emergency"] is True

    # 3. Test Signals Parsing
    sig_fc = extractor.parse_signals(raw_payload)
    assert sig_fc["type"] == "FeatureCollection"
    assert len(sig_fc["features"]) == 1
    signal_feature = sig_fc["features"][0]
    assert signal_feature["geometry"]["type"] == "Point"
    assert signal_feature["properties"]["highway"] == "traffic_signals"

    # 4. Test Export
    roads_file = extractor.export_geojson(roads_fc, "test_roads.geojson")
    assert os.path.exists(roads_file)
    with open(roads_file, "r", encoding="utf-8") as f:
        loaded = json.load(f)
        assert len(loaded["features"]) == 2


@pytest.mark.skipif(not HAS_SHAPELY, reason="Shapely is required for geometric topology validation")
def test_shapely_geometry_validity():
    raw_payload = create_synthetic_overpass_payload()
    extractor = OSMExtractor()

    roads_fc = extractor.parse_roads(raw_payload)
    for feat in roads_fc["features"]:
        geom = shape(feat["geometry"])
        assert isinstance(geom, LineString)
        assert geom.is_valid
        assert len(geom.coords) >= 2

    hosp_fc = extractor.parse_hospitals(raw_payload)
    for feat in hosp_fc["features"]:
        geom = shape(feat["geometry"])
        assert isinstance(geom, (Point, Polygon, LineString))
        assert geom.is_valid

    signals_fc = extractor.parse_signals(raw_payload)
    for feat in signals_fc["features"]:
        geom = shape(feat["geometry"])
        assert isinstance(geom, Point)
        assert geom.is_valid


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
