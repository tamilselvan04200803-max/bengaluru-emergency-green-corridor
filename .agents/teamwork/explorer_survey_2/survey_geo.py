import json
import glob
import math

def inspect_all():
    print("=== 1. GEOJSON FILES IN DATA/GEOJSON ===")
    for path in glob.glob("Data/GeoJSON/*.geojson"):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        feats = data.get("features", [])
        meta = data.get("metadata", {})
        print(f"\nFile: {path}")
        print(f"  CRS: {meta.get('crs')}, Datum: {meta.get('datum')}")
        print(f"  Feature count: {len(feats)}")
        geom_types = set(f["geometry"]["type"] for f in feats)
        print(f"  Geometry types: {geom_types}")

        if "roads" in path:
            print("\n  Detailed Roads:")
            total_len = 0
            for i, f in enumerate(feats):
                p = f["properties"]
                g = f["geometry"]
                coords = g["coordinates"]
                total_len += p.get("length_m", 0)
                elevs = [c[2] for c in coords if len(c) > 2]
                elev_str = f"min={min(elevs):.1f}m max={max(elevs):.1f}m" if elevs else "none"
                print(f"    [{i+1:02d}] {p.get('id')}: {p.get('name')} | lanes={p.get('lanes')} | oneway={p.get('oneway')} | len={p.get('length_m')}m | elev: {elev_str} | start={p.get('start_node')} -> end={p.get('end_node')}")
            print(f"  Total Network Length: {total_len:.1f} m ({total_len/1000.0:.2f} km)")

        elif "signals" in path:
            print("\n  Detailed Signals:")
            for i, f in enumerate(feats):
                p = f["properties"]
                c = f["geometry"]["coordinates"]
                print(f"    [{i+1:02d}] {p.get('id')}: {p.get('name')} | node={p.get('node_id')} | type={p.get('junction_type')} | cycle={p.get('cycle_time_seconds')}s | coord=({c[0]:.4f}, {c[1]:.4f}, {c[2]:.1f}m)")

        elif "hospitals" in path:
            print("\n  Detailed Hospitals:")
            for i, f in enumerate(feats):
                p = f["properties"]
                c = f["geometry"]["coordinates"]
                print(f"    [{i+1:02d}] {p.get('id')}: {p.get('name')} | tier={p.get('trauma_center_level')} | beds={p.get('bed_capacity')} | icu={p.get('icu_capacity')} | coord=({c[0]:.4f}, {c[1]:.4f}, {c[2]:.1f}m)")

if __name__ == "__main__":
    inspect_all()
