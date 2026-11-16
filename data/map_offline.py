#!/usr/bin/env python3
"""
SimplexDM Offline Map Tile Downloader (`data/map_offline.py`)

Downloads OpenStreetMap-compatible slippy map tiles (raster PNG and/or vector PBF)
for offline operation in `data/tiles/raster/{z}/{x}/{y}.png` and
`data/tiles/vector/{z}/{x}/{y}.pbf`, and writes `data/tiles/meta.json`.

Supports both interactive prompts (documented in README Installation Step 5)
and non-interactive CLI flags for automated workflows:

  cd data && python map_offline.py
  python data/map_offline.py --type raster --bbox world --zooms 0-5 --workers 6
  python data/map_offline.py --type vector --bbox -10,35,15,55 --zooms 0-6 \
      --vector-url "https://example.org/tiles/{z}/{x}/{y}.pbf"
"""

from __future__ import annotations

import argparse
import concurrent.futures
import math
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Dict, Iterator, List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from update_meta import update_meta  # noqa: E402

DEFAULT_RASTER_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
DEFAULT_VECTOR_URL = "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf"
DEFAULT_USER_AGENT = "SimplexDM-OfflineMapDownloader/2.0 (desktop offline tile cache)"
MAX_MERCATOR_LAT = 85.05112878


def deg2num(lat_deg: float, lon_deg: float, zoom: int) -> Tuple[int, int]:
    """Convert WGS84 latitude/longitude to Web Mercator XYZ tile coordinates."""
    if zoom < 0 or zoom > 22:
        raise ValueError(f"Zoom level out of range [0, 22]: {zoom}")
    clamped_lat = max(-MAX_MERCATOR_LAT, min(MAX_MERCATOR_LAT, float(lat_deg)))
    clamped_lon = max(-180.0, min(179.9999999, float(lon_deg)))
    n = 1 << zoom
    xtile = int((clamped_lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(clamped_lat)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    xtile = max(0, min(n - 1, xtile))
    ytile = max(0, min(n - 1, ytile))
    return (xtile, ytile)


def parse_bbox(spec: str) -> Tuple[float, float, float, float]:
    """Parse 'world' or 'west,south,east,north' into (west, south, east, north)."""
    raw = (spec or "").strip().lower()
    if not raw or raw == "world":
        return (-180.0, -MAX_MERCATOR_LAT, 180.0, MAX_MERCATOR_LAT)
    parts = [p.strip() for p in raw.replace(" ", ",").split(",") if p.strip()]
    if len(parts) != 4:
        raise ValueError("Bounding box must be 'world' or four numbers: 'west,south,east,north'.")
    west, south, east, north = (float(p) for p in parts)
    if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
        raise ValueError("Longitude bounds must be within [-180, 180].")
    if not (-90.0 <= south <= 90.0 and -90.0 <= north <= 90.0):
        raise ValueError("Latitude bounds must be within [-90, 90].")
    if south > north:
        raise ValueError("South latitude must be <= north latitude.")
    if west > east:
        raise ValueError("West longitude must be <= east longitude.")
    return (west, south, east, north)


def parse_zooms(spec: str) -> List[int]:
    """Parse zoom expressions like '0-7', '0,1,2,3', or '0-3,5'."""
    raw = (spec or "").strip()
    if not raw:
        raise ValueError("Zoom specification cannot be empty (e.g. '0-5').")
    zooms = set()
    for token in raw.split(","):
        t = token.strip()
        if not t:
            continue
        if "-" in t:
            lo_s, hi_s = t.split("-", 1)
            lo, hi = int(lo_s.strip()), int(hi_s.strip())
            if lo > hi:
                raise ValueError(f"Invalid zoom range '{t}': start > end.")
            for z in range(lo, hi + 1):
                if z < 0 or z > 22:
                    raise ValueError(f"Zoom {z} out of supported range [0, 22].")
                zooms.add(z)
        else:
            z = int(t)
            if z < 0 or z > 22:
                raise ValueError(f"Zoom {z} out of supported range [0, 22].")
            zooms.add(z)
    if not zooms:
        raise ValueError("No valid zoom levels specified.")
    return sorted(zooms)


def parse_tile_type(spec: str) -> List[str]:
    """Map interactive choice ('1','2','3') or name ('vector','raster','both') to tile modes."""
    val = (spec or "").strip().lower()
    if val in {"1", "vector", "pbf", "mvt"}:
        return ["vector"]
    if val in {"2", "raster", "png", ""}:
        return ["raster"]
    if val in {"3", "both", "all"}:
        return ["raster", "vector"]
    raise ValueError(f"Invalid tile type '{spec}'. Choose 1 (vector), 2 (raster), or 3 (both).")


def count_tiles(bbox: Tuple[float, float, float, float], zooms: List[int]) -> int:
    west, south, east, north = bbox
    total = 0
    for z in zooms:
        x0, y0 = deg2num(north, west, z)
        x1, y1 = deg2num(south, east, z)
        total += (x1 - x0 + 1) * (y1 - y0 + 1)
    return total


def iter_tiles(bbox: Tuple[float, float, float, float], zooms: List[int]) -> Iterator[Tuple[int, int, int]]:
    west, south, east, north = bbox
    for z in zooms:
        x0, y0 = deg2num(north, west, z)
        x1, y1 = deg2num(south, east, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield (z, x, y)


def format_tile_url(template: str, z: int, x: int, y: int) -> str:
    subdomains = ("a", "b", "c")
    s = subdomains[(x + y) % len(subdomains)]
    return template.format(s=s, z=z, x=x, y=y)


def download_single_tile(
    url: str,
    dest_path: str,
    *,
    overwrite: bool = False,
    retries: int = 3,
    timeout: float = 20.0,
    user_agent: str = DEFAULT_USER_AGENT,
) -> str:
    """Returns 'skipped', 'downloaded', or raises on persistent failure."""
    if not overwrite and os.path.isfile(dest_path) and os.path.getsize(dest_path) > 0:
        return "skipped"

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    part_path = f"{dest_path}.{os.getpid()}.part"

    last_err: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": user_agent})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status}")
                data = resp.read()
            if not data:
                raise RuntimeError("Empty tile payload")
            with open(part_path, "wb") as fh:
                fh.write(data)
            os.replace(part_path, dest_path)
            return "downloaded"
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, RuntimeError) as exc:
            last_err = exc
            if os.path.exists(part_path):
                try:
                    os.remove(part_path)
                except OSError:
                    pass
            if attempt + 1 < retries:
                time.sleep(min(4.0, 0.4 * (2**attempt)))

    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def download_tiles(
    out_dir: str,
    tile_modes: List[str],
    bbox: Tuple[float, float, float, float],
    zooms: List[int],
    *,
    workers: int = 6,
    raster_url: str = DEFAULT_RASTER_URL,
    vector_url: str = DEFAULT_VECTOR_URL,
    overwrite: bool = False,
    retries: int = 3,
    timeout: float = 20.0,
    dry_run: bool = False,
    quiet: bool = False,
) -> Dict[str, int]:
    out_abs = os.path.abspath(out_dir)
    os.makedirs(out_abs, exist_ok=True)

    per_mode = count_tiles(bbox, zooms)
    planned = per_mode * len(tile_modes)

    if dry_run:
        return {"planned": planned, "downloaded": 0, "skipped": 0, "failed": 0}

    downloaded = 0
    skipped = 0
    failed = 0

    for mode in tile_modes:
        ext = "png" if mode == "raster" else "pbf"
        url_tpl = raster_url if mode == "raster" else vector_url
        mode_root = os.path.join(out_abs, mode)
        os.makedirs(mode_root, exist_ok=True)

        if not quiet:
            print(f"Downloading {mode} tiles (zooms {zooms[0]}-{zooms[-1]}, {per_mode:,} tiles) -> {mode_root}")

        def task(coord: Tuple[int, int, int]) -> str:
            z, x, y = coord
            url = format_tile_url(url_tpl, z, x, y)
            dest = os.path.join(mode_root, str(z), str(x), f"{y}.{ext}")
            return download_single_tile(
                url,
                dest,
                overwrite=overwrite,
                retries=retries,
                timeout=timeout,
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, int(workers))) as pool:
            futures = [pool.submit(task, c) for c in iter_tiles(bbox, zooms)]
            for idx, fut in enumerate(concurrent.futures.as_completed(futures), 1):
                try:
                    status = fut.result()
                    if status == "downloaded":
                        downloaded += 1
                    else:
                        skipped += 1
                except Exception as exc:
                    failed += 1
                    if not quiet and failed <= 5:
                        print(f"  [warn] {exc}", file=sys.stderr)
                if not quiet and (idx % 250 == 0 or idx == per_mode):
                    print(
                        f"  [{mode}] {idx:,}/{per_mode:,} (downloaded={downloaded:,}, skipped={skipped:,}, failed={failed:,})"
                    )

    update_meta(out_abs, bbox=bbox, quiet=quiet)
    return {
        "planned": planned,
        "downloaded": downloaded,
        "skipped": skipped,
        "failed": failed,
    }


def prompt_interactive() -> Tuple[List[str], Tuple[float, float, float, float], List[int], int]:
    print("=== SimplexDM Offline Map Tile Downloader ===")
    print("Tile type: [1] Vector (PBF)  [2] Raster (PNG)  [3] Both")
    raw_type = input("Select tile type [2]: ").strip() or "2"
    modes = parse_tile_type(raw_type)

    raw_bbox = input("Bounding box ('world' or 'west,south,east,north') [world]: ").strip() or "world"
    bbox = parse_bbox(raw_bbox)

    raw_zooms = input("Zoom levels (e.g. '0-5' or '0-7') [0-5]: ").strip() or "0-5"
    zooms = parse_zooms(raw_zooms)

    raw_workers = input("Download workers [6]: ").strip() or "6"
    workers = max(1, min(32, int(raw_workers)))
    return (modes, bbox, zooms, workers)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download offline raster/vector map tiles for SimplexDM.")
    parser.add_argument("--type", dest="tile_type", help="1|vector, 2|raster, or 3|both")
    parser.add_argument("--bbox", help="'world' or 'west,south,east,north'")
    parser.add_argument("--zooms", help="Zoom range, e.g. '0-5' or '0-7'")
    parser.add_argument("--workers", type=int, default=6, help="Concurrent download workers (default: 6)")
    parser.add_argument(
        "--out",
        default=os.path.join(SCRIPT_DIR, "tiles"),
        help="Target tile directory (default: data/tiles)",
    )
    parser.add_argument("--raster-url", default=DEFAULT_RASTER_URL, help="Raster tile URL template")
    parser.add_argument("--vector-url", default=DEFAULT_VECTOR_URL, help="Vector tile URL template")
    parser.add_argument("--overwrite", action="store_true", help="Re-download existing tiles")
    parser.add_argument("--retries", type=int, default=3, help="Retry attempts per tile (default: 3)")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout in seconds (default: 20)")
    parser.add_argument("--dry-run", action="store_true", help="Compute tile counts without downloading")
    parser.add_argument("--quiet", action="store_true", help="Minimal console output")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    try:
        non_interactive = any(x is not None for x in (args.tile_type, args.bbox, args.zooms)) or args.dry_run
        if non_interactive:
            modes = parse_tile_type(args.tile_type or "2")
            bbox = parse_bbox(args.bbox or "world")
            zooms = parse_zooms(args.zooms or "0-5")
            workers = max(1, int(args.workers))
        else:
            modes, bbox, zooms, workers = prompt_interactive()

        result = download_tiles(
            out_dir=args.out,
            tile_modes=modes,
            bbox=bbox,
            zooms=zooms,
            workers=workers,
            raster_url=args.raster_url,
            vector_url=args.vector_url,
            overwrite=args.overwrite,
            retries=args.retries,
            timeout=args.timeout,
            dry_run=args.dry_run,
            quiet=args.quiet,
        )
        if not args.quiet:
            print(f"Summary: {result}")
        return 0 if result["failed"] == 0 else 1
    except KeyboardInterrupt:
        print("\nCancelled by user.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
