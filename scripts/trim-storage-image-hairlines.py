#!/usr/bin/env python3
"""
Scan product-images Storage for solid black/white *hairline* edges and upsert
trimmed JPEGs in place.

Hairline = edge column/row is solid dark/light, but the adjacent inward line is not.
(White-background product photos are not trimmed.)

Usage:
  python3 scripts/trim-storage-image-hairlines.py            # dry-run scan
  python3 scripts/trim-storage-image-hairlines.py --apply    # trim + upsert
  python3 scripts/trim-storage-image-hairlines.py --apply --limit 500
  python3 scripts/trim-storage-image-hairlines.py --apply --prefix products/quote_
"""

from __future__ import annotations

import argparse
import concurrent.futures
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from typing import Iterable

from PIL import Image

PROJECT_REF = "riaubhtruisbwdlwjzur"
BUCKET = "product-images"
DARK = 24
LIGHT = 250
SOLID_RATIO = 0.92
MAX_TRIM = 4
PUBLIC_BASE = (
    f"https://{PROJECT_REF}.supabase.co/storage/v1/object/public/{BUCKET}/"
)
UPLOAD_BASE = (
    f"https://{PROJECT_REF}.supabase.co/storage/v1/object/{BUCKET}/"
)
SQL_API = (
    f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
)


def env_key() -> str:
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("FURNITURE_SUPABASE_SERVICE_ROLE_KEY")
        or ""
    ).strip()
    if not key:
        raise SystemExit("Missing SUPABASE_SERVICE_ROLE_KEY")
    return key


def access_token() -> str:
    tok = (os.environ.get("SUPABASE_ACCESS_TOKEN") or "").strip()
    if not tok:
        raise SystemExit("Missing SUPABASE_ACCESS_TOKEN")
    return tok


def sql_query(query: str):
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        SQL_API,
        data=body,
        headers={
            "Authorization": f"Bearer {access_token()}",
            "Content-Type": "application/json",
            # Cloudflare blocks default Python-urllib UA (error 1010).
            "User-Agent": "furniture1000-trim-hairlines/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise RuntimeError(f"SQL {exc.code}: {detail}") from exc


def list_image_names(prefix: str | None, limit: int | None) -> list[str]:
    where = [
        f"bucket_id = '{BUCKET}'",
        "("
        "lower(name) like '%.jpg' or lower(name) like '%.jpeg' "
        "or lower(name) like '%.png' or lower(name) like '%.webp'"
        ")",
    ]
    if prefix:
        safe = prefix.replace("'", "''")
        where.append(f"name like '{safe}%'")
    # Page through results — Management API can reject huge single selects.
    page_size = 1000 if limit is None else min(1000, int(limit))
    names: list[str] = []
    offset = 0
    while True:
        if limit is not None and len(names) >= limit:
            break
        take = page_size
        if limit is not None:
            take = min(page_size, limit - len(names))
        q = (
            "select name from storage.objects where "
            + " and ".join(where)
            + " order by name"
            + f" limit {take} offset {offset}"
        )
        rows = sql_query(q)
        batch = [str(r["name"]) for r in rows if r.get("name")]
        if not batch:
            break
        names.extend(batch)
        offset += len(batch)
        print(f"  listed {len(names)}…", flush=True)
        if len(batch) < take:
            break
    return names[:limit] if limit is not None else names


def fetch_image(path: str) -> Image.Image:
    req = urllib.request.Request(
        PUBLIC_BASE + path,
        headers={"User-Agent": "furniture1000-trim-hairlines/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return Image.open(io.BytesIO(resp.read())).convert("RGBA")


def solid_col(px, w, h, x, kind: str) -> bool:
    hits = 0
    for y in range(h):
        r, g, b, a = px[x, y]
        if kind == "dark":
            ok = a < 10 or (r <= DARK and g <= DARK and b <= DARK)
        else:
            ok = a >= 10 and r >= LIGHT and g >= LIGHT and b >= LIGHT
        if ok:
            hits += 1
    return hits / h >= SOLID_RATIO


def solid_row(px, w, h, y, kind: str) -> bool:
    hits = 0
    for x in range(w):
        r, g, b, a = px[x, y]
        if kind == "dark":
            ok = a < 10 or (r <= DARK and g <= DARK and b <= DARK)
        else:
            ok = a >= 10 and r >= LIGHT and g >= LIGHT and b >= LIGHT
        if ok:
            hits += 1
    return hits / w >= SOLID_RATIO


def find_trim_box(im: Image.Image) -> tuple[int, int, int, int] | None:
    w, h = im.size
    if w < 8 or h < 8:
        return None
    px = im.load()
    left, right, top, bottom = 0, w - 1, 0, h - 1

    def trim_kind(kind: str) -> None:
        nonlocal left, right, top, bottom
        while (
            left <= right
            and left < MAX_TRIM
            and solid_col(px, w, h, left, kind)
            and not solid_col(px, w, h, left + 1, kind)
        ):
            left += 1
        while (
            right >= left
            and (w - 1 - right) < MAX_TRIM
            and solid_col(px, w, h, right, kind)
            and not solid_col(px, w, h, right - 1, kind)
        ):
            right -= 1
        while (
            top <= bottom
            and top < MAX_TRIM
            and solid_row(px, w, h, top, kind)
            and not solid_row(px, w, h, top + 1, kind)
        ):
            top += 1
        while (
            bottom >= top
            and (h - 1 - bottom) < MAX_TRIM
            and solid_row(px, w, h, bottom, kind)
            and not solid_row(px, w, h, bottom - 1, kind)
        ):
            bottom -= 1

    trim_kind("dark")
    trim_kind("light")
    if left == 0 and right == w - 1 and top == 0 and bottom == h - 1:
        return None
    if right < left or bottom < top:
        return None
    return left, top, right + 1, bottom + 1


def upsert_jpeg(path: str, data: bytes, key: str) -> None:
    req = urllib.request.Request(
        UPLOAD_BASE + path,
        data=data,
        method="PUT",
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "image/jpeg",
            "x-upsert": "true",
            "User-Agent": "furniture1000-trim-hairlines/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        resp.read()


def process_one(path: str, apply: bool, key: str) -> dict:
    try:
        im = fetch_image(path)
        box = find_trim_box(im)
        if not box:
            return {"path": path, "status": "clean"}
        if not apply:
            return {"path": path, "status": "needs_trim", "box": box, "size": im.size}
        cropped = im.crop(box).convert("RGB")
        buf = io.BytesIO()
        cropped.save(buf, format="JPEG", quality=92, optimize=True)
        upsert_jpeg(path, buf.getvalue(), key)
        return {
            "path": path,
            "status": "trimmed",
            "box": box,
            "from": im.size,
            "to": cropped.size,
        }
    except Exception as exc:  # noqa: BLE001
        return {"path": path, "status": "error", "error": str(exc)[:200]}


def batched(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Upsert trimmed images")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--prefix", type=str, default=None)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument(
        "--report",
        type=str,
        default="/tmp/trim-storage-image-hairlines-report.json",
    )
    args = parser.parse_args()

    key = env_key()
    names = list_image_names(args.prefix, args.limit)
    print(
        f"images={len(names)} apply={args.apply} workers={args.workers} "
        f"prefix={args.prefix or '*'}",
        flush=True,
    )
    if not names:
        return 0

    t0 = time.time()
    results: list[dict] = []
    counts: Counter[str] = Counter()

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(process_one, name, args.apply, key) for name in names]
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            row = fut.result()
            results.append(row)
            counts[row["status"]] += 1
            done += 1
            if done % 100 == 0 or done == len(names):
                print(
                    f"  progress {done}/{len(names)} "
                    f"trimmed={counts['trimmed']} needs={counts['needs_trim']} "
                    f"clean={counts['clean']} err={counts['error']}",
                    flush=True,
                )

    report = {
        "apply": args.apply,
        "prefix": args.prefix,
        "total": len(names),
        "counts": dict(counts),
        "elapsed_sec": round(time.time() - t0, 1),
        "affected": [
            r
            for r in results
            if r["status"] in ("needs_trim", "trimmed")
        ],
        "errors": [r for r in results if r["status"] == "error"][:50],
    }
    with open(args.report, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    print(
        f"DONE counts={dict(counts)} elapsed={report['elapsed_sec']}s "
        f"report={args.report}",
        flush=True,
    )
    return 0 if counts.get("error", 0) == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
