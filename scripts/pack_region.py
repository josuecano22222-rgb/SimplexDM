#!/usr/bin/env python3
"""
Export a geographic bounding box from a SimplexDM world label database into a
distributable `.rlp` (Region Label Pack) archive containing `meta.json` and `data.db`.

Compatible with `main/gis/services/labelRegionImporter.js` and
`main/gis/services/labelDatabaseService.js`.

Usage:
  python scripts/pack_region.py --db data/labels-world-base.db --id my-region \
    --west -10 --south 35 --east 15 --north 55 --out dist/my-region.rlp
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import zipfile
from typing import Any, Dict, List, Optional, Tuple

REGION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

REGION_SCHEMA_SQL = """
PRAGMA journal_mode = DELETE;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

CREATE TABLE labels (
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

CREATE VIRTUAL TABLE labels_rtree USING rtree(
    id,
    bbox_west, bbox_east,
    bbox_south, bbox_north
);
"""

REGION_INDEX_SQL = """
CREATE INDEX idx_labels_zoom_priority ON labels (zoom_min, zoom_max, priority DESC);
CREATE INDEX idx_labels_type          ON labels (type);
CREATE INDEX idx_labels_name          ON labels (name COLLATE NOCASE);
CREATE INDEX idx_labels_name_en       ON labels (name_en COLLATE NOCASE);
CREATE INDEX idx_labels_name_ar       ON labels (name_ar);
"""


def validate_region_id(region_id: str) -> str:
    rid = (region_id or "").strip()
    if not REGION_ID_RE.match(rid) or ".." in rid:
        raise ValueError(
            f'Invalid region id "{region_id}". Use 1-64 alphanumeric, dot, underscore, or hyphen characters.'
        )
    return rid


def validate_bbox(west: float, south: float, east: float, north: float) -> Tuple[float, float, float, float]:
    if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
        raise ValueError("Longitude bounds (--west, --east) must be within [-180, 180].")
    if not (-90.0 <= south <= 90.0 and -90.0 <= north <= 90.0):
        raise ValueError("Latitude bounds (--south, --north) must be within [-90, 90].")
    if south > north:
        raise ValueError("--south must be <= --north.")
    return (west, south, east, north)


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pack_region(
    source_db: str,
    region_id: str,
    west: float,
    south: float,
    east: float,
    north: float,
    out_rlp: str,
    *,
    name: Optional[str] = None,
    min_zoom: int = 0,
    max_zoom: int = 22,
    types: Optional[List[str]] = None,
) -> Dict[str, Any]:
    rid = validate_region_id(region_id)
    west, south, east, north = validate_bbox(west, south, east, north)

    if not os.path.isfile(source_db):
        raise FileNotFoundError(f"Source label database not found: {source_db}")

    src_conn = sqlite3.connect(f"file:{os.path.abspath(source_db)}?mode=ro", uri=True)
    try:
        # Check whether optional osm_id column is present in source DB
        cols = {row[1] for row in src_conn.execute("PRAGMA table_info(labels)").fetchall()}
        osm_col = "l.osm_id" if "osm_id" in cols else "NULL AS osm_id"

        type_clause = ""
        type_params: List[Any] = []
        if types:
            placeholders = ",".join("?" for _ in types)
            type_clause = f"AND l.type IN ({placeholders})"
            type_params = list(types)

        def query_lon_span(w: float, e: float) -> List[Tuple[Any, ...]]:
            sql = f"""
                SELECT l.id, {osm_col}, l.name, l.name_en, l.name_ar, l.name_local,
                       l.type, l.subtype, l.priority, l.zoom_min, l.zoom_max, l.lon, l.lat,
                       r.bbox_west, r.bbox_east, r.bbox_south, r.bbox_north
                FROM   labels l
                JOIN   labels_rtree r ON l.id = r.id
                WHERE  r.bbox_west  <= ? AND r.bbox_east  >= ?
                  AND  r.bbox_south <= ? AND r.bbox_north >= ?
                  AND  l.zoom_max   >= ? AND l.zoom_min   <= ?
                  {type_clause}
                ORDER  BY l.priority DESC, l.id ASC
            """
            params = [e, w, north, south, min_zoom, max_zoom, *type_params]
            return src_conn.execute(sql, params).fetchall()

        if west <= east:
            rows = query_lon_span(west, east)
        else:
            # Antimeridian crossing (e.g. west=170, east=-170)
            seen = set()
            rows = []
            for part in (query_lon_span(west, 180.0), query_lon_span(-180.0, east)):
                for row in part:
                    if row[0] not in seen:
                        seen.add(row[0])
                        rows.append(row)
    finally:
        src_conn.close()

    out_abs = os.path.abspath(out_rlp)
    os.makedirs(os.path.dirname(out_abs) or ".", exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="simplex_rlp_") as tmpdir:
        region_db_path = os.path.join(tmpdir, "data.db")
        dst_conn = sqlite3.connect(region_db_path)
        actual_zmin: Optional[int] = None
        actual_zmax: Optional[int] = None
        try:
            dst_conn.executescript(REGION_SCHEMA_SQL)
            label_rows: List[Tuple[Any, ...]] = []
            rtree_rows: List[Tuple[Any, ...]] = []
            for row in rows:
                (
                    lid,
                    osm_id,
                    lname,
                    name_en,
                    name_ar,
                    name_local,
                    ltype,
                    subtype,
                    prio,
                    zmin,
                    zmax,
                    lon,
                    lat,
                    bw,
                    be,
                    bs,
                    bn,
                ) = row
                clamped_zmin = max(min_zoom, int(zmin))
                clamped_zmax = min(max_zoom, int(zmax))
                if clamped_zmin > clamped_zmax:
                    continue
                actual_zmin = clamped_zmin if actual_zmin is None else min(actual_zmin, clamped_zmin)
                actual_zmax = clamped_zmax if actual_zmax is None else max(actual_zmax, clamped_zmax)
                label_rows.append(
                    (
                        lid,
                        osm_id,
                        lname,
                        name_en,
                        name_ar,
                        name_local,
                        ltype,
                        subtype,
                        prio,
                        clamped_zmin,
                        clamped_zmax,
                        lon,
                        lat,
                    )
                )
                rtree_rows.append((lid, bw, be, bs, bn))

            with dst_conn:
                dst_conn.executemany(
                    """
                    INSERT INTO labels (
                        id, osm_id, name, name_en, name_ar, name_local,
                        type, subtype, priority, zoom_min, zoom_max, lon, lat
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    label_rows,
                )
                dst_conn.executemany(
                    """
                    INSERT INTO labels_rtree (
                        id, bbox_west, bbox_east, bbox_south, bbox_north
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    rtree_rows,
                )
            dst_conn.executescript(REGION_INDEX_SQL)
            dst_conn.execute("ANALYZE;")
            dst_conn.execute("VACUUM;")
        finally:
            dst_conn.close()

        digest = sha256_file(region_db_path)
        db_size = os.path.getsize(region_db_path)
        zoom_pair = [
            actual_zmin if actual_zmin is not None else min_zoom,
            actual_zmax if actual_zmax is not None else min(max_zoom, 18),
        ]

        meta: Dict[str, Any] = {
            "id": rid,
            "name": name or rid,
            "formatVersion": 1,
            "bbox": [west, south, east, north],
            "zoom": zoom_pair,
            "count": len(label_rows),
            "sizeBytes": db_size,
            "sha256": digest,
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        }

        tmp_zip = f"{out_abs}.part"
        if os.path.exists(tmp_zip):
            os.remove(tmp_zip)
        try:
            with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
                zf.writestr("meta.json", json.dumps(meta, indent=2, ensure_ascii=False))
                zf.write(region_db_path, arcname="data.db")
            os.replace(tmp_zip, out_abs)
        except Exception:
            if os.path.exists(tmp_zip):
                os.remove(tmp_zip)
            raise

    return {**meta, "out": out_abs, "archiveBytes": os.path.getsize(out_abs)}


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cut a distributable .rlp label region pack from labels-world-base.db."
    )
    parser.add_argument("--db", required=True, help="Source SQLite database (e.g. data/labels-world-base.db)")
    parser.add_argument("--id", required=True, help="Unique region identifier (e.g. my-region)")
    parser.add_argument("--name", default=None, help="Human-readable region display name")
    parser.add_argument("--west", type=float, required=True, help="West longitude (-180..180)")
    parser.add_argument("--south", type=float, required=True, help="South latitude (-90..90)")
    parser.add_argument("--east", type=float, required=True, help="East longitude (-180..180)")
    parser.add_argument("--north", type=float, required=True, help="North latitude (-90..90)")
    parser.add_argument("--min-zoom", type=int, default=0, help="Minimum zoom level (default: 0)")
    parser.add_argument("--max-zoom", type=int, default=22, help="Maximum zoom level (default: 22)")
    parser.add_argument("--types", default=None, help="Optional comma-separated label types filter")
    parser.add_argument("--out", required=True, help="Output .rlp archive path (e.g. dist/my-region.rlp)")
    parser.add_argument("--quiet", action="store_true", help="Suppress console summary")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    type_list = [t.strip() for t in args.types.split(",") if t.strip()] if args.types else None
    try:
        info = pack_region(
            source_db=args.db,
            region_id=args.id,
            west=args.west,
            south=args.south,
            east=args.east,
            north=args.north,
            out_rlp=args.out,
            name=args.name,
            min_zoom=args.min_zoom,
            max_zoom=args.max_zoom,
            types=type_list,
        )
        if not args.quiet:
            kb = info["archiveBytes"] / 1024.0
            print(
                f"Packed region '{info['id']}' -> {info['out']} "
                f"({info['count']:,} labels, z{info['zoom'][0]}-{info['zoom'][1]}, {kb:.1f} KB, sha256={info['sha256'][:12]}...)"
            )
        return 0
    except Exception as exc:
        print(f"Error packing region: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
