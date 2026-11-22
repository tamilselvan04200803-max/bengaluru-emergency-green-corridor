#!/usr/bin/env python3
"""
extract_edge_geometry.py

Derives real road polylines for every edge of Data/GeoJSON/bengaluru_network.json
from the OSM caches already present in this repository (cache/ and osmnx_cache/),
and writes the result to Data/GeoJSON/bengaluru_edge_geometry.json.

Why a sidecar instead of putting geometry in the network JSON:
  The network graph is hand-curated (33 junctions, 61 directed edges). The polylines
  are derived. Keeping them in a separate generated file means the curated graph and
  the derived geometry can be reviewed and regenerated independently.

Method
  1. Build an undirected drivable graph from every `highway=*` way in the cached
     Overpass/OSMnx responses.
  2. For each network edge, snap both endpoint junctions to their nearest OSM node.
  3. Take the shortest path between those nodes. That path *is* the road corridor:
     it follows the real carriageway rather than the straight line between junctions.
  4. Emit the path as a lon/lat/alt polyline plus its true arc length.

An undirected graph is used deliberately: a two-way road has exactly one geometry
regardless of travel direction, so `_fwd` and `_bwd` carriageways share a polyline
(the backward one reversed). Directed shortest paths would otherwise return
different lengths for the two directions of the same street.

Provenance: every polyline emitted here is OSM-derived (VERIFIED geometry). Edges
whose endpoints could not be resolved are omitted and fall back to the connector
geometry synthesised at load time by js/network.js.

Run: python Scripts/extract_edge_geometry.py
"""
import collections
import glob
import heapq
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NETWORK_PATH = os.path.join(ROOT, 'Data', 'GeoJSON', 'bengaluru_network.json')
OUTPUT_PATH = os.path.join(ROOT, 'Data', 'GeoJSON', 'bengaluru_edge_geometry.json')
CACHE_GLOBS = [os.path.join(ROOT, 'cache', '*.json'),
               os.path.join(ROOT, 'osmnx_cache', '*.json')]

DRIVABLE = {
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
    'unclassified', 'residential', 'living_street',
}

# Junction coordinates corrected by the Stage-2 integrity audit.
# node_st_johns was 840 m south of St. John's Medical College Hospital; the repo's own
# OSM tile carries two BMTC stop positions tagged name="St. John's Hospital" at
# (12.929405, 77.615913) and (12.929472, 77.616001).
NODE_OVERRIDES = {
    'node_st_johns': {'lat': 12.92940, 'lon': 77.61600},
}


def haversine(a, b):
    R = 6378137.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load_osm():
    nodes, ways = {}, {}
    for pattern in CACHE_GLOBS:
        for path in sorted(glob.glob(pattern)):
            try:
                with open(path, encoding='utf-8') as f:
                    payload = json.load(f)
            except (OSError, ValueError):
                continue
            elements = payload.get('elements', [])
            for el in elements:
                if el.get('type') == 'node' and 'lat' in el:
                    nodes.setdefault(el['id'], (el['lat'], el['lon']))
            for el in elements:
                if el.get('type') == 'way' and (el.get('tags') or {}).get('highway') in DRIVABLE:
                    ways.setdefault(el['id'], el)
    return nodes, ways


def build_graph(nodes, ways):
    adj = collections.defaultdict(list)
    for way in ways.values():
        seq = [n for n in way.get('nodes', []) if n in nodes]
        for i in range(len(seq) - 1):
            a, b = seq[i], seq[i + 1]
            w = haversine(nodes[a], nodes[b])
            adj[a].append((b, w))
            adj[b].append((a, w))
    return adj


def build_spatial_index(nodes, cell=0.0015):
    index = collections.defaultdict(list)
    for nid, (lat, lon) in nodes.items():
        index[(int(lat / cell), int(lon / cell))].append(nid)
    return index, cell


def nearest_node(index, cell, nodes, lat, lon, radius=2):
    ci, cj = int(lat / cell), int(lon / cell)
    best = (float('inf'), None)
    for di in range(-radius, radius + 1):
        for dj in range(-radius, radius + 1):
            for nid in index.get((ci + di, cj + dj), ()):
                d = haversine((lat, lon), nodes[nid])
                if d < best[0]:
                    best = (d, nid)
    return best


def shortest_path(adj, nodes, source, target):
    if source == target:
        return 0.0, [source]
    goal = nodes[target]
    queue = [(0.0, 0.0, source)]
    cost = {source: 0.0}
    parent = {}
    settled = set()
    while queue:
        _, dist, node = heapq.heappop(queue)
        if node in settled:
            continue
        settled.add(node)
        if node == target:
            path = [target]
            while path[-1] != source:
                path.append(parent[path[-1]])
            path.reverse()
            return dist, path
        here = nodes[node]
        for nxt, w in adj.get(node, ()):
            candidate = dist + w
            if candidate < cost.get(nxt, float('inf')) - 1e-9:
                cost[nxt] = candidate
                parent[nxt] = node
                heapq.heappush(queue, (candidate + haversine(here, goal), candidate, nxt))
    return None, None


def dedupe(points):
    out = [points[0]]
    for p in points[1:]:
        if abs(p[0] - out[-1][0]) > 1e-9 or abs(p[1] - out[-1][1]) > 1e-9:
            out.append(p)
    return out


def main():
    with open(NETWORK_PATH, encoding='utf-8') as f:
        network = json.load(f)

    nodes_by_id = {n['id']: dict(n) for n in network['nodes']}
    for node_id, fix in NODE_OVERRIDES.items():
        if node_id in nodes_by_id:
            nodes_by_id[node_id].update(fix)

    osm_nodes, osm_ways = load_osm()
    print(f"[geometry] OSM nodes={len(osm_nodes)} drivable ways={len(osm_ways)}")
    if not osm_nodes:
        raise SystemExit("[geometry] no OSM caches found under cache/ or osmnx_cache/")

    adj = build_graph(osm_nodes, osm_ways)
    index, cell = build_spatial_index(osm_nodes)

    edges_out = {}
    unresolved = []
    for edge in network['edges']:
        a = nodes_by_id.get(edge['from_node'])
        b = nodes_by_id.get(edge['to_node'])
        if not a or not b:
            unresolved.append((edge['id'], 'endpoint not in node table'))
            continue
        start = (a['lat'], a['lon'])
        end = (b['lat'], b['lon'])
        snap_a, node_a = nearest_node(index, cell, osm_nodes, *start)
        snap_b, node_b = nearest_node(index, cell, osm_nodes, *end)
        if node_a is None or node_b is None or node_a == node_b:
            unresolved.append((edge['id'], 'endpoints snap to the same OSM node'))
            continue
        length, path = shortest_path(adj, osm_nodes, node_a, node_b)
        if path is None:
            unresolved.append((edge['id'], 'no OSM path between endpoints'))
            continue

        points = dedupe([list(start)] + [list(osm_nodes[n]) for n in path] + [list(end)])
        coords = [[round(p[1], 6), round(p[0], 6), round(edge.get('elevation_m', 0.0), 1)] for p in points]
        arc = sum(haversine((coords[i][1], coords[i][0]), (coords[i + 1][1], coords[i + 1][0]))
                  for i in range(len(coords) - 1))
        edges_out[edge['id']] = {
            'length_m': round(arc, 1),
            'snap_offset_m': {'from': round(snap_a, 1), 'to': round(snap_b, 1)},
            'coordinates': coords,
        }

    for edge_id in list(edges_out):
        if edge_id.endswith('_bwd'):
            forward_id = edge_id[:-4] + '_fwd'
            if forward_id in edges_out:
                twin = edges_out[forward_id]
                edges_out[edge_id] = {
                    'length_m': twin['length_m'],
                    'snap_offset_m': {'from': twin['snap_offset_m']['to'], 'to': twin['snap_offset_m']['from']},
                    'coordinates': list(reversed(twin['coordinates'])),
                }

    payload = {
        'metadata': {
            'project': 'TrafficClearance',
            'provenance': 'OSM_VERIFIED',
            'source': 'cache/*.json and osmnx_cache/*.json (Overpass API / OSMnx responses checked into this repository)',
            'method': 'undirected shortest path between endpoint junctions on the cached drivable graph',
            'crs': 'EPSG:4326',
            'datum': 'WGS84',
            'coordinate_order': 'lon,lat,alt',
            'edge_count': len(edges_out),
            'unresolved': [{'edge_id': e, 'reason': r} for e, r in unresolved],
        },
        'edges': edges_out,
    }
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=1, ensure_ascii=False)

    print(f"[geometry] wrote {OUTPUT_PATH}")
    print(f"[geometry] resolved {len(edges_out)}/{len(network['edges'])} edges")
    for edge_id, reason in unresolved:
        print(f"[geometry]   unresolved {edge_id}: {reason}")
    for headline in ('edge_silk_stjohns_fwd', 'edge_silk_stjohns_bwd', 'edge_silk_forum_fwd', 'edge_forum_stjohns_fwd'):
        if headline in edges_out:
            print(f"[geometry]   {headline}: {edges_out[headline]['length_m']:.0f} m, "
                  f"{len(edges_out[headline]['coordinates'])} points")


if __name__ == '__main__':
    sys.exit(main())