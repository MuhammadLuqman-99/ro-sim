"""Turn the raw rtnw.online exports into the small files the page reads.

usage: python3 -I scripts/build-data.py data/raw web/data
"""
import json
import os
import sys

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def load(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as f:
        return json.load(f)


def save(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  wrote {path} ({os.path.getsize(path):,} bytes)")


# ---- images -------------------------------------------------------------
# Icon names map to paths under rtnw.online/media/images/. Every image a page
# shows is listed in data/raw/images.txt so fetch-data.sh can download it once
# and the site serves its own copy (no hotlinking).
ICON_PATHS = load("icon_paths.json")
wanted = set()


def img(name):
    path = ICON_PATHS.get(name or "") or ICON_PATHS.get((name or "").lower())
    if not path:
        return None
    path = path.replace("\\", "/")
    wanted.add(path)
    return path


# ---- refine ---------------------------------------------------------------
r = load("refine.json")
levels = []
for l in r["levels"]:
    sup = l.get("support") or {}
    bless = sup.get("blessing") or {}
    levels.append({
        "level": l["level"],
        "success": l["success"],
        "downgrade": l["downgrade"],
        "fail": l["fail"],
        "mat": l["material"]["item"]["name"],
        "matAmount": l["material"]["amount"],
        "matStarstone": (l["material"].get("replaceCurrency") or {}).get("amount", 0),
        "zeny": (l.get("consumable") or {}).get("amount", 0),
        "blessing": {
            "enabled": bool(bless.get("enabled")),
            "item": (bless.get("item") or {}).get("name"),
            "amount": bless.get("amount", 0),
            "starstone": (bless.get("replaceCurrency") or {}).get("amount", 0),
            "bonus": bless.get("successBonus", 0),
        },
    })
save("refine.json", {
    "maxLevel": r["maxLevel"],
    "safeLevels": r["safeLevels"],
    "pityBonuses": {int(k): v for k, v in r["pityBonuses"].items()},
    "siteProjections": [
        {"from": m["startLevel"], "to": m["targetLevel"], "attempts": m["attempts"]}
        for m in r["milestoneProjections"]
    ],
    "levels": levels,
})

# ---- cards ----------------------------------------------------------------
hand = load("cards.json")["cards"]
fusion = {c["id"]: c for c in load("card_fusion.json")["cards"]}
sources = load("card_sources.json")["cards"]
cards = []
for c in hand:
    f = fusion.get(c["id"], {})
    seen, src = set(), []
    for s in sorted(sources.get(str(c["id"]), []), key=lambda s: -(s.get("rate") or 0)):
        key = (s["name"], s.get("level"), s.get("type"))
        if key not in seen:
            seen.add(key)
            src.append(s)
    cards.append({
        "id": c["id"],
        "name": c["name"],
        "slot": c["card_type_name"],
        "q": c["quality"],
        "lines": [x for x in c["effect_lines"] if not x.startswith("Includes up to")],
        "affixes": c.get("words_count", 0),
        "mvp": bool(c.get("has_mvp_source") or f.get("quality_type") == 1),
        "obtain": c.get("obtain_source_tables", []),
        "img": img(c.get("item_icon")),
        "src": [{"n": s["name"], "lv": s.get("level"), "t": s.get("type"), "r": s.get("rate"),
                 "img": img(s.get("image"))} for s in src],
    })
save("cards.json", cards)

# ---- equipment ------------------------------------------------------------
idx = load("equipment_index.json")
detail = {}
for fn in sorted(os.listdir(os.path.join(RAW, "equipment"))):
    with open(os.path.join(RAW, "equipment", fn), encoding="utf-8") as f:
        items = json.load(f)["items"]
    for it in (items.values() if isinstance(items, dict) else items):
        detail[it["id"]] = it
slot_names = {int(k): (v["name"] or "Headwear") for k, v in idx["assemblyTypes"].items()}
type_names = {int(k): v["name"] for k, v in idx["itemTypes"].items()}
suit_names = {s["id"]: s["name"].strip() for s in idx["suits"]}
items = []
for it in idx["items"]:
    d = detail.get(it["id"], {})
    items.append({
        "id": it["id"],
        "n": it["name"].strip(),
        "slot": slot_names.get(it["assemblyType"]) or type_names.get(it["itemType"], "?"),
        "kind": type_names.get(it["itemType"], ""),
        "q": it["quality"],
        "lv": it["openLevel"],
        "jobs": None if it["jobAll"] else it["jobLimits"],
        "st": d.get("stats", []),
        "rf": d.get("refinePerLevel", []),
        "suit": [suit_names[s] for s in it.get("suits", []) if s in suit_names],
        "img": img(it.get("icon")),
    })
save("equipment.json", {
    "attrs": {k: {"n": v["name"], "ps": v["percentage_show"], "rn": v["reserve_number"]}
              for k, v in idx["attributes"].items()},
    "jobs": {k: v["name"] for k, v in idx["jobs"].items()},
    "items": items,
})

# ---- shop -----------------------------------------------------------------
shop = load("shop.json")
cur = {c["id"]: c["name"] for c in shop["currencies"]}
save("shop.json", [
    {
        "n": i["name"], "store": i["storeName"], "tab": i["tabName"], "num": i["itemNum"],
        "cur": cur.get(i["price"]["currencyId"], str(i["price"]["currencyId"])),
        "curId": i["price"]["currencyId"], "price": i["price"]["amount"],
        "limit": i.get("limitNum") or 0, "refresh": i.get("timeRefresh") or 0,
    }
    for i in shop["items"] if (i.get("price") or {}).get("amount")
])

with open(os.path.join(RAW, "images.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(sorted(wanted)) + "\n")
print(f"  {len(wanted)} images listed in {RAW}/images.txt")
