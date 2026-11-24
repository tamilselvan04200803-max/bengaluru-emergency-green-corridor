#!/usr/bin/env python3
"""
generate_network.py

Generates Bengaluru geospatial network data:
- 33 junctions with WGS84 coordinates across 6 zones
- 61 directed edges preserving real one-ways and divided carriageways
- 6 Hospital compound definitions with 25m driveway ingress coordinates and dual bays (Bay A / Bay B)

Edge geometry and length_m are sourced from Data/GeoJSON/bengaluru_edge_geometry.json
when present (produced by Scripts/extract_edge_geometry.py from the OSM caches
checked into this repository). Each edge then carries:
  - polyline: ordered [lon, lat, alt] points following the real carriageway
  - length_m: arc length of that polyline
  - length_provenance: "OSM_VERIFIED" or "SYNTHETIC_STRAIGHT"
Edges the extractor could not resolve keep the hand-authored length and fall back to a
two-point straight connector tagged SYNTHETIC_STRAIGHT.

Outputs:
- Data/GeoJSON/bengaluru_network.json
- Embedded into preview_data.js as NETWORK_DATA constant
"""

import json
import math
import os
from typing import Dict, List, Tuple, Any

# =============================================================================
# AUTHENTIC NODE DEFINITIONS - 24 nodes across 5 zones + Central Hospital
# =============================================================================

NODES = [
    # ---- CENTRAL ZONE ----
    {
        "id": "node_majestic",
        "name": "Majestic (KSR/BMTC)",
        "zone": "Central",
        "lat": 12.9767,
        "lon": 77.5713,
        "alt": 922.0,
        "type": "major_interchange",
        "signals": ["signal_majestic_cross"],
        "roads": ["way_seshadri_01", "way_kg_01"]
    },
    {
        "id": "node_sheshadri_junction",
        "name": "Subedar Chatram Cross",
        "zone": "Central",
        "lat": 12.9765,
        "lon": 77.5795,
        "alt": 921.2,
        "type": "junction",
        "signals": ["signal_sheshadri_junction"],
        "roads": ["way_seshadri_01", "way_seshadri_02"]
    },
    {
        "id": "node_kr_circle",
        "name": "Sir M. Visvesvaraya (K.R.) Circle",
        "zone": "Central",
        "lat": 12.9752,
        "lon": 77.5871,
        "alt": 922.5,
        "type": "roundabout_5way",
        "signals": ["signal_kr_circle"],
        "roads": ["way_seshadri_02", "way_nrupathunga_01", "way_ambedkar_01"]
    },
    {
        "id": "node_hudson_circle",
        "name": "Hudson Circle (Police Corner / Cubbon Park Gate)",
        "zone": "Central",
        "lat": 12.9680,
        "lon": 77.5875,
        "alt": 920.9,
        "type": "roundabout_5way",
        "signals": ["signal_hudson_circle"],
        "roads": ["way_nrupathunga_02", "way_kasturba_hudson", "way_hudson_to_corp"]
    },
    {
        "id": "node_corporation_circle",
        "name": "Corporation Circle (Town Hall / NR Square)",
        "zone": "Central",
        "lat": 12.9667,
        "lon": 77.5872,
        "alt": 920.1,
        "type": "junction_4way",
        "signals": ["signal_corporation_circle"],
        "roads": ["way_hudson_to_corp", "way_nr_road_01"]
    },
    {
        "id": "node_kr_market_junction",
        "name": "K.R. Market Flyover Junction",
        "zone": "Central",
        "lat": 12.9658,
        "lon": 77.5765,
        "alt": 916.5,
        "type": "junction_4way",
        "signals": ["signal_kr_market"],
        "roads": ["way_avenue_01", "way_nr_road_01", "way_fort_victoria_01"]
    },
    {
        "id": "node_victoria_hospital_gate",
        "name": "Victoria Hospital Emergency Ingress",
        "zone": "Central",
        "lat": 12.9628,
        "lon": 77.5746,
        "alt": 914.8,
        "type": "hospital_ingress",
        "signals": ["signal_victoria_hospital_gate"],
        "roads": ["way_fort_victoria_01", "way_fort_victoria_02"]
    },
    {
        "id": "node_fort_junction",
        "name": "Bangalore Fort / Kalasipalya Junction",
        "zone": "Central",
        "lat": 12.9610,
        "lon": 77.5740,
        "alt": 914.0,
        "type": "junction_3way",
        "signals": ["signal_fort_junction"],
        "roads": ["way_fort_victoria_02", "way_tipu_palace_01"]
    },
    {
        "id": "node_tipu_palace",
        "name": "Tipu Sultan's Summer Palace",
        "zone": "Central",
        # Referenced by edge_tipu_fwd/edge_tipu_bwd and way_tipu_palace_01 but previously
        # absent from the node table, leaving both edges dangling. Placed on Albert Victor
        # Road at the palace frontage, 205 m south-west of Fort Junction along the same
        # north-south axis so the corridor geometry stays consistent with the stored length.
        "lat": 12.95920,
        "lon": 77.57365,
        "alt": 913.5,
        "type": "junction_3way",
        "signals": [],
        "roads": ["way_tipu_palace_01"]
    },
    {
        "id": "node_mysore_bank",
        "name": "Mysore Bank Circle",
        "zone": "Central",
        "lat": 12.9735,
        "lon": 77.5815,
        "alt": 921.5,
        "type": "junction_4way",
        "signals": ["signal_mysore_bank"],
        "roads": ["way_kg_02", "way_avenue_01"]
    },
    {
        "id": "node_kg_road_mid",
        "name": "Kempegowda Road Midpoint (Tribhuvan)",
        "zone": "Central",
        "lat": 12.9745,
        "lon": 77.5780,
        "alt": 920.8,
        "type": "midpoint",
        "signals": [],
        "roads": ["way_kg_01", "way_kg_02"]
    },
    {
        "id": "node_st_marthas",
        "name": "St. Martha's Hospital Crossing",
        "zone": "Central",
        "lat": 12.9702,
        "lon": 77.5873,
        "alt": 921.8,
        "type": "hospital_approach",
        "signals": ["signal_st_marthas"],
        "roads": ["way_nrupathunga_01", "way_nrupathunga_02"]
    },
    {
        "id": "node_kasturba_cross",
        "name": "Kasturba Road / Vittal Mallya Junction",
        "zone": "Central",
        "lat": 12.9706,
        "lon": 77.5956,
        "alt": 923.1,
        "type": "junction_4way",
        "signals": ["signal_kasturba_cross"],
        "roads": ["way_kasturba_hudson", "way_mg_road_01"]
    },

    # ---- SOUTH ZONE ----
    {
        "id": "node_lalbagh_west",
        "name": "Lalbagh West Gate",
        "zone": "South",
        "lat": 12.9497,
        "lon": 77.5855,
        "alt": 920.5,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_nimhans",
        "name": "NIMHANS Junction",
        "zone": "South",
        "lat": 12.9426,
        "lon": 77.5991,
        "alt": 919.8,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_jayadeva",
        "name": "Jayadeva Flyover Junction",
        "zone": "South",
        "lat": 12.9195,
        "lon": 77.5957,
        "alt": 918.2,
        "type": "flyover_junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_btm_layout",
        "name": "BTM Layout Junction",
        "zone": "South",
        "lat": 12.9165,
        "lon": 77.6101,
        "alt": 915.5,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_silk_board",
        "name": "Silk Board Junction",
        "zone": "South",
        "lat": 12.9176,
        "lon": 77.6238,
        "alt": 914.0,
        "type": "major_interchange",
        "signals": [],
        "roads": []
    },

    # ---- KORAMANGALA ZONE ----
    {
        "id": "node_sony_world",
        "name": "Sony World Junction",
        "zone": "Koramangala",
        "lat": 12.9352,
        "lon": 77.6245,
        "alt": 917.5,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_forum",
        "name": "Forum Mall Junction",
        "zone": "Koramangala",
        "lat": 12.9274,
        "lon": 77.6167,
        "alt": 916.8,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_st_johns",
        "name": "St. John's Hospital Junction",
        "zone": "Koramangala",
        # Corrected from (12.9245, 77.6218), which sat ~840 m south of the campus on
        # Visveswaraya GH Lane. These coordinates come from the two BMTC stop positions
        # tagged name="St. John's Hospital" in osmnx_cache/ (OSM node 10855128081 at
        # 12.929405,77.615913 and node 7277381435 at 12.929472,77.616001), on the
        # Hosur Road / Sarjapura Road frontage of the hospital.
        "lat": 12.92940,
        "lon": 77.61600,
        "alt": 916.2,
        "type": "hospital_approach",
        "signals": [],
        "roads": []
    },

    # ---- EAST ZONE ----
    {
        "id": "node_mg_road",
        "name": "MG Road Metro Junction",
        "zone": "East",
        "lat": 12.9767,
        "lon": 77.6085,
        "alt": 921.0,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_trinity",
        "name": "Trinity Circle",
        "zone": "East",
        "lat": 12.9718,
        "lon": 77.6053,
        "alt": 921.5,
        "type": "junction",
        "signals": ["signal_anil_kumble_circle"],
        "roads": ["way_mg_road_02"]
    },
    {
        "id": "node_anil_kumble_circle",
        "name": "Anil Kumble Circle (MG Road - Brigade Road)",
        "zone": "East",
        "lat": 12.9748,
        "lon": 77.6045,
        "alt": 922.2,
        "type": "junction_4way",
        "signals": ["signal_anil_kumble_circle"],
        "roads": ["way_mg_road_01", "way_mg_road_02", "way_bowring_to_mg_01"]
    },
    {
        "id": "node_indiranagar_100ft",
        "name": "Indiranagar 100ft Road Junction",
        "zone": "East",
        "lat": 12.9784,
        "lon": 77.6408,
        "alt": 920.0,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_domlur",
        "name": "Domlur Junction",
        "zone": "East",
        "lat": 12.9611,
        "lon": 77.6430,
        "alt": 918.5,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_manipal_hospital",
        "name": "Manipal Hospital Junction",
        "zone": "East",
        "lat": 12.9508,
        "lon": 77.6466,
        "alt": 916.0,
        "type": "hospital_approach",
        "signals": [],
        "roads": []
    },

    # ---- NORTH-CENTRAL ZONE ----
    {
        "id": "node_shivajinagar",
        "name": "Shivajinagar Junction",
        "zone": "North-Central",
        "lat": 12.9860,
        "lon": 77.5992,
        "alt": 924.5,
        "type": "junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_bowring_hospital_gate",
        "name": "Bowring Hospital Emergency Ingress",
        "zone": "North-Central",
        "lat": 12.9829,
        "lon": 77.6027,
        "alt": 923.0,
        "type": "hospital_ingress",
        "signals": ["signal_bowring_hospital"],
        "roads": ["way_bowring_link_01", "way_bowring_to_mg_01"]
    },
    {
        "id": "node_raj_bhavan",
        "name": "Raj Bhavan Road / Ali Asker Road Junction",
        "zone": "North-Central",
        "lat": 12.9830,
        "lon": 77.5920,
        "alt": 925.4,
        "type": "junction_4way",
        "signals": ["signal_raj_bhavan"],
        "roads": ["way_raj_bhavan_01", "way_bowring_link_01"]
    },
    {
        "id": "node_vidhana_soudha",
        "name": "Vidhana Soudha / High Court Gate",
        "zone": "North-Central",
        "lat": 12.9796,
        "lon": 77.5907,
        "alt": 924.0,
        "type": "junction_3way",
        "signals": ["signal_vidhana_soudha"],
        "roads": ["way_ambedkar_01", "way_raj_bhavan_01"]
    },
    {
        "id": "node_mekhri_circle",
        "name": "Mekhri Circle Flyover",
        "zone": "North-Central",
        "lat": 13.0060,
        "lon": 77.5750,
        "alt": 928.0,
        "type": "flyover_junction",
        "signals": [],
        "roads": []
    },
    {
        "id": "node_hebbal_flyover",
        "name": "Hebbal Flyover Junction",
        "zone": "North-Central",
        "lat": 13.0354,
        "lon": 77.5975,
        "alt": 932.0,
        "type": "major_interchange",
        "signals": [],
        "roads": []
    },

    # ---- CENTRAL HOSPITAL ----
    {
        "id": "node_victoria_hospital_main",
        "name": "Victoria Hospital Main Campus",
        "zone": "Central Hospital",
        "lat": 12.9634,
        "lon": 77.5755,
        "alt": 915.0,
        "type": "hospital_campus",
        "signals": [],
        "roads": []
    },
    # ---- KORAMANGALA HOSPITAL CAMPUS ----
    {
        "id": "node_st_johns_campus",
        "name": "St. John's Medical College Hospital Campus",
        "zone": "Koramangala",
        "lat": 12.9245,
        "lon": 77.6218,
        "alt": 916.2,
        "type": "hospital_campus",
        "signals": [],
        "roads": []
    },
]


# =============================================================================
# DIRECTED EDGES - 45+ edges preserving real one-ways and divided carriageways
# =============================================================================

def create_edge(edge_id: str, name: str, from_node: str, to_node: str,
                highway: str, lanes: int, maxspeed: int, oneway: bool,
                surface: str = "asphalt", length_m: float = 0.0,
                elevation_m: float = 0.0, ev_priority: bool = False,
                is_divided: bool = False, carriageway: str = "") -> Dict[str, Any]:
    """Create a directed edge with all required properties."""
    return {
        "id": edge_id,
        "name": name,
        "from_node": from_node,
        "to_node": to_node,
        "highway": highway,
        "lanes": lanes,
        "maxspeed": maxspeed,
        "oneway": oneway,
        "surface": surface,
        "length_m": length_m,
        "elevation_m": elevation_m,
        "ev_priority_corridor": ev_priority,
        "is_divided_carriageway": is_divided,
        "carriageway_tag": carriageway  # "forward", "backward", or ""
    }

EDGES = [
    # ---- CENTRAL CORRIDOR: Majestic -> K.R. Circle (Seshadri Road - ONE WAY) ----
    create_edge("edge_seshadri_01_fwd", "Seshadri Road (Majestic -> Subedar Chatram)",
                "node_majestic", "node_sheshadri_junction",
                "primary", 4, 50, True, "asphalt", 780.5, 921.4, True),
    create_edge("edge_seshadri_02_fwd", "Seshadri Road (Subedar Chatram -> K.R. Circle)",
                "node_sheshadri_junction", "node_kr_circle",
                "primary", 4, 50, True, "asphalt", 845.0, 922.0, True),

    # ---- CENTRAL: Kempegowda Road (TWO WAY - divided carriageway) ----
    create_edge("edge_kg_01_fwd", "Kempegowda Road (Majestic -> Tribhuvan) Forward",
                "node_majestic", "node_kg_road_mid",
                "primary", 2, 40, False, "asphalt", 660.0, 920.8, True, True, "forward"),
    create_edge("edge_kg_01_bwd", "Kempegowda Road (Tribhuvan -> Majestic) Backward",
                "node_kg_road_mid", "node_majestic",
                "primary", 2, 40, False, "asphalt", 660.0, 920.8, True, True, "backward"),
    create_edge("edge_kg_02_fwd", "Kempegowda Road (Tribhuvan -> Mysore Bank) Forward",
                "node_kg_road_mid", "node_mysore_bank",
                "primary", 2, 40, False, "asphalt", 415.0, 921.0, True, True, "forward"),
    create_edge("edge_kg_02_bwd", "Kempegowda Road (Mysore Bank -> Tribhuvan) Backward",
                "node_mysore_bank", "node_kg_road_mid",
                "primary", 2, 40, False, "asphalt", 415.0, 921.0, True, True, "backward"),

    # ---- CENTRAL: Avenue Road (ONE WAY - Mysore Bank -> K.R. Market) ----
    create_edge("edge_avenue_01_fwd", "Avenue Road (Mysore Bank -> K.R. Market)",
                "node_mysore_bank", "node_kr_market_junction",
                "secondary", 2, 30, True, "asphalt", 1050.0, 917.5, False),

    # ---- CENTRAL: Nrupathunga Road (ONE WAY - K.R. Circle -> Hudson Circle) ----
    create_edge("edge_nrupathunga_01_fwd", "Nrupathunga Road (K.R. Circle -> St. Martha's)",
                "node_kr_circle", "node_st_marthas",
                "primary", 4, 50, True, "asphalt", 560.0, 922.0, True),
    create_edge("edge_nrupathunga_02_fwd", "Nrupathunga Road (St. Martha's -> Hudson Circle)",
                "node_st_marthas", "node_hudson_circle",
                "primary", 4, 50, True, "asphalt", 250.0, 921.2, True),

    # ---- CENTRAL: Kasturba Road (TWO WAY - divided carriageway) ----
    create_edge("edge_kasturba_fwd", "Kasturba Road (Hudson Circle -> Mallya Hospital) Forward",
                "node_hudson_circle", "node_kasturba_cross",
                "primary", 2, 40, False, "asphalt", 940.0, 922.5, True, True, "forward"),
    create_edge("edge_kasturba_bwd", "Kasturba Road (Mallya Hospital -> Hudson Circle) Backward",
                "node_kasturba_cross", "node_hudson_circle",
                "primary", 2, 40, False, "asphalt", 940.0, 922.5, True, True, "backward"),

    # ---- CENTRAL: Hudson Circle -> Corporation Circle (ONE WAY) ----
    create_edge("edge_hudson_corp_fwd", "Devanga Market Road (Hudson -> Corporation)",
                "node_hudson_circle", "node_corporation_circle",
                "primary", 6, 50, True, "asphalt", 150.0, 920.2, True),

    # ---- CENTRAL: N.R. Road (TWO WAY - trunk road) ----
    create_edge("edge_nr_road_fwd", "N.R. Road (Corporation Circle -> K.R. Market) Forward",
                "node_corporation_circle", "node_kr_market_junction",
                "trunk", 3, 50, False, "asphalt", 1180.0, 918.0, True, True, "forward"),
    create_edge("edge_nr_road_bwd", "N.R. Road (K.R. Market -> Corporation Circle) Backward",
                "node_kr_market_junction", "node_corporation_circle",
                "trunk", 3, 50, False, "asphalt", 1180.0, 918.0, True, True, "backward"),

    # ---- CENTRAL: K.R. Road / Fort Road (TWO WAY - Victoria Hospital corridor) ----
    create_edge("edge_fort_victoria_01_fwd", "K.R. Road (K.R. Market -> Victoria Hospital) Forward",
                "node_kr_market_junction", "node_victoria_hospital_gate",
                "trunk", 2, 40, False, "asphalt", 390.0, 915.2, True, True, "forward"),
    create_edge("edge_fort_victoria_01_bwd", "K.R. Road (Victoria Hospital -> K.R. Market) Backward",
                "node_victoria_hospital_gate", "node_kr_market_junction",
                "trunk", 2, 40, False, "asphalt", 390.0, 915.2, True, True, "backward"),
    create_edge("edge_fort_victoria_02_fwd", "Fort Road (Victoria Hospital -> Bangalore Fort) Forward",
                "node_victoria_hospital_gate", "node_fort_junction",
                "trunk", 2, 40, False, "asphalt", 210.0, 914.2, True, True, "forward"),
    create_edge("edge_fort_victoria_02_bwd", "Fort Road (Bangalore Fort -> Victoria Hospital) Backward",
                "node_fort_junction", "node_victoria_hospital_gate",
                "trunk", 2, 40, False, "asphalt", 210.0, 914.2, True, True, "backward"),

    # ---- CENTRAL: Albert Victor Road (TWO WAY) ----
    create_edge("edge_tipu_fwd", "Albert Victor Road (Fort -> Tipu Palace) Forward",
                "node_fort_junction", "node_tipu_palace",
                "secondary", 2, 30, False, "asphalt", 205.0, 913.8, False),
    create_edge("edge_tipu_bwd", "Albert Victor Road (Tipu Palace -> Fort) Backward",
                "node_tipu_palace", "node_fort_junction",
                "secondary", 2, 30, False, "asphalt", 205.0, 913.8, False),

    # ---- CENTRAL: Dr. B.R. Ambedkar Veedhi (TWO WAY - trunk) ----
    create_edge("edge_ambedkar_fwd", "Ambedkar Veedhi (K.R. Circle -> Vidhana Soudha) Forward",
                "node_kr_circle", "node_vidhana_soudha",
                "trunk", 3, 50, False, "asphalt", 620.0, 923.5, True, True, "forward"),
    create_edge("edge_ambedkar_bwd", "Ambedkar Veedhi (Vidhana Soudha -> K.R. Circle) Backward",
                "node_vidhana_soudha", "node_kr_circle",
                "trunk", 3, 50, False, "asphalt", 620.0, 923.5, True, True, "backward"),

    # ---- NORTH-CENTRAL: Raj Bhavan Road (TWO WAY) ----
    create_edge("edge_raj_bhavan_fwd", "Raj Bhavan Road (Vidhana Soudha -> Raj Bhavan) Forward",
                "node_vidhana_soudha", "node_raj_bhavan",
                "primary", 2, 50, False, "asphalt", 410.0, 925.0, True, True, "forward"),
    create_edge("edge_raj_bhavan_bwd", "Raj Bhavan Road (Raj Bhavan -> Vidhana Soudha) Backward",
                "node_raj_bhavan", "node_vidhana_soudha",
                "primary", 2, 50, False, "asphalt", 410.0, 925.0, True, True, "backward"),

    # ---- NORTH-CENTRAL: Lady Curzon Road (TWO WAY) ----
    create_edge("edge_bowring_link_fwd", "Lady Curzon Road (Raj Bhavan -> Bowring Hospital) Forward",
                "node_raj_bhavan", "node_bowring_hospital_gate",
                "primary", 2, 40, False, "asphalt", 1180.0, 923.2, True, True, "forward"),
    create_edge("edge_bowring_link_bwd", "Lady Curzon Road (Bowring Hospital -> Raj Bhavan) Backward",
                "node_bowring_hospital_gate", "node_raj_bhavan",
                "primary", 2, 40, False, "asphalt", 1180.0, 923.2, True, True, "backward"),

    # ---- NORTH-CENTRAL: Central Street (ONE WAY - Bowring -> Anil Kumble) ----
    create_edge("edge_bowring_mg_fwd", "Central Street (Bowring Hospital -> Anil Kumble Circle)",
                "node_bowring_hospital_gate", "node_anil_kumble_circle",
                "primary", 4, 40, True, "asphalt", 930.0, 922.5, True),

    # ---- EAST: MG Road (TWO WAY - trunk, divided carriageway) ----
    create_edge("edge_mg_road_01_fwd", "MG Road (Kasturba Cross -> Anil Kumble) Forward",
                "node_kasturba_cross", "node_anil_kumble_circle",
                "trunk", 3, 50, False, "asphalt", 1080.0, 922.8, True, True, "forward"),
    create_edge("edge_mg_road_01_bwd", "MG Road (Anil Kumble -> Kasturba Cross) Backward",
                "node_anil_kumble_circle", "node_kasturba_cross",
                "trunk", 3, 50, False, "asphalt", 1080.0, 922.8, True, True, "backward"),
    create_edge("edge_mg_road_02_fwd", "MG Road (Anil Kumble -> Trinity Circle) Forward",
                "node_anil_kumble_circle", "node_trinity",
                "trunk", 3, 50, False, "asphalt", 1540.0, 920.5, True, True, "forward"),
    create_edge("edge_mg_road_02_bwd", "MG Road (Trinity Circle -> Anil Kumble) Backward",
                "node_trinity", "node_anil_kumble_circle",
                "trunk", 3, 50, False, "asphalt", 1540.0, 920.5, True, True, "backward"),

    # ---- SOUTH ZONE: Major arterial connections (simplified) ----
    # Connect South zone to Central zone via Hosur Road
    create_edge("edge_lalbagh_fort_fwd", "Hosur Road (Lalbagh West -> Fort Junction) Forward",
                "node_lalbagh_west", "node_fort_junction",
                "primary", 3, 50, False, "asphalt", 2000.0, 918.0, False, True, "forward"),
    create_edge("edge_lalbagh_fort_bwd", "Hosur Road (Fort Junction -> Lalbagh West) Backward",
                "node_fort_junction", "node_lalbagh_west",
                "primary", 3, 50, False, "asphalt", 2000.0, 918.0, False, True, "backward"),
    create_edge("edge_lalbagh_nimhans_fwd", "Hosur Road (Lalbagh West -> NIMHANS) Forward",
                "node_lalbagh_west", "node_nimhans",
                "primary", 3, 50, False, "asphalt", 2100.0, 920.0, False, True, "forward"),
    # Connect South zone to Koramangala zone
    create_edge("edge_silk_forum_fwd", "Sarjapur Road (Silk Board -> Forum) Forward",
                "node_silk_board", "node_forum",
                "primary", 3, 50, False, "asphalt", 1500.0, 915.0, False, True, "forward"),
    create_edge("edge_silk_forum_bwd", "Sarjapur Road (Forum -> Silk Board) Backward",
                "node_forum", "node_silk_board",
                "primary", 3, 50, False, "asphalt", 1500.0, 915.0, False, True, "backward"),
    # St. John's Hospital: Sarjapur Road goes past Forum, then curves to frontage junction
    create_edge("edge_silk_stjohns_fwd", "Sarjapur Road (Silk Board -> St. John's Frontage) Forward",
                "node_silk_board", "node_st_johns",
                "primary", 3, 50, False, "asphalt", 2515.7, 914.5, False, True, "forward"),
    create_edge("edge_silk_stjohns_bwd", "Sarjapur Road (St. John's Frontage -> Silk Board) Backward",
                "node_st_johns", "node_silk_board",
                "primary", 3, 50, False, "asphalt", 2515.7, 914.5, False, True, "backward"),
    create_edge("edge_lalbagh_nimhans_bwd", "Hosur Road (NIMHANS -> Lalbagh West) Backward",
                "node_nimhans", "node_lalbagh_west",
                "primary", 3, 50, False, "asphalt", 2100.0, 920.0, False, True, "backward"),
    create_edge("edge_nimhans_jayadeva_fwd", "Hosur Road (NIMHANS -> Jayadeva) Forward",
                "node_nimhans", "node_jayadeva",
                "trunk", 3, 60, False, "asphalt", 2800.0, 919.0, False, True, "forward"),
    create_edge("edge_nimhans_jayadeva_bwd", "Hosur Road (Jayadeva -> NIMHANS) Backward",
                "node_jayadeva", "node_nimhans",
                "trunk", 3, 60, False, "asphalt", 2800.0, 919.0, False, True, "backward"),
    create_edge("edge_jayadeva_btm_fwd", "Hosur Road (Jayadeva -> BTM Layout) Forward",
                "node_jayadeva", "node_btm_layout",
                "trunk", 3, 60, False, "asphalt", 1800.0, 917.0, False, True, "forward"),
    create_edge("edge_jayadeva_btm_bwd", "Hosur Road (BTM Layout -> Jayadeva) Backward",
                "node_btm_layout", "node_jayadeva",
                "trunk", 3, 60, False, "asphalt", 1800.0, 917.0, False, True, "backward"),
    create_edge("edge_btm_silk_fwd", "Hosur Road / ORR (BTM Layout -> Silk Board) Forward",
                "node_btm_layout", "node_silk_board",
                "trunk", 3, 60, False, "asphalt", 2500.0, 915.0, False, True, "forward"),
    create_edge("edge_btm_silk_bwd", "Hosur Road / ORR (Silk Board -> BTM Layout) Backward",
                "node_silk_board", "node_btm_layout",
                "trunk", 3, 60, False, "asphalt", 2500.0, 915.0, False, True, "backward"),

    # ---- KORAMANGALA ZONE: Internal connections ----
    create_edge("edge_sony_forum_fwd", "Koramangala Inner Ring (Sony World -> Forum) Forward",
                "node_sony_world", "node_forum",
                "primary", 2, 40, False, "asphalt", 1200.0, 917.0, False),
    create_edge("edge_sony_forum_bwd", "Koramangala Inner Ring (Forum -> Sony World) Backward",
                "node_forum", "node_sony_world",
                "primary", 2, 40, False, "asphalt", 1200.0, 917.0, False),
    create_edge("edge_forum_stjohns_fwd", "Koramangala 80ft Road (Forum -> St. John's Frontage) Forward",
                "node_forum", "node_st_johns",
                "secondary", 2, 30, False, "asphalt", 486.5, 916.5, False),
    create_edge("edge_forum_stjohns_bwd", "Koramangala 80ft Road (St. John's Frontage -> Forum) Backward",
                "node_st_johns", "node_forum",
                "secondary", 2, 30, False, "asphalt", 486.5, 916.5, False),
    # St. John's Hospital driveway (frontage -> campus)
    create_edge("edge_stjohns_driveway_fwd", "St. John's Hospital Driveway (Frontage -> Campus) Forward",
                "node_st_johns", "node_st_johns_campus",
                "service", 2, 20, False, "asphalt", 600.0, 916.2, False, False, "forward"),
    create_edge("edge_stjohns_driveway_bwd", "St. John's Hospital Driveway (Campus -> Frontage) Backward",
                "node_st_johns_campus", "node_st_johns",
                "service", 2, 20, False, "asphalt", 600.0, 916.2, False, False, "backward"),

    # ---- EAST ZONE: MG Road extension ----
    create_edge("edge_trinity_indiranagar_fwd", "Old Madras Road (Trinity -> Indiranagar) Forward",
                "node_trinity", "node_indiranagar_100ft",
                "primary", 2, 40, False, "asphalt", 3800.0, 920.0, False, True, "forward"),
    create_edge("edge_trinity_indiranagar_bwd", "Old Madras Road (Indiranagar -> Trinity) Backward",
                "node_indiranagar_100ft", "node_trinity",
                "primary", 2, 40, False, "asphalt", 3800.0, 920.0, False, True, "backward"),
    create_edge("edge_indiranagar_domlur_fwd", "100ft Road / HAL Airport Rd (Indiranagar -> Domlur) Forward",
                "node_indiranagar_100ft", "node_domlur",
                "primary", 2, 40, False, "asphalt", 1500.0, 919.0, False),
    create_edge("edge_indiranagar_domlur_bwd", "100ft Road / HAL Airport Rd (Domlur -> Indiranagar) Backward",
                "node_domlur", "node_indiranagar_100ft",
                "primary", 2, 40, False, "asphalt", 1500.0, 919.0, False),
    create_edge("edge_domlur_manipal_fwd", "Old Airport Road (Domlur -> Manipal Hospital) Forward",
                "node_domlur", "node_manipal_hospital",
                "primary", 2, 40, False, "asphalt", 2200.0, 917.0, False),
    create_edge("edge_domlur_manipal_bwd", "Old Airport Road (Manipal Hospital -> Domlur) Backward",
                "node_manipal_hospital", "node_domlur",
                "primary", 2, 40, False, "asphalt", 2200.0, 917.0, False),

    # ---- NORTH-CENTRAL: Major arterials ----
    create_edge("edge_vidhana_raj_fwd", "Race Course Road (Vidhana -> Raj Bhavan) Forward",
                "node_vidhana_soudha", "node_raj_bhavan",
                "primary", 2, 40, False, "asphalt", 1800.0, 924.5, True),
    create_edge("edge_vidhana_raj_bwd", "Race Course Road (Raj Bhavan -> Vidhana) Backward",
                "node_raj_bhavan", "node_vidhana_soudha",
                "primary", 2, 40, False, "asphalt", 1800.0, 924.5, True),
    create_edge("edge_raj_mekhri_fwd", "Bellary Road (Raj Bhavan -> Mekhri Circle) Forward",
                "node_raj_bhavan", "node_mekhri_circle",
                "trunk", 3, 60, False, "asphalt", 3200.0, 926.0, True, True, "forward"),
    create_edge("edge_raj_mekhri_bwd", "Bellary Road (Mekhri Circle -> Raj Bhavan) Backward",
                "node_mekhri_circle", "node_raj_bhavan",
                "trunk", 3, 60, False, "asphalt", 3200.0, 926.0, True, True, "backward"),
    create_edge("edge_mekhri_hebbal_fwd", "Bellary Road / NH44 (Mekhri -> Hebbal Flyover) Forward",
                "node_mekhri_circle", "node_hebbal_flyover",
                "trunk", 3, 80, False, "asphalt", 4500.0, 928.0, True, True, "forward"),
    create_edge("edge_mekhri_hebbal_bwd", "Bellary Road / NH44 (Hebbal Flyover -> Mekhri) Backward",
                "node_hebbal_flyover", "node_mekhri_circle",
                "trunk", 3, 80, False, "asphalt", 4500.0, 928.0, True, True, "backward"),
]


# =============================================================================
# HOSPITAL COMPOUNDS - 6 hospitals with 25m driveway ingress and dual bays
# =============================================================================

def calculate_driveway_ingress(hospital_lat: float, hospital_lon: float,
                                hospital_alt: float, approach_node_lat: float,
                                approach_node_lon: float, approach_node_alt: float,
                                distance_m: float = 25.0) -> Dict[str, float]:
    """Calculate driveway ingress point 25m from hospital toward approach node."""
    # Simple linear interpolation on lat/lon (acceptable for 25m distances)
    # Convert to local metric approximation
    lat_diff = approach_node_lat - hospital_lat
    lon_diff = approach_node_lon - hospital_lon
    alt_diff = approach_node_alt - hospital_alt

    # Approximate degrees per meter at this latitude
    lat_per_m = 1.0 / 111320.0  # ~9e-6 deg/m
    lon_per_m = 1.0 / (111320.0 * math.cos(math.radians(hospital_lat)))  # ~1.1e-5 deg/m

    dist_deg = math.sqrt(lat_diff**2 + lon_diff**2)
    if dist_deg > 0:
        ratio = min(distance_m * lat_per_m / dist_deg, 1.0)
        ingress_lat = hospital_lat + lat_diff * ratio
        ingress_lon = hospital_lon + lon_diff * ratio
        ingress_alt = hospital_alt + alt_diff * ratio
    else:
        ingress_lat, ingress_lon, ingress_alt = hospital_lat, hospital_lon, hospital_alt

    return {"lat": ingress_lat, "lon": ingress_lon, "alt": ingress_alt}


HOSPITALS = [
    {
        "id": "hosp_victoria_01",
        "name": "Victoria Hospital (BMCRI)",
        "campus_node": "node_victoria_hospital_main",
        "ingress_node": "node_victoria_hospital_gate",
        "trauma_level": "Level 1",
        "bed_capacity": 1050,
        "icu_capacity": 120,
        "emergency_bays": 24,
        "helipad": True,
        "ev_priority": "CRITICAL_TIER_1",
        "bays": {
            "bay_a": {
                "id": "victoria_bay_a",
                "name": "Trauma Bay A (Primary Resuscitation)",
                "position": {"lat": 12.9634, "lon": 77.5755, "alt": 915.0},
                "dedicated_to": "trauma_resuscitation",
                "coordinates_offset_m": {"x": -8, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            },
            "bay_b": {
                "id": "victoria_bay_b",
                "name": "Trauma Bay B (Secondary Resuscitation / Burn)",
                "position": {"lat": 12.9633, "lon": 77.5755, "alt": 915.0},
                "dedicated_to": "burn_trauma",
                "coordinates_offset_m": {"x": 8, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            }
        },
        "driveway": {
            "ingress_point": calculate_driveway_ingress(
                12.9634, 77.5755, 915.0,
                12.9628, 77.5746, 914.8,
                25.0
            ),
            "length_m": 25.0,
            "surface": "asphalt",
            "width_m": 6.0,
            "approach_bearing_deg": 180.0,
            "provenance": "SYNTHETIC_DROP_OFF"
        }
    },
    {
        "id": "hosp_bowring_01",
        "name": "Bowring and Lady Curzon Hospital",
        "campus_node": "node_bowring_hospital_gate",
        "ingress_node": "node_bowring_hospital_gate",
        "trauma_level": "Level 1",
        "bed_capacity": 686,
        "icu_capacity": 64,
        "emergency_bays": 16,
        "helipad": False,
        "ev_priority": "CRITICAL_TIER_1",
        "bays": {
            "bay_a": {
                "id": "bowring_bay_a",
                "name": "Emergency Surgery Bay A",
                "position": {"lat": 12.9829, "lon": 77.6027, "alt": 923.0},
                "dedicated_to": "emergency_surgery",
                "coordinates_offset_m": {"x": -6, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            },
            "bay_b": {
                "id": "bowring_bay_b",
                "name": "Pediatric/Orthopedic Trauma Bay B",
                "position": {"lat": 12.9828, "lon": 77.6027, "alt": 923.0},
                "dedicated_to": "pediatric_ortho_trauma",
                "coordinates_offset_m": {"x": 6, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            }
        },
        "driveway": {
            "ingress_point": calculate_driveway_ingress(
                12.9829, 77.6027, 923.0,
                12.9830, 77.5960, 924.6,
                25.0
            ),
            "length_m": 25.0,
            "surface": "asphalt",
            "width_m": 5.5,
            "approach_bearing_deg": 270.0,
            "provenance": "SYNTHETIC_DROP_OFF"
        }
    },
    {
        "id": "hosp_stmarthas_01",
        "name": "St. Martha's Hospital",
        "campus_node": "node_st_marthas",
        "ingress_node": "node_st_marthas",
        "trauma_level": "Level 2",
        "bed_capacity": 550,
        "icu_capacity": 48,
        "emergency_bays": 12,
        "helipad": False,
        "ev_priority": "CRITICAL_TIER_1",
        "bays": {
            "bay_a": {
                "id": "stmarthas_bay_a",
                "name": "Cardiology Emergency Bay A",
                "position": {"lat": 12.9702, "lon": 77.5873, "alt": 921.8},
                "dedicated_to": "cardiology_emergency",
                "coordinates_offset_m": {"x": 0, "y": -5, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            },
            "bay_b": {
                "id": "stmarthas_bay_b",
                "name": "Trauma/Ortho Bay B",
                "position": {"lat": 12.9702, "lon": 77.5873, "alt": 921.8},
                "dedicated_to": "trauma_ortho",
                "coordinates_offset_m": {"x": 0, "y": 5, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            }
        },
        "driveway": {
            "ingress_point": calculate_driveway_ingress(
                12.9702, 77.5873, 921.8,
                12.9752, 77.5871, 922.5,
                25.0
            ),
            "length_m": 25.0,
            "surface": "asphalt",
            "width_m": 5.0,
            "approach_bearing_deg": 0.0,
            "provenance": "SYNTHETIC_DROP_OFF"
        }
    },
    {
        "id": "hosp_mallya_01",
        "name": "Mallya Hospital (Vittal Mallya)",
        "campus_node": "node_kasturba_cross",
        "ingress_node": "node_kasturba_cross",
        "trauma_level": "Level 2",
        "bed_capacity": 220,
        "icu_capacity": 32,
        "emergency_bays": 8,
        "helipad": False,
        "ev_priority": "TIER_2",
        "bays": {
            "bay_a": {
                "id": "mallya_bay_a",
                "name": "Cardiac Emergency Bay A",
                "position": {"lat": 12.9706, "lon": 77.5956, "alt": 923.1},
                "dedicated_to": "cardiac_emergency",
                "coordinates_offset_m": {"x": -5, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            },
            "bay_b": {
                "id": "mallya_bay_b",
                "name": "Neuro Trauma Bay B",
                "position": {"lat": 12.9705, "lon": 77.5956, "alt": 923.1},
                "dedicated_to": "neuro_trauma",
                "coordinates_offset_m": {"x": 5, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            }
        },
        "driveway": {
            "ingress_point": calculate_driveway_ingress(
                12.9706, 77.5956, 923.1,
                12.9680, 77.5875, 920.9,
                25.0
            ),
            "length_m": 25.0,
            "surface": "asphalt",
            "width_m": 4.5,
            "approach_bearing_deg": 225.0,
            "provenance": "SYNTHETIC_DROP_OFF"
        }
    },
    {
        "id": "hosp_vanivilas_01",
        "name": "Vani Vilas Hospital",
        "campus_node": "node_victoria_hospital_main",
        "ingress_node": "node_victoria_hospital_gate",
        "trauma_level": "Level 2",
        "bed_capacity": 536,
        "icu_capacity": 40,
        "emergency_bays": 10,
        "helipad": False,
        "ev_priority": "TIER_2",
        "bays": {
            "bay_a": {
                "id": "vanivilas_bay_a",
                "name": "OB/GYN Emergency Bay A",
                "position": {"lat": 12.9619, "lon": 77.5742, "alt": 914.5},
                "dedicated_to": "obgyn_emergency",
                "coordinates_offset_m": {"x": 0, "y": -5, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            },
            "bay_b": {
                "id": "vanivilas_bay_b",
                "name": "NICU/Pediatric Bay B",
                "position": {"lat": 12.9618, "lon": 77.5742, "alt": 914.5},
                "dedicated_to": "nicu_pediatric",
                "coordinates_offset_m": {"x": 0, "y": 5, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            }
        },
        "driveway": {
            "ingress_point": calculate_driveway_ingress(
                12.9619, 77.5742, 914.5,
                12.9628, 77.5746, 914.8,
                25.0
            ),
            "length_m": 25.0,
            "surface": "asphalt",
            "width_m": 4.5,
            "approach_bearing_deg": 45.0,
            "provenance": "SYNTHETIC_DROP_OFF"
        }
    },
    {
        "id": "hosp_stjohns_01",
        "name": "St. John's Medical College Hospital",
        "campus_node": "node_st_johns_campus",
        "ingress_node": "node_st_johns",
        "trauma_level": "Level 1",
        "bed_capacity": 1300,
        "icu_capacity": 150,
        "emergency_bays": 30,
        "helipad": True,
        "ev_priority": "CRITICAL_TIER_1",
        "bays": {
            # Bay positions and driveway are synthesised from the corrected junction
            # coordinates. The real St. John's campus driveway geometry is not mapped in
            # the checked-in OSM data, so every non-OSM bay/driveway element below is
            # labelled SYNTHETIC_DROP_OFF rather than presented as surveyed ground truth.
            # The same label is applied uniformly to all six hospital compounds above,
            # whose bay offsets and driveway ingress points are likewise synthesised by
            # calculate_driveway_ingress() and not derived from OSM survey data.
            "bay_a": {
                "id": "stjohns_bay_a",
                "name": "Major Trauma Bay A",
                "position": {"lat": 12.92450, "lon": 77.62180, "alt": 916.2},
                "dedicated_to": "major_trauma",
                "coordinates_offset_m": {"x": -10, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            },
            "bay_b": {
                "id": "stjohns_bay_b",
                "name": "Multi-Specialty Bay B",
                "position": {"lat": 12.92440, "lon": 77.62180, "alt": 916.2},
                "dedicated_to": "multi_specialty",
                "coordinates_offset_m": {"x": 10, "y": 0, "z": 0},
                "provenance": "SYNTHETIC_DROP_OFF"
            }
        },
        "driveway": {
            "ingress_point": calculate_driveway_ingress(
                12.92450, 77.62180, 916.2,
                12.92940, 77.61600, 916.2,
                600.0
            ),
            "length_m": 600.0,
            "surface": "asphalt",
            "width_m": 7.0,
            "approach_bearing_deg": 315.0,
            "provenance": "SYNTHETIC_DROP_OFF"
        }
    }
]


# =============================================================================
# MAIN GENERATION FUNCTIONS
# =============================================================================

def load_edge_geometry() -> Dict[str, Any]:
    """Load OSM-derived edge polylines produced by Scripts/extract_edge_geometry.py."""
    path = "Data/GeoJSON/bengaluru_edge_geometry.json"
    if not os.path.exists(path):
        print(f"[WARN] {path} not found; edges will use synthetic straight connectors.")
        print(f"       Run: python Scripts/extract_edge_geometry.py")
        return {}
    with open(path, 'r', encoding='utf-8') as f:
        payload = json.load(f)
    edges = payload.get('edges', {})
    print(f"[OK] Loaded {len(edges)} OSM-derived edge polylines from {path}")
    return edges


def apply_edge_geometry(edges: List[Dict[str, Any]], geometry: Dict[str, Any]) -> None:
    """Attach polyline + arc-length to each edge; synthesise a connector when absent.

    Mutates `edges` in place. `length_m` is overwritten with the true polyline arc
    length wherever OSM geometry exists, which is what removes the historical
    straight-line underestimates (Silk Board -> St. John's was stored as 800 m
    against a real corridor of ~2.5 km).
    """
    by_id = {n["id"]: n for n in NODES}
    verified = synthetic = 0
    for edge in edges:
        geom = geometry.get(edge["id"])
        if geom and len(geom.get("coordinates", [])) >= 2:
            edge["polyline"] = geom["coordinates"]
            edge["length_m"] = geom["length_m"]
            edge["length_provenance"] = "OSM_VERIFIED"
            verified += 1
            continue

        a = by_id.get(edge["from_node"])
        b = by_id.get(edge["to_node"])
        if not a or not b:
            edge["polyline"] = []
            edge["length_provenance"] = "SYNTHETIC_STRAIGHT"
            synthetic += 1
            continue
        edge["polyline"] = [
            [a["lon"], a["lat"], a["alt"]],
            [b["lon"], b["lat"], b["alt"]],
        ]
        edge["length_provenance"] = "SYNTHETIC_STRAIGHT"
        synthetic += 1
    print(f"[OK] Edge geometry: {verified} OSM_VERIFIED, {synthetic} SYNTHETIC_STRAIGHT")


def generate_network_json() -> Dict[str, Any]:
    """Generate the complete network JSON structure."""
    geometry = load_edge_geometry()
    apply_edge_geometry(EDGES, geometry)
    return {
        "type": "FeatureCollection",
        "metadata": {
            "project": "TrafficClearance",
            "region": "Bengaluru Metropolitan Emergency Vehicle Network",
            "crs": "EPSG:4326",
            "datum": "WGS84",
            "description": "33-junction geospatial network with 61 directed edges, hospital compounds, and EV priority corridors",
            "node_count": len(NODES),
            "edge_count": len(EDGES),
            "hospital_count": len(HOSPITALS),
            "zones": ["Central", "South", "Koramangala", "East", "North-Central", "Central Hospital"]
        },
        "nodes": NODES,
        "edges": EDGES,
        "hospitals": HOSPITALS
    }


def write_network_json(network_data: Dict[str, Any], output_path: str) -> None:
    """Write network JSON to file."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(network_data, f, indent=2, ensure_ascii=False)
    print(f"[OK] Written network JSON to {output_path}")
    print(f"  Nodes: {len(network_data['nodes'])}")
    print(f"  Edges: {len(network_data['edges'])}")
    print(f"  Hospitals: {len(network_data['hospitals'])}")


def update_preview_data_js(network_data: Dict[str, Any], preview_path: str) -> None:
    """Update preview_data.js with the new NETWORK_DATA constant."""
    network_js = json.dumps(network_data, separators=(',', ':'), ensure_ascii=False)

    # Read existing preview_data.js
    with open(preview_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check if NETWORK_DATA already exists
    if 'const NETWORK_DATA' in content:
        # Replace existing NETWORK_DATA
        import re
        pattern = r'const NETWORK_DATA\s*=\s*\{[\s\S]*?\};'
        content = re.sub(pattern, f'const NETWORK_DATA = {network_js};', content)
    else:
        # Append NETWORK_DATA after the existing constants
        content = content.rstrip() + f'\n\nconst NETWORK_DATA = {network_js};\n'

    with open(preview_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"[OK] Updated {preview_path} with NETWORK_DATA constant")


def main():
    print("=" * 70)
    print("BENGALURU GEOSPATIAL NETWORK GENERATOR")
    print("=" * 70)

    # Generate network data
    network_data = generate_network_json()

    # Write to Data/GeoJSON/bengaluru_network.json
    network_output = "Data/GeoJSON/bengaluru_network.json"
    write_network_json(network_data, network_output)

    # Update preview_data.js
    preview_path = "preview_data.js"
    update_preview_data_js(network_data, preview_path)

    # Verify
    print("\n" + "=" * 70)
    print("VERIFICATION")
    print("=" * 70)
    with open(network_output, 'r', encoding='utf-8') as f:
        verify = json.load(f)
    print(f"Nodes: {len(verify['nodes'])}")
    print(f"Edges: {len(verify['edges'])}")
    print(f"Hospitals: {len(verify['hospitals'])}")

    # Zone breakdown
    zones = {}
    for node in verify['nodes']:
        zone = node['zone']
        zones[zone] = zones.get(zone, 0) + 1
    print("\nNodes per zone:")
    for zone, count in sorted(zones.items()):
        print(f"  {zone}: {count}")

    # Edge directionality breakdown
    oneway = sum(1 for e in verify['edges'] if e['oneway'])
    twoway = sum(1 for e in verify['edges'] if not e['oneway'])
    divided = sum(1 for e in verify['edges'] if e.get('is_divided_carriageway', False))
    print(f"\nEdge directionality:")
    print(f"  One-way: {oneway}")
    print(f"  Two-way (single edge): {twoway}")
    print(f"  Divided carriageway pairs: {divided}")

    # Hospital bays
    total_bays = sum(len(h['bays']) for h in verify['hospitals'])
    print(f"\nHospital bays (dual per hospital): {total_bays}")

    print("\n[SUCCESS] Generation complete!")


if __name__ == "__main__":
    main()