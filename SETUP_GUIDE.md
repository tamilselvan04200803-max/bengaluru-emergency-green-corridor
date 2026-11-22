# Bengaluru Digital Twin — Complete Setup & Deployment Guide

This guide provides end-to-end instructions for configuring the development environment, compiling the C++ modules, setting up Cesium ion for Unreal Engine 5.4, executing Python GIS extraction pipelines, and launching the Bengaluru Emergency Vehicle Green Corridor simulation.

---

## Table of Contents

1. [Prerequisites & System Requirements](#1-prerequisites--system-requirements)
2. [Python Environment & Pipeline Setup](#2-python-environment--pipeline-setup)
3. [Running Data Extraction Pipelines](#3-running-data-extraction-pipelines)
4. [Unreal Engine 5.4 Project Configuration](#4-unreal-engine-54-project-configuration)
5. [Cesium ion 3D Tiles & Georeference Setup](#5-cesium-ion-3d-tiles--georeference-setup)
6. [Ingesting GeoJSON into Unreal Engine 5](#6-ingesting-geojson-into-unreal-engine-5)
7. [Running the Simulation](#7-running-the-simulation)
8. [Troubleshooting & Diagnostics](#8-troubleshooting--diagnostics)

---

## 1. Prerequisites & System Requirements

### Hardware Requirements
- **CPU**: 8-Core Intel Core i7 / AMD Ryzen 7 (12-Core recommended for terrain baking)
- **RAM**: 32 GB minimum (64 GB recommended for large-scale Nanite & World Partition)
- **GPU**: NVIDIA GeForce RTX 3070 / RTX 4070 or higher (8 GB+ VRAM, DirectX 12 support)
- **Storage**: SSD with at least 50 GB free space

### Software Requirements
- **Operating System**: Windows 10 (Build 19044+) or Windows 11 64-bit
- **Game Engine**: **Unreal Engine 5.4.x** (installed via Epic Games Launcher or built from source)
- **IDE / Toolchain**: **Visual Studio 2022** (version 17.6 or newer)
  - Workload: *Game Development with C++*
  - Component: *MSVC v143 - VS 2022 C++ x64/x86 build tools*
  - Component: *Windows 10/11 SDK (10.0.19041.0 or newer)*
  - Component: *Unreal Engine IDE Support*
- **Python**: Python 3.10, 3.11, or 3.12 (64-bit)
- **Cesium Account**: Free account on [Cesium ion](https://ion.cesium.com/) with an API Access Token

---

## 2. Python Environment & Pipeline Setup

The project includes an automated extraction pipeline for retrieving road topologies, hospital facilities, and traffic signal nodes from OpenStreetMap.

### 2.1 Virtual Environment Creation

Open PowerShell in the project root:

```powershell
cd c:\Users\tamil\Downloads\traffic-clearance-system

# Create virtual environment
python -m venv venv

# Activate virtual environment
.\venv\Scripts\Activate.ps1
```

### 2.2 Install Dependencies

Install the required GIS, HTTP, and testing libraries:

```powershell
pip install --upgrade pip
pip install -r Scripts/requirements.txt
```

Verify the installation:
```powershell
python -c "import requests, shapely; print('Python GIS environment ready!')"
```

### 2.3 Run Test Suite

Run the automated test suite to ensure the extraction modules are functioning:

```powershell
pytest Scripts/test_extractors.py -v
```

---

## 3. Running Data Extraction Pipelines

### Option A: Use the Bundled Production Sample (Recommended for Fast Start)
The project comes pre-bundled with normalized datasets for Central Bengaluru in `Data/GeoJSON/`:
- `Data/GeoJSON/bengaluru_roads.geojson` (19 major corridors)
- `Data/GeoJSON/bengaluru_hospitals.geojson` (5 emergency hospitals)
- `Data/GeoJSON/bengaluru_traffic_signals.geojson` (15 smart signals)

No live extraction is required if you want to test the simulation immediately.

### Option B: Live Overpass API Extraction (Greater Bengaluru)
To extract live data for the entire Greater Bengaluru bounding box:

```powershell
# Extracts roads, hospitals, and signals via Overpass API
python Scripts/osm_extractor.py
```

*Note: The Overpass API extractor includes exponential backoff and automatic failover across multiple public mirrors.*

### Option C: High-Speed Local PBF Extraction
If you have downloaded the Geofabrik Karnataka `.osm.pbf` extract (`karnataka-latest.osm.pbf`):

```powershell
# Fast multi-threaded extraction using pyosmium
python Scripts/pbf_extractor.py --input path\to\karnataka-latest.osm.pbf --output-dir Data\GeoJSON
```

---

## 4. Unreal Engine 5.4 Project Configuration

### 4.1 Generate Project Solution Files

1. Navigate to the project root directory in Windows Explorer:
   `c:\Users\tamil\Downloads\traffic-clearance-system`
2. Right-click on `TrafficClearance.uproject`.
3. Select **Generate Visual Studio project files**.
4. Open the generated `TrafficClearance.sln` in Visual Studio 2022.

### 4.2 Compile C++ Module

1. In Visual Studio 2022, set the build configuration to:
   - **Configuration**: `Development Editor`
   - **Platform**: `Win64`
2. In the Solution Explorer, right-click on the `TrafficClearance` project.
3. Select **Build**.
4. Verify that the build completes with 0 errors:
   - Compiles `Source/TrafficClearance/GeoCoordinateTransformer.cpp`
   - Compiles `Source/TrafficClearance/TrafficClearance.cpp`

### 4.3 Launch Unreal Editor

Double-click `TrafficClearance.uproject` or launch from Visual Studio by pressing `F5` / `Ctrl+F5`.

When prompted to enable missing plugins, confirm:
- **Cesium for Unreal** (`CesiumForUnreal`)
- **Procedural Mesh Component** (`ProceduralMeshComponent`)
- **JSON Blueprint Utilities** (`JsonBlueprintUtilities`)
- **Sun Position Calculator** (`SunPosition`)

---

## 5. Cesium ion 3D Tiles & Georeference Setup

Cesium for Unreal provides geospatial WGS84 globes, elevation terrain, and photorealistic 3D buildings.

### 5.1 Connect Your Cesium ion Token

1. In Unreal Editor, open the **Cesium** panel:
   `Window -> Cesium` (or click the Cesium icon on the top toolbar).
2. Click **Connect to Cesium ion**.
3. Sign in to your browser window and grant access to your project.
4. Alternatively, manually set your token:
   - Go to `Project Settings -> Cesium -> Cesium ion Access Token`.
   - Paste your Default Access Token from [Cesium ion Tokens](https://ion.cesium.com/tokens).

### 5.2 Configure the Bengaluru Georeference Actor

1. In the **Place Actors** tab, search for **Cesium Georeference** and drag it into your level.
2. Select the `CesiumGeoreference` actor in the **Outliner**.
3. In the **Details** panel, configure the Origin coordinates for Central Bengaluru:
   - **Origin Latitude**: `12.9715987` (near Cubbon Park / Corporation Circle)
   - **Origin Longitude**: `77.5945627`
   - **Origin Height**: `920.0` (meters above ellipsoid)
4. Set **Scale to Meters**: `True`.

### 5.3 Add Global Terrain and Photorealistic Tiles

In the **Cesium Quick Add** window:
1. Click **Cesium World Terrain + Bing Maps Aerial** (Asset ID: 1).
2. (Optional for photorealism) Click **Google Photorealistic 3D Tiles** if enabled on your Cesium ion account.
3. In the **World Settings** tab:
   - Enable **World Partition**.
   - Verify that **Enable Large Worlds** is checked (configured via `Config/DefaultEngine.ini`).

---

## 6. Ingesting GeoJSON into Unreal Engine 5

The C++ module provides two primary interfaces exposed to Blueprints:
- `UGeoCoordinateTransformer`: Converts `(Lon, Lat, Alt)` coordinates to Unreal Engine local `(X, Y, Z)` in centimeters.
- `UGeoJSONParser`: Parses roads, hospitals, and traffic signals from disk.

### 6.1 Road Network Generation Workflow

1. Create or open Blueprint `BP_RoadNetworkGenerator`.
2. On `BeginPlay`:
   - Call `UGeoJSONParser::LoadRoadSegmentsFromGeoJSON` with the path:
     `FPaths::ProjectDir() + TEXT("Data/GeoJSON/bengaluru_roads.geojson")`.
   - Pass the parsed road array into `UGeoCoordinateTransformer::BatchWGS84ToUnreal` referencing the active `CesiumGeoreference`.
3. For each transformed road segment:
   - Construct a `USplineComponent`.
   - Add the local Cartesian points as spline points.
   - Use `USplineMeshComponent` or `ProceduralMeshComponent` to extrude a multi-lane road cross-section (e.g. 3.5 meters per lane).
   - Assign road material with asphalt texture and white edge lane lines.

### 6.2 Hospital Hub Placement

1. Call `UGeoJSONParser::LoadHospitalsFromGeoJSON` referencing:
   `FPaths::ProjectDir() + TEXT("Data/GeoJSON/bengaluru_hospitals.geojson")`.
2. For each hospital:
   - Convert `(Lon, Lat, Alt)` to local Unreal Cartesian coordinates.
   - Spawn `BP_HospitalPOI` actor at the target location.
   - Set 3D text render / billboard icon showing hospital name (e.g. "Victoria Hospital — Level 1 Trauma") and available ICU beds.

### 6.3 Smart Traffic Signal & Actuator Network

1. Ingest `Data/GeoJSON/bengaluru_traffic_signals.geojson`.
2. Spawn `BP_TrafficSignalController` at each signal node.
3. Link signal controllers to the adjacent road spline segments.
4. Connect the signal controllers to the `BP_GreenCorridorManager` subsystem.

---

## 7. Running the Simulation

### 7.1 Emergency Vehicle Green Corridor Run

1. Place the `BP_EmergencyVehicle` (Ambulance) actor at the **Majestic Bus Station** node (`77.5729, 12.9778`).
2. Set Destination to **Victoria Hospital Emergency Ingress** (`77.5746, 12.9628`).
3. Press **Play In Editor (PIE)** (`Alt + P`).
4. Press `G` to trigger **Green Corridor Mode**:
   - The route planner calculates the optimal path:
     `Majestic -> Seshadri Road -> K.R. Circle -> Nrupathunga Road -> Corporation Circle -> N.R. Road -> Victoria Hospital`.
   - Traffic signals at K.R. Circle, Hudson Circle, and Corporation Circle receive actuation signals 30 seconds prior to vehicle arrival.
   - Cross-traffic signals switch to RED; corridor signals transition to GREEN.
   - Real-time travel time, velocity, and clearance metrics are displayed on the HUD.

---

## 8. Troubleshooting & Diagnostics

| Symptom | Cause | Solution |
|---|---|---|
| **Cesium tiles not loading / black globe** | Missing or invalid Cesium ion token | Verify your token in `Project Settings -> Cesium`. Ensure token has read access to Cesium World Terrain and Bing Maps. |
| **Objects jitter or drift far from origin** | Origin coordinates mismatch | Ensure `CesiumGeoreference` is set to Lat `12.9715987`, Lon `77.5945627`, Alt `920.0m`. Do NOT leave origin at `(0, 0, 0)`. |
| **Roads float high in the air or sink underground** | Elevation ellipsoidal offset | Bengaluru sits at ~910–925m above MSL. Ensure height coordinates in GeoJSON match Cesium terrain height. Use Cesium raycasting to clamp spline points to terrain mesh. |
| **Missing CesiumForUnreal header during compile** | Cesium plugin not installed to engine | Install Cesium for Unreal 5.4 from the Epic Games Launcher Marketplace, or clone into the project's `Plugins/` directory. |
| **Overpass API rate limit (429 / 504)** | Public Overpass server congested | Use the bundled sample GeoJSON files in `Data/GeoJSON/` or run `pbf_extractor.py` with an offline `.osm.pbf` file. |

---

## Technical Support & Contributing

For issues, enhancements, or bug reports, consult the project issue tracker or contact the Bengaluru Digital Twin Engineering Team.
