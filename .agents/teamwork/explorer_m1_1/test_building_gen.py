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

# Test parcel generation along roads
buildings = []

for feat in roads['features']:
    props = feat['properties']
    coords = feat['geometry']['coordinates']
    lanes = props['lanes']
    road_w = lanes * 3.5
    half_w = road_w / 2.0
    
    pts = [to_cartesian(c[1], c[0], c[2]) for c in coords]
    
    # Traverse each segment of the road
    for i in range(len(pts) - 1):
        p1 = pts[i]
        p2 = pts[i+1]
        dx = p2[0] - p1[0]
        dz = p2[2] - p1[2]
        seg_len = math.hypot(dx, dz)
        if seg_len < 30.0:
            continue
            
        ux = dx / seg_len
        uz = dz / seg_len
        # Perpendicular normal
        nx = -uz
        nz = ux
        
        # Place buildings every 40m along segment
        step = 45.0
        cur = 20.0
        while cur + 30.0 < seg_len:
            mid_x = p1[0] + ux * cur
            mid_z = p1[2] + uz * cur
            
            b_len = 32.0  # along road
            b_dep = 22.0  # away from road
            b_height = 24.0 if lanes <= 4 else 45.0
            
            # Left side building
            # Setback = half_w + curb(0.25) + sidewalk(2.0) + setback(3.0) + b_dep/2
            setback_dist = half_w + 5.25 + b_dep / 2.0
            
            # Left center
            c_left_x = mid_x + nx * setback_dist
            c_left_z = mid_z + nz * setback_dist
            
            # Right center
            c_right_x = mid_x - nx * setback_dist
            c_right_z = mid_z - nz * setback_dist
            
            buildings.append({
                "road_id": props['id'],
                "side": "left",
                "center": (round(c_left_x, 1), round(c_left_z, 1)),
                "size": (b_len, b_dep, b_height),
                "angle": math.atan2(uz, ux)
            })
            buildings.append({
                "road_id": props['id'],
                "side": "right",
                "center": (round(c_right_x, 1), round(c_right_z, 1)),
                "size": (b_len, b_dep, b_height),
                "angle": math.atan2(uz, ux)
            })
            
            cur += step

print(f"Generated {len(buildings)} procedural building parcels along corridor roads.")
print(f"Sample building parcel: {buildings[0]}")
