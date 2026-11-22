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
    return round(x, 2), round(y, 2), round(z, 2)

with open('Data/GeoJSON/bengaluru_roads.geojson') as f:
    roads = json.load(f)

print(f"Total road features: {len(roads['features'])}")

total_vertices = 0
total_length = 0

for feat in roads['features']:
    props = feat['properties']
    coords = feat['geometry']['coordinates']
    lanes = props['lanes']
    road_width = lanes * 3.5
    half_w = road_width / 2.0
    
    pts = [to_cartesian(c[1], c[0], c[2]) for c in coords]
    total_vertices += len(pts)
    
    # Calculate road length
    length = 0.0
    for i in range(len(pts) - 1):
        dx = pts[i+1][0] - pts[i][0]
        dz = pts[i+1][2] - pts[i][2]
        length += math.sqrt(dx*dx + dz*dz)
    total_length += length
    
    # Test miter vectors
    for i in range(len(pts)):
        if i == 0:
            tx = pts[1][0] - pts[0][0]
            tz = pts[1][2] - pts[0][2]
        elif i == len(pts) - 1:
            tx = pts[-1][0] - pts[-2][0]
            tz = pts[-1][2] - pts[-2][2]
        else:
            d1x = pts[i][0] - pts[i-1][0]
            d1z = pts[i][2] - pts[i-1][2]
            l1 = math.hypot(d1x, d1z)
            d2x = pts[i+1][0] - pts[i][0]
            d2z = pts[i+1][2] - pts[i][2]
            l2 = math.hypot(d2x, d2z)
            tx = (d1x/l1 + d2x/l2)
            tz = (d1z/l1 + d2z/l2)
            
        t_len = math.hypot(tx, tz)
        tx /= t_len
        tz /= t_len
        
        # Perpendicular normal
        nx = -tz
        nz = tx
        
        # Left and right points
        left_x = pts[i][0] + nx * half_w
        left_z = pts[i][2] + nz * half_w
        right_x = pts[i][0] - nx * half_w
        right_z = pts[i][2] - nz * half_w
        
        assert not math.isnan(left_x) and not math.isnan(left_z)
        assert not math.isnan(right_x) and not math.isnan(right_z)

print(f"Verified all 19 road ribbons! Total polyline length: {total_length:.1f}m across {total_vertices} vertices.")
