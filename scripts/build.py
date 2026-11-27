#!/usr/bin/env python3
"""Build, test, and package gemini-deepseek-hybrid/plugin.zip for vBook."""
import argparse
import json
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DIR = os.path.join(ROOT, "gemini-deepseek-hybrid")
SRC_DIR = os.path.join(EXT_DIR, "src")
ROOT_JSON = os.path.join(ROOT, "plugin.json")
INNER_JSON = os.path.join(EXT_DIR, "plugin.json")
STATUS_JS = os.path.join(SRC_DIR, "status-check.js")
OUT_ZIP = os.path.join(EXT_DIR, "plugin.zip")


def bump_version():
    with open(INNER_JSON, "r", encoding="utf-8") as f:
        inner = json.load(f)
    old_ver = int(inner["metadata"]["version"])
    new_ver = old_ver + 1
    inner["metadata"]["version"] = new_ver
    with open(INNER_JSON, "w", encoding="utf-8") as f:
        json.dump(inner, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with open(ROOT_JSON, "r", encoding="utf-8") as f:
        reg = json.load(f)
    reg["data"][0]["version"] = new_ver
    reg["data"][0]["path"] = "https://raw.githubusercontent.com/Lyte9955/vbook-ext/main/gemini-deepseek-hybrid/plugin.zip"
    with open(ROOT_JSON, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with open(STATUS_JS, "r", encoding="utf-8") as f:
        st = f.read()
    st_new, cnt = re.subn(r"Phiên bản extension: v\d+", f"Phiên bản extension: v{new_ver}", st, count=1)
    if cnt != 1:
        raise RuntimeError("Could not update version string in src/status-check.js")
    with open(STATUS_JS, "w", encoding="utf-8") as f:
        f.write(st_new)

    print(f"[BUMP] Version updated: v{old_ver} -> v{new_ver}")
    return new_ver


def run_checks():
    js_files = sorted(fn for fn in os.listdir(SRC_DIR) if fn.endswith(".js"))
    for fn in js_files:
        subprocess.run(["node", "--check", os.path.join(SRC_DIR, fn)], check=True)
    print(f"[OK] Syntax check passed for {len(js_files)} JS files.")

    test_file = os.path.join(ROOT, "tests", "run_tests.js")
    subprocess.run(["node", test_file], check=True)


def pack_zip():
    js_files = sorted(fn for fn in os.listdir(SRC_DIR) if fn.endswith(".js"))
    entries = ["icon.png", "plugin.json"] + [f"src/{fn}" for fn in js_files]
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in entries:
            full = os.path.join(EXT_DIR, rel)
            zi = zipfile.ZipInfo(rel)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.create_system = 3
            zi.external_attr = 0o100644 << 16
            with open(full, "rb") as f:
                zf.writestr(zi, f.read())
    print(f"[PACK] Wrote {OUT_ZIP} ({len(entries)} entries, {os.path.getsize(OUT_ZIP)} bytes).")


def main():
    parser = argparse.ArgumentParser(description="Build & test vBook Gemini + DeepSeek Hybrid extension.")
    parser.add_argument("--bump", action="store_true", help="Increment extension version by +1 before building.")
    args = parser.parse_args()

    if args.bump:
        bump_version()
    run_checks()
    pack_zip()


if __name__ == "__main__":
    main()
