# -*- coding: utf-8 -*-
"""FDS 傢俬建模任務的讀取與完成回報（只用標準庫）。

    python fds_task.py get <task_id>
    python fds_task.py finish <task_id> --status done --skp <路徑> --summary "..." [--issue "..."]
    python fds_task.py finish <task_id> --status failed --summary "原因"

完成訊號是任務資料夾內的 result.json；FDS Worker 只認這個檔案。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

TASK_ROOT = os.path.abspath(os.environ.get("FDS_JZXZ_TASK_ROOT") or os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "FDS", "SkpWorker", "jzxz-tasks"))


def fail(message: str) -> None:
    print("錯誤：" + message, file=sys.stderr)
    sys.exit(1)


def inside(root: str, path: str) -> bool:
    root, path = os.path.normcase(os.path.abspath(root)), os.path.normcase(os.path.abspath(path))
    return path != root and os.path.commonpath([root, path]) == root


def load(task_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", task_id or ""):
        fail("task_id 格式不正確")
    folder = os.path.join(TASK_ROOT, task_id)
    task_file = os.path.join(folder, "task.json")
    if not os.path.isfile(task_file):
        fail("找不到任務 " + task_id)
    with open(task_file, encoding="utf-8-sig") as fh:
        task = json.load(fh)
    output = os.path.abspath(os.path.join(folder, task.get("output_skp") or os.path.join("output", task_id + ".skp")))
    if not inside(folder, output):
        fail("output_skp 必須在任務資料夾內")
    images = [os.path.abspath(os.path.join(folder, p)) for p in task.get("reference_images") or []]
    images = [p for p in images if inside(folder, p) and os.path.isfile(p)]
    return folder, task, output, images


def cmd_get(args) -> None:
    folder, task, output, images = load(args.task_id)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    d = task.get("dimensions_mm") or {}
    p = task.get("product") or {}
    lines = [
        "# FDS 建模任務 " + args.task_id,
        "產品：%s（型號 %s，類別 %s）" % (p.get("name", "-"), p.get("model", "-"), p.get("category", "-")),
        "尺寸（mm）：寬 %s × 深 %s × 高 %s" % (d.get("width", "?"), d.get("depth", "?"), d.get("height", "?")),
    ]
    if task.get("materials"):
        lines.append("材質：" + task["materials"])
    if task.get("notes"):
        lines.append("備註：" + task["notes"])
    lines.append("參考圖（先用 ViewImages 逐張查看）：" + ("\n" + "\n".join("- " + i for i in images) if images else "無"))
    lines.append("必須儲存到：" + output.replace("\\", "/"))
    print("\n".join(lines))


def cmd_finish(args) -> None:
    folder, _task, output, _images = load(args.task_id)
    result = {
        "task_id": args.task_id,
        "status": args.status,
        "summary": (args.summary or "")[:4000],
        "known_issues": [str(i) for i in (args.issue or [])][:50],
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    if args.status == "done":
        if not args.skp or os.path.normcase(os.path.abspath(args.skp)) != os.path.normcase(output):
            fail("--skp 必須是 " + output.replace("\\", "/"))
        if not os.path.isfile(output) or os.path.getsize(output) == 0:
            fail("SKP 尚未儲存，請先儲存再回報")
        with open(output, "rb") as fh:
            data = fh.read()
        result.update(skp_path=output, skp_bytes=len(data), skp_sha256=hashlib.sha256(data).hexdigest())
    tmp = os.path.join(folder, "result.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, os.path.join(folder, "result.json"))
    print("已回報" + ("完成，FDS 會檢查並上傳模型。" if args.status == "done" else "失敗。"))


def main() -> None:
    ap = argparse.ArgumentParser(description="FDS 傢俬建模任務")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("get")
    g.add_argument("task_id")
    g.set_defaults(func=cmd_get)
    f = sub.add_parser("finish")
    f.add_argument("task_id")
    f.add_argument("--status", choices=["done", "failed"], required=True)
    f.add_argument("--skp")
    f.add_argument("--summary", required=True)
    f.add_argument("--issue", action="append")
    f.set_defaults(func=cmd_finish)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
