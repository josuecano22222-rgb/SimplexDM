#!/usr/bin/env python3
"""
SimplexDM Offline Map Metadata Updater (`data/update_meta.py`)

Inspects an offline tile directory (default: `data/tiles/`) for installed
raster (`raster/{z}/{x}/{y}.png`) and vector (`vector/{z}/{x}/{y}.pbf|.mvt`) tiles
and writes `meta.json` consumed by `TilesetViewer` (`raster_zooms`, `vector_zooms`,
tile counts, byte sizes, and geographic bounding box).

Usage:
  cd data && python update_meta.py
  python data/update_meta.py --dir data/pro
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

RASTER_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
VECTOR_EXTS = {".pbf", ".mvt"}


def tile_bounds_wgs84(z: int, x: int, y: int) -> Tuple[float, float, float, float]:
    """Return (west, south, east, north) in WGS84 degrees for slippy tile (z, x, y)."""
    n = float(1 << z)
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (y + 1) / n))))
    return (west, south, east, north)


def scan_tile_tree(root_dir: str, valid_exts: Set[str]) -> Dict[str, Any]:
    zooms: Set[int] = set()
    tile_count = 0
    total_bytes = 0
    formats: Set[str] = set()
    finest_zoom = -1
    bbox_accum: Optional[List[float]] = None  # [west, south, east, north]

    if not os.path.isdir(root_dir):
        return {
            "zooms": [],
            "tile_count": 0,
            "total_bytes": 0,
            "formats": [],
            "bbox": None,
        }

    for z_entry in os.scandir(root_dir):
        if not z_entry.is_dir() or not z_entry.name.isdigit():
            continue
        z = int(z_entry.name)
        if z < 0 or z > 24:
            continue
        max_idx = (1 << z) - 1
        z_has_tiles = False

        for x_entry in os.scandir(z_entry.path):
            if not x_entry.is_dir() or not x_entry.name.isdigit():
                continue
            x = int(x_entry.name)
            if x < 0 or x > max_idx:
                continue

            for y_entry in os.scandir(x_entry.path):
                if not y_entry.is_file():
                    continue
                stem, ext = os.path.splitext(y_entry.name)
                ext_low = ext.lower()
                if ext_low not in valid_exts or not stem.isdigit():
                    continue
                y = int(stem)
                if y < 0 or y > max_idx:
                    continue
                size = y_entry.stat().st_size
                if size <= 0:
                    continue

                z_has_tiles = True
                tile_count += 1
                total_bytes += size
                formats.add(ext_low.lstrip("."))

                if z > finest_zoom:
                    finest_zoom = z
                    w, s, e, n = tile_bounds_wgs84(z, x, y)
                    bbox_accum = [w, s, e, n]
                elif z == finest_zoom and bbox_accum is not None:
                    w, s, e, n = tile_bounds_wgs84(z, x, y)
                    bbox_accum[0] = min(bbox_accum[0], w)
                    bbox_accum[1] = min(bbox_accum[1], s)
                    bbox_accum[2] = max(bbox_accum[2], e)
                    bbox_accum[3] = max(bbox_accum[3], n)

        if z_has_tiles:
            zooms.add(z)

    rounded_bbox = [round(v, 6) for v in bbox_accum] if bbox_accum is not None else None
    return {
        "zooms": sorted(zooms),
        "tile_count": tile_count,
        "total_bytes": total_bytes,
        "formats": sorted(formats),
        "bbox": rounded_bbox,
    }


def update_meta(
    tiles_dir: str,
    *,
    bbox: Optional[Tuple[float, float, float, float]] = None,
    attribution: str = "© OpenStreetMap contributors (ODbL)",
    quiet: bool = False,
) -> Dict[str, Any]:
    target = os.path.abspath(tiles_dir)
    os.makedirs(target, exist_ok=True)

    raster_info = scan_tile_tree(os.path.join(target, "raster"), RASTER_EXTS)
    vector_info = scan_tile_tree(os.path.join(target, "vector"), VECTOR_EXTS)

    resolved_bbox: Optional[List[float]]
    if bbox is not None:
        resolved_bbox = [round(float(v), 6) for v in bbox]
    else:
        resolved_bbox = raster_info["bbox"] or vector_info["bbox"]

    all_zooms = sorted(set(raster_info["zooms"]) | set(vector_info["zooms"]))
    meta: Dict[str, Any] = {
        "version": 2,
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "attribution": attribution,
        "raster_zooms": raster_info["zooms"],
        "vector_zooms": vector_info["zooms"],
        "min_zoom": all_zooms[0] if all_zooms else None,
        "max_zoom": all_zooms[-1] if all_zooms else None,
        "bbox": resolved_bbox,
        "raster": {
            "tile_count": raster_info["tile_count"],
            "total_bytes": raster_info["total_bytes"],
            "formats": raster_info["formats"],
            "url_template": "raster/{z}/{x}/{y}.png",
        },
        "vector": {
            "tile_count": vector_info["tile_count"],
            "total_bytes": vector_info["total_bytes"],
            "formats": vector_info["formats"],
            "url_template": "vector/{z}/{x}/{y}.pbf",
        },
    }

    meta_path = os.path.join(target, "meta.json")
    tmp_path = f"{meta_path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp_path, meta_path)

    if not quiet:
        print(
            f"Updated {meta_path}: raster_zooms={meta['raster_zooms']} "
            f"({raster_info['tile_count']:,} tiles), "
            f"vector_zooms={meta['vector_zooms']} ({vector_info['tile_count']:,} tiles)"
        )

    return meta


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update meta.json for a SimplexDM offline tiles folder.")
    parser.add_argument(
        "--dir",
        default=os.path.join(SCRIPT_DIR, "tiles"),
        help="Path to offline tiles directory containing raster/ and/or vector/ (default: data/tiles)",
    )
    parser.add_argument("--quiet", action="store_true", help="Suppress console output")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    try:
        update_meta(args.dir, quiet=args.quiet)
        return 0
    except Exception as exc:
        print(f"Error updating tile metadata: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
