import json
import math

ref_lat = 12.9715987
ref_lon = 77.5945627
ref_alt = 920.0
r = 6378137.0
cos_lat0 = math.cos(math.radians(ref_lat))

def to_cartesian(lat, lon, alt):
    x = math.radians(lon - ref_lon) * r * cos_lat0
    z = -math.radians(lat - ref_lat) * r
    y = alt - ref_alt
    return round(x, 1), round(y, 1), round(z, 1)

with open('Data/GeoJSON/bengaluru_traffic_signals.geojson') as f:
    signals = json.load(f)
print("=== SIGNALS IN THREE.JS CARTESIAN SPACE ===")
for s in signals['features']:
    lon, lat, alt = s['geometry']['coordinates']
    x, y, z = to_cartesian(lat, lon, alt)
    print(f"{s['id']:<30} | {x:>8.1f}, {y:>6.1f}, {z:>8.1f} | {s['properties']['name']}")

with open('Data/GeoJSON/bengaluru_hospitals.geojson') as f:
    hosps = json.load(f)
print("\n=== HOSPITALS IN THREE.JS CARTESIAN SPACE ===")
for h in hosps['features']:
    lon, lat, alt = h['geometry']['coordinates']
    x, y, z = to_cartesian(lat, lon, alt)
    print(f"{h['id']:<30} | {x:>8.1f}, {y:>6.1f}, {z:>8.1f} | {h['properties']['name']}")

with open('Data/GeoJSON/bengaluru_roads.geojson') as f:
    roads = json.load(f)
print("\n=== ROADS IN THREE.JS CARTESIAN SPACE ===")
for r_feat in roads['features']:
    coords = r_feat['geometry']['coordinates']
    p0 = to_cartesian(coords[0][1], coords[0][0], coords[0][2])
    p_end = to_cartesian(coords[-1][1], coords[-1][0], coords[-1][2])
    print(f"{r_feat['id']:<24} | lanes: {r_feat['properties']['lanes']} | start: ({p0[0]:>7.1f}, {p0[2]:>7.1f}) -> end: ({p_end[0]:>7.1f}, {p_end[2]:>7.1f}) | {r_feat['properties']['name']}")
