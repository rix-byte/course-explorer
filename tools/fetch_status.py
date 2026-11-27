"""Lift open/closed status for the Szczyrk map: fetch the resort's own lift table, write web/data/szczyrk.status.json.
Run by .github/workflows/status.yml every 15 minutes. Writes only when a status changed; leaves the file alone on any failure."""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://laravel.szczyrkowski.pl/api/szczyrkowski/lanovky?lang=en&"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "data/szczyrk.status.json")
KNOWN = {"closed": "closed", "open": "open"}


def state(alt: str) -> str | None:
    a = alt.strip().lower()
    return KNOWN.get(a) or ("preparing" if "prepar" in a else None)


req = urllib.request.Request(URL, headers={"User-Agent": "course-explorer status (+https://github.com/rix-byte/course-explorer)"})
html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
lifts = {}
for blk in re.findall(r'<tr id="item_\d+">(.*?)</tr>', html, re.S):
    alt = re.search(r'class="stav"><img[^>]*alt="([^"]*)"', blk)
    code = re.search(r'class="cislo"><span>([^<]*)</span>', blk)
    if not (alt and code):
        continue
    st = state(alt.group(1))
    if st is None:
        print("unknown status text, skipped:", code.group(1), repr(alt.group(1)))
        continue
    lifts[code.group(1).strip().lower()] = st
if not lifts:   # the page changed or is down: keep the last good file
    sys.exit("no lifts parsed, nothing written")

old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
if old.get("lifts") == lifts:
    print("unchanged:", lifts)
    sys.exit(0)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"updated": datetime.now(timezone.utc).strftime("%d.%m %H:%M UTC"), "lifts": lifts, "pistes": {}}, indent=1), encoding="utf-8")
print("written:", lifts)
