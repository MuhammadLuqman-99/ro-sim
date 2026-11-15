"""Download the images listed in images.txt that are not on disk yet.

usage: python3 -I scripts/get-images.py data/raw/images.txt web/img
Four at a time, so rtnw.online sees a light load.
"""
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://rtnw.online/media/images/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
listing, out = sys.argv[1], sys.argv[2]
with open(listing, encoding="utf-8") as f:
    paths = [p.strip() for p in f if p.strip()]
todo = [p for p in paths
        if not os.path.exists(os.path.join(out, p)) or os.path.getsize(os.path.join(out, p)) == 0]


def get(p):
    dest = os.path.join(out, p)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        req = urllib.request.Request(BASE + p, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        with open(dest + ".part", "wb") as f:
            f.write(data)
        os.replace(dest + ".part", dest)
        return None
    except Exception as e:  # keep going, report at the end
        return f"{p}: {e}"


print(f"Images: {len(todo)} to download ({len(paths)} in total)")
with ThreadPoolExecutor(4) as pool:
    errors = [e for e in pool.map(get, todo) if e]
for e in errors[:10]:
    print("  missing:", e)
if errors:
    print(f"  {len(errors)} images failed; the page shows a blank square for those")
