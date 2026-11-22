import json
import math

LAT0 = 12.9715987
LON0 = 77.5945627
ALT0 = 920.0
R = 6378137.0

def latlon_to_cartesian(lon, lat, alt=920.0):
    rad_lat0 = math.radians(LAT0)
    rad_lat = math.radians(lat)
    rad_lon = math.radians(lon)
    rad_lon0 = math.radians(LON0)
    
    # ENU (East, North, Up)
    x = (rad_lon - rad_lon0) * R * math.cos(rad_lat0)
    # in Three.js standard: X is East, Y is Up, Z is -North (or Z is South)
    z = -(rad_lat - rad_lat0) * R
    y = alt - ALT0
    return x, y, z

def analyze_bounds():
    with open("Data/GeoJSON/bengaluru_roads.geojson", "r", encoding="utf-8") as f:
        roads = json.load(f)
    
    all_pts = []
    for f in roads["features"]:
        coords = f["geometry"]["coordinates"]
        for c in coords:
            alt = c[2] if len(c) > 2 else 920.0
            x, y, z = latlon_to_cartesian(c[0], c[1], alt)
            all_pts.append((x, y, z))
            
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    zs = [p[2] for p in all_pts]
    
    print("Three.js Local Cartesian Bounds (Origin at Lat0=12.9715987, Lon0=77.5945627, Alt0=920m):")
    print(f"  X (East-West): [{min(xs):.1f}m, {max(xs):.1f}m], span = {max(xs) - min(xs):.1f}m")
    print(f"  Y (Elevation): [{min(ys):.1f}m, {max(ys):.1f}m], span = {max(ys) - min(ys):.1f}m")
    print(f"  Z (North-South, -Z=North): [{min(zs):.1f}m, {max(zs):.1f}m], span = {max(zs) - min(zs):.1f}m")
    
    with open("Data/GeoJSON/bengaluru_traffic_signals.geojson", "r", encoding="utf-8") as f:
        signals = json.load(f)
    print("\nSignal Cartesian Positions (Sample 5):")
    for s in signals["features"][:5]:
        c = s["geometry"]["coordinates"]
        alt = c[2] if len(c) > 2 else 920.0
        x, y, z = latlon_to_cartesian(c[0], c[1], alt)
        print(f"  {s['properties']['id']}: X={x:.1f}m, Y={y:.1f}m, Z={z:.1f}m")

    with open("Data/GeoJSON/bengaluru_hospitals.geojson", "r", encoding="utf-8") as f:
        hospitals = json.load(f)
    print("\nHospital Cartesian Positions:")
    for h in hospitals["features"]:
        c = h["geometry"]["coordinates"]
        alt = c[2] if len(c) > 2 else 920.0
        x, y, z = latlon_to_cartesian(c[0], c[1], alt)
        print(f"  {h['properties']['id']}: X={x:.1f}m, Y={y:.1f}m, Z={z:.1f}m ({h['properties']['name']})")

if __name__ == "__main__":
    analyze_bounds()
