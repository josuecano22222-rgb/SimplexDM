#!/usr/bin/env python3
"""
Build the SimplexDM offline world label SQLite database (`data/labels-world-base.db`)
from an OpenStreetMap `.osm.pbf` extract (via `osmium export`) or from a GeoJSON /
GeoJSONSeq file (`.geojson`, `.json`, `.geojsonseq`, `.ndjson`).

Schema matches `main/gis/services/labelDatabaseService.js` and
`main/gis/services/labelDownloadService.js` (`verifyLabelsSqlite`):
  - `labels`       : core place/feature attributes, multilingual names, zoom range, priority
  - `labels_rtree` : SQLite R*Tree spatial index (`id, bbox_west, bbox_east, bbox_south, bbox_north`)
  - `labels_meta`  : dataset build provenance and statistics

Usage:
  python scripts/build_world_labels.py --pbf asia-latest.osm.pbf --out data/labels-world-base.db
  python scripts/build_world_labels.py --geojson places.geojson --out data/labels-world-base.db
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

try:
    from tqdm import tqdm  # type: ignore
except ImportError:  # pragma: no cover - optional progress bar
    tqdm = None


SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;

CREATE TABLE IF NOT EXISTS labels (
    id         INTEGER PRIMARY KEY,
    osm_id     TEXT,
    name       TEXT NOT NULL,
    name_en    TEXT,
    name_ar    TEXT,
    name_local TEXT,
    type       TEXT NOT NULL,
    subtype    TEXT,
    priority   REAL NOT NULL DEFAULT 0,
    zoom_min   INTEGER NOT NULL DEFAULT 0,
    zoom_max   INTEGER NOT NULL DEFAULT 18,
    lon        REAL NOT NULL,
    lat        REAL NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS labels_rtree USING rtree(
    id,
    bbox_west, bbox_east,
    bbox_south, bbox_north
);

CREATE TABLE IF NOT EXISTS labels_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_labels_zoom_priority ON labels (zoom_min, zoom_max, priority DESC);
CREATE INDEX IF NOT EXISTS idx_labels_type          ON labels (type);
CREATE INDEX IF NOT EXISTS idx_labels_name          ON labels (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_labels_name_en       ON labels (name_en COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_labels_name_ar       ON labels (name_ar);
"""

# Maps OSM `place=*` values to (label_type, base_priority, zoom_min, zoom_max)
PLACE_RULES: Dict[str, Tuple[str, float, int, int]] = {
    "country": ("country", 1000.0, 0, 8),
    "state": ("state", 820.0, 2, 10),
    "province": ("state", 800.0, 2, 10),
    "region": ("state", 780.0, 3, 10),
    "city": ("city", 700.0, 3, 15),
    "municipality": ("city", 640.0, 5, 15),
    "town": ("town", 520.0, 6, 16),
    "island": ("island", 500.0, 4, 15),
    "archipelago": ("island", 540.0, 3, 13),
    "islet": ("island", 320.0, 10, 18),
    "village": ("village", 380.0, 9, 17),
    "hamlet": ("village", 300.0, 11, 18),
    "suburb": ("suburb", 360.0, 10, 18),
    "borough": ("suburb", 400.0, 9, 17),
    "quarter": ("suburb", 320.0, 11, 18),
    "neighbourhood": ("suburb", 280.0, 12, 18),
    "locality": ("poi", 200.0, 12, 18),
}

MOTORWAY_VALUES = {"motorway", "trunk"}
ROAD_VALUES = {
    "primary",
    "secondary",
    "tertiary",
    "residential",
    "unclassified",
    "living_street",
    "pedestrian",
}
WATERWAY_VALUES = {"river", "canal", "stream"}
LAKE_WATER_VALUES = {"lake", "reservoir", "lagoon", "basin", "oxbow"}
MOUNTAIN_NATURAL_VALUES = {"peak", "volcano", "mountain_range", "ridge", "saddle"}
AIRPORT_VALUES = {"aerodrome", "airport", "international", "heliport"}
RAILWAY_VALUES = {"station", "halt", "tram_stop", "subway_entrance"}
SCHOOL_AMENITIES = {"school", "university", "college", "kindergarten"}
HOSPITAL_AMENITIES = {"hospital", "clinic", "doctors"}
POI_AMENITIES = {
    "townhall",
    "embassy",
    "police",
    "fire_station",
    "library",
    "museum",
    "place_of_worship",
    "marketplace",
    "bus_station",
    "ferry_terminal",
    "theatre",
    "courthouse",
    "post_office",
}
VALID_LABEL_TYPES = {
    "country",
    "state",
    "city",
    "town",
    "village",
    "suburb",
    "motorway",
    "road",
    "waterway",
    "lake",
    "mountain",
    "island",
    "airport",
    "railway",
    "hospital",
    "school",
    "poi",
    "custom",
}

_LANG_TAG_RE = re.compile(r"^name:([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)$")


def parse_population(raw: Any) -> int:
    if raw is None:
        return 0
    if isinstance(raw, (int, float)):
        return max(0, int(raw))
    cleaned = re.sub(r"[^\d]", "", str(raw).split(";")[0])
    if not cleaned:
        return 0
    try:
        return max(0, int(cleaned))
    except ValueError:
        return 0


def parse_elevation(raw: Any) -> float:
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    match = re.search(r"-?\d+(?:\.\d+)?", str(raw))
    if not match:
        return 0.0
    try:
        return float(match.group(0))
    except ValueError:
        return 0.0


def classify_tags(tags: Dict[str, Any]) -> Optional[Tuple[str, str, float, int, int]]:
    """
    Classify OSM / GeoJSON properties into (type, subtype, priority, zoom_min, zoom_max).
    Returns None if the feature is not a relevant label candidate.
    """
    # Direct pre-classified custom/Natural Earth features
    explicit_type = str(tags.get("label_type") or tags.get("simplex_type") or "").strip().lower()
    if explicit_type in VALID_LABEL_TYPES:
        subtype = str(tags.get("subtype") or explicit_type)
        prio = float(tags.get("priority", 500.0))
        zmin = int(tags.get("zoom_min", 0))
        zmax = int(tags.get("zoom_max", 18))
        return (explicit_type, subtype, prio, max(0, zmin), min(22, zmax))

    pop = parse_population(tags.get("population"))
    pop_bonus = min(180.0, math.log10(pop + 1) * 25.0) if pop > 0 else 0.0
    capital = str(tags.get("capital") or "").strip().lower()
    cap_bonus = 90.0 if capital in {"yes", "2"} else (40.0 if capital in {"4", "state", "admin"} else 0.0)

    place = str(tags.get("place") or "").strip().lower()
    if place in PLACE_RULES:
        ltype, base_prio, zmin, zmax = PLACE_RULES[place]
        # Promote mega-cities to earlier zoom levels
        if ltype == "city" and (pop >= 1_000_000 or cap_bonus >= 90.0):
            zmin = min(zmin, 2)
        elif ltype == "town" and pop >= 50_000:
            zmin = min(zmin, 5)
        return (ltype, place, round(base_prio + pop_bonus + cap_bonus, 2), zmin, zmax)

    # Administrative boundaries (country / state) when tagged as boundary=administrative
    if str(tags.get("boundary") or "").strip().lower() == "administrative":
        admin_level = str(tags.get("admin_level") or "").strip()
        if admin_level == "2":
            return ("country", "admin_2", round(990.0 + pop_bonus, 2), 0, 8)
        if admin_level in {"3", "4"}:
            return ("state", f"admin_{admin_level}", round(800.0 + pop_bonus, 2), 3, 10)

    aeroway = str(tags.get("aeroway") or "").strip().lower()
    if aeroway in AIRPORT_VALUES:
        iata_bonus = 60.0 if tags.get("iata") else 0.0
        zmin = 7 if iata_bonus else 10
        return ("airport", aeroway, round(460.0 + iata_bonus, 2), zmin, 18)

    natural = str(tags.get("natural") or "").strip().lower()
    water = str(tags.get("water") or "").strip().lower()
    if natural in MOUNTAIN_NATURAL_VALUES:
        ele = parse_elevation(tags.get("ele"))
        ele_bonus = min(80.0, max(0.0, ele / 100.0))
        zmin = 6 if ele >= 3000 else (8 if ele >= 1000 else 10)
        return ("mountain", natural, round(410.0 + ele_bonus, 2), zmin, 17)
    if natural == "water" or water in LAKE_WATER_VALUES:
        subtype = water if water else "water"
        if water in LAKE_WATER_VALUES or natural == "water":
            return ("lake", subtype, round(420.0 + pop_bonus, 2), 6, 17)
    if natural in {"bay", "strait", "sea", "ocean"}:
        zmin = 1 if natural in {"sea", "ocean"} else 6
        prio = 850.0 if natural in {"sea", "ocean"} else 430.0
        return ("lake", natural, prio, zmin, 14)

    waterway = str(tags.get("waterway") or "").strip().lower()
    if waterway in WATERWAY_VALUES:
        prio = 390.0 if waterway == "river" else 280.0
        zmin = 8 if waterway == "river" else 11
        return ("waterway", waterway, prio, zmin, 18)

    highway = str(tags.get("highway") or "").strip().lower()
    if highway in MOTORWAY_VALUES:
        prio = 370.0 if highway == "motorway" else 340.0
        return ("motorway", highway, prio, 8, 18)
    if highway in ROAD_VALUES:
        prio_map = {"primary": 300.0, "secondary": 260.0, "tertiary": 230.0}
        zmin_map = {"primary": 10, "secondary": 11, "tertiary": 12}
        return (
            "road",
            highway,
            prio_map.get(highway, 180.0),
            zmin_map.get(highway, 14),
            18,
        )

    railway = str(tags.get("railway") or "").strip().lower()
    if railway in RAILWAY_VALUES:
        prio = 340.0 if railway == "station" else 250.0
        zmin = 11 if railway == "station" else 13
        return ("railway", railway, prio, zmin, 18)

    amenity = str(tags.get("amenity") or "").strip().lower()
    if amenity in HOSPITAL_AMENITIES:
        prio = 350.0 if amenity == "hospital" else 260.0
        zmin = 11 if amenity == "hospital" else 14
        return ("hospital", amenity, prio, zmin, 18)
    if amenity in SCHOOL_AMENITIES:
        prio = 340.0 if amenity == "university" else 260.0
        zmin = 11 if amenity == "university" else 14
        return ("school", amenity, prio, zmin, 18)
    if amenity in POI_AMENITIES:
        return ("poi", amenity, 220.0, 13, 18)

    tourism = str(tags.get("tourism") or "").strip().lower()
    if tourism in {"attraction", "museum", "viewpoint", "national_park", "zoo", "theme_park"}:
        return ("poi", tourism, 240.0, 12, 18)

    historic = str(tags.get("historic") or "").strip().lower()
    if historic in {"castle", "monument", "archaeological_site", "ruins", "memorial"}:
        return ("poi", historic, 230.0, 12, 18)

    return None


def extract_names(tags: Dict[str, Any]) -> Optional[Tuple[str, Optional[str], Optional[str], Optional[str]]]:
    """
    Extract (name, name_en, name_ar, name_local_json) from OSM or GeoJSON tags.
    """
    primary = (
        tags.get("name")
        or tags.get("name:en")
        or tags.get("name_en")
        or tags.get("int_name")
        or tags.get("official_name")
        or tags.get("ref")
    )
    if not primary:
        return None
    name = str(primary).strip()
    if not name:
        return None

    name_en_raw = tags.get("name:en") or tags.get("name_en") or tags.get("int_name")
    name_ar_raw = tags.get("name:ar") or tags.get("name_ar")
    name_en = str(name_en_raw).strip() if name_en_raw else None
    name_ar = str(name_ar_raw).strip() if name_ar_raw else None

    local_map: Dict[str, str] = {}
    existing_local = tags.get("name_local")
    if isinstance(existing_local, dict):
        for k, v in existing_local.items():
            if v:
                local_map[str(k)] = str(v).strip()
    elif isinstance(existing_local, str) and existing_local.strip():
        try:
            parsed = json.loads(existing_local)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    if v:
                        local_map[str(k)] = str(v).strip()
        except json.JSONDecodeError:
            pass

    for k, v in tags.items():
        if not v:
            continue
        m = _LANG_TAG_RE.match(str(k))
        if m:
            lang = m.group(1).lower()
            if lang not in {"en", "ar"}:
                val = str(v).strip()
                if val:
                    local_map[lang] = val

    name_local = json.dumps(local_map, ensure_ascii=False, separators=(",", ":")) if local_map else None
    return (name, name_en, name_ar, name_local)


def _iter_coords(coords: Any) -> Iterator[Tuple[float, float]]:
    if not isinstance(coords, (list, tuple)) or not coords:
        return
    if isinstance(coords[0], (int, float)) and len(coords) >= 2:
        lon, lat = float(coords[0]), float(coords[1])
        if math.isfinite(lon) and math.isfinite(lat):
            yield (lon, lat)
        return
    for item in coords:
        yield from _iter_coords(item)


def _ring_area_centroid(ring: List[Any]) -> Tuple[float, float, float]:
    """Planar shoelace signed area and centroid for an exterior polygon ring."""
    pts = [(float(c[0]), float(c[1])) for c in ring if isinstance(c, (list, tuple)) and len(c) >= 2]
    n = len(pts)
    if n < 3:
        if not pts:
            return (0.0, 0.0, 0.0)
        sx = sum(p[0] for p in pts) / n
        sy = sum(p[1] for p in pts) / n
        return (0.0, sx, sy)
    area2 = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        area2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(area2) < 1e-12:
        sx = sum(p[0] for p in pts) / n
        sy = sum(p[1] for p in pts) / n
        return (0.0, sx, sy)
    cx /= 3.0 * area2
    cy /= 3.0 * area2
    return (abs(area2) * 0.5, cx, cy)


def compute_representative_point_and_bbox(
    geom: Dict[str, Any],
) -> Optional[Tuple[float, float, float, float, float, float]]:
    """
    Returns (lon, lat, bbox_west, bbox_east, bbox_south, bbox_north) or None.
    """
    if not isinstance(geom, dict):
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not gtype or coords is None:
        return None

    all_pts = list(_iter_coords(coords))
    if not all_pts:
        return None

    lons = [p[0] for p in all_pts]
    lats = [p[1] for p in all_pts]
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)

    if gtype == "Point":
        lon, lat = all_pts[0]
    elif gtype == "LineString":
        lon, lat = all_pts[len(all_pts) // 2]
    elif gtype == "MultiLineString" and isinstance(coords, list) and coords:
        longest = max(coords, key=lambda seg: len(seg) if isinstance(seg, list) else 0)
        seg_pts = list(_iter_coords(longest))
        lon, lat = seg_pts[len(seg_pts) // 2] if seg_pts else all_pts[0]
    elif gtype == "Polygon" and isinstance(coords, list) and coords:
        _, lon, lat = _ring_area_centroid(coords[0])
    elif gtype == "MultiPolygon" and isinstance(coords, list) and coords:
        best = (0.0, (west + east) * 0.5, (south + north) * 0.5)
        for poly in coords:
            if isinstance(poly, list) and poly:
                area, cx, cy = _ring_area_centroid(poly[0])
                if area >= best[0]:
                    best = (area, cx, cy)
        _, lon, lat = best
    else:
        lon, lat = (west + east) * 0.5, (south + north) * 0.5

    if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
        return None
    west = max(-180.0, min(180.0, west))
    east = max(-180.0, min(180.0, east))
    south = max(-90.0, min(90.0, south))
    north = max(-90.0, min(90.0, north))
    return (lon, lat, west, east, south, north)


def iter_features_from_pbf(pbf_path: str, osmium_bin: str = "osmium") -> Iterator[Dict[str, Any]]:
    resolved = shutil.which(osmium_bin)
    if not resolved:
        raise RuntimeError(
            f'"{osmium_bin}" CLI not found on PATH. Install osmium-tool (https://osmcode.org/osmium-tool/) '
            "and ensure `osmium` is available on PATH."
        )
    if not os.path.isfile(pbf_path):
        raise FileNotFoundError(f"PBF file not found: {pbf_path}")

    cmd = [resolved, "export", "-f", "geojsonseq", "-u", "type_id", pbf_path]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1024 * 1024,
    )
    assert proc.stdout is not None
    assert proc.stderr is not None
    try:
        for raw_line in proc.stdout:
            line = raw_line.lstrip("\x1e").strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict) and obj.get("type") == "Feature":
                    yield obj
            except json.JSONDecodeError:
                continue
        ret = proc.wait()
        if ret != 0:
            err_msg = proc.stderr.read().strip()
            raise RuntimeError(f"osmium export failed (exit {ret}): {err_msg}")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def iter_features_from_geojson(geojson_path: str) -> Iterator[Dict[str, Any]]:
    if not os.path.isfile(geojson_path):
        raise FileNotFoundError(f"GeoJSON file not found: {geojson_path}")

    lower = geojson_path.lower()
    if lower.endswith((".geojsonseq", ".ndjson", ".jsonl")):
        with open(geojson_path, "r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.lstrip("\x1e").strip()
                if not line:
                    continue
                obj = json.loads(line)
                if isinstance(obj, dict) and obj.get("type") == "Feature":
                    yield obj
        return

    with open(geojson_path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    if isinstance(doc, dict):
        if doc.get("type") == "FeatureCollection" and isinstance(doc.get("features"), list):
            for feat in doc["features"]:
                if isinstance(feat, dict) and feat.get("type") == "Feature":
                    yield feat
        elif doc.get("type") == "Feature":
            yield doc
    elif isinstance(doc, list):
        for feat in doc:
            if isinstance(feat, dict) and feat.get("type") == "Feature":
                yield feat


def build_database(
    features: Iterable[Dict[str, Any]],
    out_path: str,
    *,
    source_label: str = "osm",
    min_zoom: int = 0,
    max_zoom: int = 18,
    batch_size: int = 5000,
    show_progress: bool = True,
) -> Dict[str, Any]:
    out_abs = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_abs) or ".", exist_ok=True)
    tmp_path = f"{out_abs}.building"
    for candidate in (tmp_path, f"{tmp_path}-wal", f"{tmp_path}-shm"):
        if os.path.exists(candidate):
            os.remove(candidate)

    conn = sqlite3.connect(tmp_path)
    inserted = 0
    scanned = 0
    type_counts: Dict[str, int] = {}

    try:
        conn.executescript(SCHEMA_SQL)

        label_batch: List[Tuple[Any, ...]] = []
        rtree_batch: List[Tuple[Any, ...]] = []
        next_id = 1

        def flush() -> None:
            if not label_batch:
                return
            with conn:
                conn.executemany(
                    """
                    INSERT INTO labels (
                        id, osm_id, name, name_en, name_ar, name_local,
                        type, subtype, priority, zoom_min, zoom_max, lon, lat
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    label_batch,
                )
                conn.executemany(
                    """
                    INSERT INTO labels_rtree (
                        id, bbox_west, bbox_east, bbox_south, bbox_north
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    rtree_batch,
                )
            label_batch.clear()
            rtree_batch.clear()

        iterator: Iterable[Dict[str, Any]] = features
        if show_progress and tqdm is not None:
            iterator = tqdm(features, desc="Building labels DB", unit="feat")

        for feat in iterator:
            scanned += 1
            props = feat.get("properties")
            geom = feat.get("geometry")
            if not isinstance(props, dict) or not isinstance(geom, dict):
                continue

            names = extract_names(props)
            if names is None:
                continue

            classified = classify_tags(props)
            if classified is None:
                continue

            ltype, subtype, prio, zmin, zmax = classified
            eff_zmin = max(min_zoom, zmin)
            eff_zmax = min(max_zoom, zmax)
            if eff_zmin > eff_zmax:
                continue

            spatial = compute_representative_point_and_bbox(geom)
            if spatial is None:
                continue
            lon, lat, west, east, south, north = spatial
            name, name_en, name_ar, name_local = names
            osm_id = str(feat.get("id") or props.get("@id") or props.get("osm_id") or "") or None

            row_id = next_id
            next_id += 1
            label_batch.append(
                (
                    row_id,
                    osm_id,
                    name,
                    name_en,
                    name_ar,
                    name_local,
                    ltype,
                    subtype,
                    prio,
                    eff_zmin,
                    eff_zmax,
                    round(lon, 6),
                    round(lat, 6),
                )
            )
            rtree_batch.append(
                (
                    row_id,
                    round(west, 6),
                    round(east, 6),
                    round(south, 6),
                    round(north, 6),
                )
            )
            inserted += 1
            type_counts[ltype] = type_counts.get(ltype, 0) + 1

            if len(label_batch) >= batch_size:
                flush()

        flush()
        conn.executescript(INDEX_SQL)

        meta_entries = {
            "format_version": "1",
            "source": source_label,
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "count": str(inserted),
            "scanned": str(scanned),
            "zoom_min": str(min_zoom),
            "zoom_max": str(max_zoom),
            "type_counts": json.dumps(type_counts, sort_keys=True),
        }
        with conn:
            conn.executemany(
                "INSERT OR REPLACE INTO labels_meta (key, value) VALUES (?, ?)",
                list(meta_entries.items()),
            )

        conn.execute("ANALYZE;")
        conn.execute("PRAGMA journal_mode = DELETE;")
        conn.execute("VACUUM;")
        conn.close()
    except Exception:
        conn.close()
        for candidate in (tmp_path, f"{tmp_path}-wal", f"{tmp_path}-shm"):
            if os.path.exists(candidate):
                try:
                    os.remove(candidate)
                except OSError:
                    pass
        raise

    for stale in (out_abs, f"{out_abs}-wal", f"{out_abs}-shm"):
        if os.path.exists(stale):
            os.remove(stale)
    os.replace(tmp_path, out_abs)

    return {
        "out": out_abs,
        "count": inserted,
        "scanned": scanned,
        "type_counts": type_counts,
        "size_bytes": os.path.getsize(out_abs),
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build SimplexDM offline map labels SQLite database (labels-world-base.db)."
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--pbf", help="Input OpenStreetMap .osm.pbf extract path (requires osmium CLI)")
    src.add_argument(
        "--geojson",
        help="Input GeoJSON / GeoJSONSeq file (.geojson, .json, .geojsonseq, .ndjson)",
    )
    parser.add_argument(
        "--out",
        default=os.path.join("data", "labels-world-base.db"),
        help="Output SQLite file path (default: data/labels-world-base.db)",
    )
    parser.add_argument("--min-zoom", type=int, default=0, help="Minimum zoom level (default: 0)")
    parser.add_argument("--max-zoom", type=int, default=18, help="Maximum zoom level (default: 18)")
    parser.add_argument("--batch-size", type=int, default=5000, help="SQLite insert batch size")
    parser.add_argument("--osmium-bin", default="osmium", help="osmium executable name or path")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    if args.min_zoom < 0 or args.max_zoom > 22 or args.min_zoom > args.max_zoom:
        print("Error: invalid zoom range (expected 0 <= min-zoom <= max-zoom <= 22).", file=sys.stderr)
        return 2

    try:
        if args.pbf:
            feats = iter_features_from_pbf(args.pbf, osmium_bin=args.osmium_bin)
            source_label = os.path.basename(args.pbf)
        else:
            feats = iter_features_from_geojson(args.geojson)
            source_label = os.path.basename(args.geojson)

        stats = build_database(
            feats,
            args.out,
            source_label=source_label,
            min_zoom=args.min_zoom,
            max_zoom=args.max_zoom,
            batch_size=max(1, args.batch_size),
            show_progress=not args.quiet,
        )
        if not args.quiet:
            mb = stats["size_bytes"] / (1024 * 1024)
            print(
                f"Built {stats['out']} — {stats['count']:,} labels "
                f"(from {stats['scanned']:,} features, {mb:.2f} MB)"
            )
        return 0
    except Exception as exc:
        print(f"Error building label database: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
