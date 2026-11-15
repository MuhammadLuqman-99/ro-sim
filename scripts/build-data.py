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
# roworlddb.com's list only fills icons rtnw does not have (the skills of jobs
# only roworlddb has); those go to images_rdb.txt and come from roworlddb.
ICON_RDB = load("icon_paths_rdb.json") if os.path.exists(os.path.join(RAW, "icon_paths_rdb.json")) else {}
wanted, wanted_rdb = set(), set()


def img(name):
    key = name or ""
    path, into = ICON_PATHS.get(key) or ICON_PATHS.get(key.lower()), wanted
    if not path:
        path, into = ICON_RDB.get(key) or ICON_RDB.get(key.lower()), wanted_rdb
    if not path:
        return None
    path = path.replace("\\", "/")
    if path.startswith("/") or ".." in path.split("/"):
        return None
    into.add(path)
    return path


# ---- stat keys ----------------------------------------------------------
# One key per stat so gear (attribute ids) and cards (effect text) add up in
# the build page. Percent stats become fractions (5% -> 0.05).
import re

ATTR_KEY = {
    21: "hp", 23: "hpp", 24: "spp", 28: "atk", 29: "ratk", 31: "matk", 32: "rmatk",
    34: "def", 35: "rdef", 37: "mdef", 38: "rmdef", 41: "hit", 42: "flee", 44: "critres",
    45: "critdmg", 46: "critdmgres", 47: "pdmg", 48: "pred", 49: "mdmg", 50: "mred",
    51: "melee", 53: "ranged", 56: "vct", 58: "fct", 71: "size:Small",
    81: "race:Demi-Human", 82: "race:Brute", 83: "race:Demon", 84: "race:Plant",
    85: "race:Undead", 86: "race:Formless", 87: "race:Fish", 99: "race:Insect",
    121: "elem:Neutral", 122: "elem:Water", 123: "elem:Earth", 124: "elem:Fire", 125: "elem:Wind",
    101: "rres:Demi-Human", 102: "rres:Brute", 103: "rres:Demon", 104: "rres:Plant", 109: "rres:Insect",
    132: "eres:Water", 133: "eres:Earth", 134: "eres:Fire", 135: "eres:Wind", 152: "eresall",
    151: "elemall", 162: "load", 166: "aspd", 174: "heal",
    201: "atkp", 202: "matkp", 203: "defp", 204: "mdefp",
    231: "str", 232: "int", 233: "agi", 234: "dex", 235: "vit", 236: "luk",
    310: "fixall", 312: "fixp", 314: "fixm", 372: "rmagic",
}
CARD_KEY = {
    "STR": "str", "INT": "int", "AGI": "agi", "DEX": "dex", "VIT": "vit", "LUK": "luk",
    "ATK": "atk", "M.ATK": "matk", "CRIT": "crit", "CRIT DMG%": "critdmg", "CRIT RES": "critres",
    "HP": "hp", "SP": "sp", "Max HP%": "hpp", "DEF": "def", "M.DEF": "mdef", "HIT": "hit", "FLEE": "flee",
    "PDMG Bonus%": "pdmg", "MDMG Bonus%": "mdmg", "PDMG Reduction%": "pred", "MDMG Reduction%": "mred",
    "ASPD Bonus%": "aspd", "Size Modifier%": "sizeall", "DEF%": "defp",
    "Melee PDMG%": "melee", "Ranged PDMG%": "ranged", "Ranged MDMG%": "rmagic", "Ranged PDMG Reduction%": "rpred",
    "Elemental DMG%": "elemall", "Healing%": "heal", "Received Healing%": "rheal",
    "Royal Might Damage+%": "royal", "Royal Might Damage Reduction+%": "royalres",
    "ATK%": "atkp", "M.ATK%": "matkp", "M.DEF%": "mdefp", "Elemental DMG Reduction%": "eresall",
    "Melee PDMG Reduction%": "mpred", "Ranged MDMG Reduction%": "rmred",
    "Aggressive": "season_off", "Defensive": "season_def",
    "DMG vs Human%": "race:Demi-Human", "DMG vs Brute%": "race:Brute", "DMG vs Demon%": "race:Demon",
    "DMG vs Plant%": "race:Plant", "DMG vs Undead%": "race:Undead", "DMG vs Formless%": "race:Formless",
    "DMG vs Fish%": "race:Fish", "DMG vs Insect%": "race:Insect", "DMG vs Angel%": "race:Angel",
    "DMG vs Dragon%": "race:Dragon",
}
ELEMENTS = ("Neutral", "Water", "Earth", "Fire", "Wind", "Poison", "Holy", "Shadow", "Ghost", "Undead")
RACES = ("Human", "Brute", "Demon", "Plant", "Undead", "Formless", "Fish", "Insect", "Angel", "Dragon", "Mech")
SIZES = ("Small", "Medium", "Large")


def card_key(name):
    if name in CARD_KEY:
        return CARD_KEY[name]
    m = re.fullmatch(r"(\w+) DMG%", name)
    if m and m.group(1) in ELEMENTS:
        return f"elem:{m.group(1)}"           # your skill's element
    m = re.fullmatch(r"(\w+) DMG Reduction%", name)
    if m and m.group(1) in ELEMENTS:
        return f"eres:{m.group(1)}"
    m = re.fullmatch(r"DMG vs ([\w-]+)%", name)
    if m and m.group(1) in SIZES:
        return f"size:{m.group(1)}"
    if m and m.group(1) in ELEMENTS:
        return f"vselem:{m.group(1)}"         # target's element
    if m and m.group(1) in RACES:
        return "race:" + ("Demi-Human" if m.group(1) == "Human" else m.group(1))
    m = re.fullmatch(r"DMG Reduction vs ([\w-]+)%", name)
    if m and m.group(1) in SIZES:
        return f"sres:{m.group(1)}"
    if m:
        return f"rres:{m.group(1)}"
    m = re.fullmatch(r"(\w+) RES", name)
    if m:
        return f"res:{m.group(1)}"
    return None


CARD_LINE = re.compile(r"^(.+?) ([+-])\s?(\d+(?:\.\d+)?)(%?)(?:~(\d+(?:\.\d+)?)%?)?$")


def gear_fx(pairs):
    out = []
    for a, v in pairs:
        key = ATTR_KEY.get(a)
        if not key:
            continue
        attr = idx_attrs.get(str(a), {})
        ps = attr.get("percentage_show")
        out.append([key, v / 10000 if ps == 1 else v / 100 if ps == 2 else v])
    return out


def card_fx(lines):
    fx, other = [], []
    for line in lines:
        m = CARD_LINE.match(line.strip())
        key = m and card_key(m.group(1))
        if not key:
            other.append(line)
            continue
        sign = -1 if m.group(2) == "-" else 1
        lo = float(m.group(3))
        hi = float(m.group(5) or lo)
        pct = m.group(1).endswith("%") or m.group(4) == "%"
        k = 0.01 if pct else 1
        fx.append([key, sign * lo * k, sign * hi * k])
    return fx, other


# ---- refine ---------------------------------------------------------------
r = load("refine.json")
assert sorted(l["level"] for l in r["levels"]) == list(range(r["maxLevel"])), "refine levels missing or doubled"
levels = []
for l in sorted(r["levels"], key=lambda l: l["level"]):
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
idx_attrs = load("equipment_index.json")["attributes"]
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
        **dict(zip(("fx", "other"), card_fx([x for x in c["effect_lines"] if not x.startswith("Includes up to")]))),
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
        "at": it["assemblyType"],
        "kind": type_names.get(it["itemType"], ""),
        "q": it["quality"],
        "lv": it["openLevel"],
        "jobs": None if it["jobAll"] else it["jobLimits"],
        "st": d.get("stats", []),
        "rf": d.get("refinePerLevel", []),
        "fx": gear_fx(d.get("stats", [])),
        "rfx": gear_fx(d.get("refinePerLevel", [])),
        "suit": [suit_names[s] for s in it.get("suits", []) if s in suit_names],
        "sets": [s for s in it.get("suits", []) if s in suit_names],
        "img": img(it.get("icon")),
    })
slot_icons = {}
for k, v in idx["assemblyTypes"].items():
    path = img(v.get("icon"))
    if not path and v.get("icon"):
        path = f"equipslot/{v['icon']}.webp"   # same fallback rtnw.online uses
        wanted.add(path)
    slot_icons[k] = path
# set bonuses: an effect needs `num` pieces of the set; shadow sets also have a
# quality tier per effect (q 3-6), other sets use q 0 (any quality)
gear_sets = {}
for st in idx["suits"]:
    gear_sets[st["id"]] = {
        "name": st["name"].strip(),
        "pieces": len(st.get("components") or []),
        "effects": [{"num": x["num"], "q": x["quality"], "desc": x["desc"],
                     "fx": gear_fx([(a["attrId"], a["value"]) for a in x.get("attrs", [])])} for x in st["effects"]],
    }
save("equipment.json", {
    "slotIcons": slot_icons,
    "sets": gear_sets,
    "attrs": {k: {"n": v["name"], "ps": v["percentage_show"], "rn": v["reserve_number"]}
              for k, v in idx["attributes"].items()},
    "jobs": {k: v["name"] for k, v in idx["jobs"].items()},
    "items": items,
})

# ---- apocalypse traits ---------------------------------------------------
PART_SLOTS = {"weapon": "Weapon", "offhand": "Off-Hand", "armor": "Armor", "cloak": "Cape", "shoes": "Shoes", "accessory": "Accessory"}
apoc = []
for i, e in enumerate(load("apocalypse.json")["entries"]):
    text = re.sub(r"</?color[^>]*>", "", e["detail_text"]).strip()
    fx, other = card_fx([text])
    apoc.append({
        "id": i, "q": e["quality"], "cat": e["category"]["name"] or "Stat", "title": e["title"], "text": text,
        "parts": [PART_SLOTS.get(p, p) for p in e["part_keys"]],
        "jobs": [j["id"] for j in e["job_labels"]] or None,
        "fx": fx, "other": other,
    })
save("apocalypse.json", apoc)

# ---- equipment affixes ("stunts") ----------------------------------------
# Packages are listed per weapon type / armor slot and level band; each holds
# the affixes that gear can roll. We keep one row per distinct affix text and
# remember which gear parts can have it.
ELEMS = "Neutral|Water|Earth|Fire|Wind|Poison|Holy|Shadow|Ghost|Undead"


def affix_fx(text):
    t = text.strip().rstrip(".")
    m = re.fullmatch(rf"({ELEMS}) DMG(?: dealt)? \+(\d+(?:\.\d+)?)%", t)
    if m:
        v = float(m.group(2)) / 100
        return [[f"elem:{m.group(1)}", v, v]], []
    m = re.fullmatch(rf"({ELEMS}) DMG taken -(\d+(?:\.\d+)?)%", t)
    if m:
        v = float(m.group(2)) / 100
        return [[f"eres:{m.group(1)}", v, v]], []
    m = re.fullmatch(r"DMG taken from (small|medium|large) units -(\d+(?:\.\d+)?)%", t)
    if m:
        v = float(m.group(2)) / 100
        return [[f"sres:{m.group(1).title()}", v, v]], []
    return [], [text]


affix_dir = os.path.join(RAW, "affix")
aff_index = load("affix/index.json")
pkg_parts = {}
for wtype, bands in aff_index["weapon_packages_by_type_and_level"].items():
    for pkgs in bands.values():
        for pk in pkgs:
            pkg_parts.setdefault(str(pk), set()).add("Weapon")
for at, bands in aff_index["armor_packages_by_type_and_level"].items():
    part = aff_index["assembly_types"].get(str(at), {}).get("name") or slot_names.get(int(at), "?")
    if int(at) >= 21:
        part = "Shadow " + part
    for pkgs in bands.values():
        for pk in pkgs:
            pkg_parts.setdefault(str(pk), set()).add(part)
all_jobs = None
affixes = {}
for fn in sorted(os.listdir(affix_dir)):
    if not fn.startswith("shard-"):
        continue
    with open(os.path.join(affix_dir, fn), encoding="utf-8") as f:
        packages = json.load(f)["packages"]
    for pk, v in packages.items():
        for e in v["entries"]:
            st = e["stunt"]
            text = re.sub(r"</?color[^>]*>", "", st["desc"]).strip()
            jobs = tuple(sorted(st.get("job_ids") or []))
            key = (st["name"], st["level"], st["color"], text, jobs)
            a = affixes.get(key)
            if not a:
                fx, other = affix_fx(text)
                a = affixes[key] = {"name": st["name"], "lv": st["level"], "q": st["color"], "text": text, "img": img(st.get("icon")),
                                    "jobs": list(jobs), "parts": set(), "fx": fx, "other": other}
            a["parts"] |= pkg_parts.get(pk, set())
every_job = set().union(*(set(a["jobs"]) for a in affixes.values())) if affixes else set()
aff_out = []
for i, a in enumerate(sorted(affixes.values(), key=lambda a: (a["name"], a["q"], a["lv"]))):
    aff_out.append({**a, "id": i, "parts": sorted(a["parts"]),
                    "jobs": None if set(a["jobs"]) >= every_job else a["jobs"]})
save("affixes.json", aff_out)

# ---- card fusion ----------------------------------------------------------
# Follows rtnw.online's own model of fusion (the game's real weights are not
# public): each affix position comes from the main or the material card, with
# chance w_main / (w_main + w_material) for random effects and 50% otherwise.
fz = load("card_fusion.json")
card_img = {c["id"]: c.get("img") for c in cards}
fz_fixed = {}
for o in fz["fixed_options"]:
    fx, other = card_fx(o["line_variants"]["1"])
    fz_fixed[o["key"]] = {"lines": o["line_variants"], "decay": o["decay_group"], "fx": fx, "other": other}
fz_random = {}
for o in fz["random_options"]:
    fx, other = card_fx(o["lines"])
    w = o["weights"].get("0") or 0
    fz_random[o["key"]] = {"text": o["display"], "w": w, "lib": o["library_id"], "attr": o["attr_id"],
                           "tier": {40000: 2, 20000: 3, 10000: 4}.get(w, 0), "fx": fx, "other": other}
save("fusion.json", {
    "cards": [{
        "id": c["id"], "name": c["name"], "q": c["quality"], "slot": c["card_type_name"],
        "mvp": bool(c["quality_type"] == 1 or c["has_mvp_source"]), "affixes": c["words_count"],
        "fixed": c["native_fixed_key"], "lib": c["native_random_library_id"],
        "immune": bool(c.get("fixed_effect_immune_to_decay")), "img": card_img.get(c["id"]),
    } for c in fz["cards"]],
    "fixed": fz_fixed,
    "random": fz_random,
    "libs": fz["pools"]["library_random_keys"],
    "slotFixed": {next(c["card_type_name"] for c in fz["cards"] if str(c["card_type_id"]) == t): keys
                  for t, keys in fz["pools"]["card_type_fixed_keys"].items()},
    "slotRandom": {next(c["card_type_name"] for c in fz["cards"] if str(c["card_type_id"]) == t): keys
                   for t, keys in fz["pools"]["card_type_random_keys"].items()},
})

# ---- runes (elemental crystals) --------------------------------------------
# 5 slots; each rune: element, level 1-4 (+1 with Celestial), one main effect
# (unique across slots), 2 extra colours, up to 3 random stats. Resonance
# counts colours per element across all runes; the highest tier reached applies.
rn = load("runes.json")
EL_NAMES = {"1": "Gale", "2": "Geo", "3": "Aqua", "4": "Pyro", "5": "Lumina"}
# main effects that change damage dealt, and whether they apply by default
DMG_GROUPS = {10001: False, 10002: False, 10004: False, 10005: True, 10006: True, 10007: True, 10008: True,
              10011: True, 10014: True, 10015: False, 10016: False, 10026: False}
first_num = lambda text: float(re.search(r"(\d+(?:\.\d+)?)", text).group(1))


def effect_pct(desc):
    """First N% in the text that is not a condition ("HP above 50%")."""
    for m in re.finditer(r"(above|below|under|over)?\s*(\d+(?:\.\d+)?)%", desc):
        if not m.group(1):
            return float(m.group(2)) / 100
    raise ValueError(f"no effect % in: {desc}")
groups = []
for gid, g in sorted(rn["effectGroups"].items(), key=lambda kv: int(kv[0])):
    descs = [g["levels"][str(l)]["desc"] for l in range(1, 6)]
    gi = int(gid)
    groups.append({
        "id": gi, "name": g["name"], "el": EL_NAMES.get(str(g.get("elementId")), ""),
        "levels": descs,
        "mult": [effect_pct(d) for d in descs] if gi in DMG_GROUPS else None,
        # icon per rune element (1 Gale … 5 Lumina), as the rune planner draws it
        "icons": {name: img(f"{g['icon']}_{eid}") for eid, name in EL_NAMES.items()},
        "countDefault": DMG_GROUPS.get(gi, False),
    })
RES_KEYS = {"Gale": ["str", "agi", "vit", "int", "dex", "luk"], "Aqua": ["pdmg", "mdmg"], "Pyro": ["mult"],
            "Geo": ["dmgres"], "Lumina": ["heal", "rheal"]}
elements = {}
for eid, e in rn["elements"].items():
    name = EL_NAMES[eid]
    tiers = {}
    for tier, lines in e["resonance"].items():
        v = first_num(lines[0])
        fx = [[k, v if name == "Gale" else v / 100] for k in RES_KEYS[name]]
        if name == "Gale" and len(lines) > 1:
            fx.append(["aspd", first_num(lines[1]) / 100])
        tiers[tier] = {"lines": lines, "fx": fx}
    elements[name] = tiers
rune_stats = []
for attr, libs in rn["affixRanges"].items():
    a = rn["attributes"].get(attr, {})
    pct = a.get("percentageShow") == 1
    key = ATTR_KEY.get(int(attr)) or {88: "race:Angel", 90: "race:Dragon", 105: "rres:Undead", 106: "rres:Formless",
                                       107: "rres:Fish", 108: "rres:Angel", 110: "rres:Dragon"}.get(int(attr))
    rune_stats.append({"attr": int(attr), "key": key, "name": a.get("showName", attr), "pct": pct,
                       "ranges": {lib: [r["min"] / (10000 if pct else 1), r["max"] / (10000 if pct else 1)] for lib, r in libs.items()}})
save("runes.json", {"elements": elements, "groups": groups, "stats": sorted(rune_stats, key=lambda x: x["attr"]),
                    "levelLib": {"1": "33", "2": "43", "3": "53", "4": "53"}})

# ---- skill buffs ----------------------------------------------------------
# Skills tagged "Buff" in each job's skill file, with the stats their text
# names at every level. Texts are free-form, so only clear phrases are read;
# anything else is shown as text and not counted.
NUM = r"(\d+(?:\.\d+)?)"
STATWORD = {"STR": "str", "AGI": "agi", "VIT": "vit", "INT": "int", "DEX": "dex", "LUK": "luk"}
RACE_WORDS = {"Demi-Human": "Demi-Human", "Human": "Demi-Human", "Brute": "Brute", "Demon": "Demon", "Plant": "Plant",
              "Undead": "Undead", "Formless": "Formless", "Fish": "Fish", "Insect": "Insect", "Angel": "Angel", "Dragon": "Dragon"}


def skill_fx(text):
    t = re.sub(r"\s+", " ", text)
    out = []
    used = []
    SEP = r"\s*(?:\+|by)\s*"            # "ATK +20", "ATK by 20", "MATK+70"
    STATS = r"(?:STR|AGI|VIT|INT|DEX|LUK)"

    def take(pattern, fn):
        for m in re.finditer(pattern, t, flags=re.I):
            if any(a < m.end() and m.start() < b for a, b in used):
                continue
            res = fn(m)
            if res:
                used.append((m.start(), m.end()))
                out.extend(res)

    pct = lambda m, i=1: float(m.group(i)) / 100
    flat = lambda m, i=1: float(m.group(i))
    # P.ATK and M.ATK together, % or flat ("... for you and teammates within 20 m by 60")
    take(rf"P\.ATK and M\.ATK[^.%]*?(?:by|\+)\s*{NUM}%", lambda m: [["atkall", pct(m)], ["matkall", pct(m)]])
    take(rf"(?:P\.ATK and M\.ATK|ATK and MATK)[^.%]*?(?:by|\+)\s*{NUM}(?!%|\.?\d)", lambda m: [["atk", flat(m)], ["matk", flat(m)]])
    take(rf"P\.ATK{SEP}{NUM}%", lambda m: [["atkall", pct(m)]])
    take(rf"M\.?ATK{SEP}{NUM}%", lambda m: [["matkall", pct(m)]])
    take(rf"P\.ATK{SEP}{NUM}(?!%|\.?\d)", lambda m: [["atk", flat(m)]])
    take(rf"\bM\.?ATK{SEP}{NUM}(?!%|\.?\d)", lambda m: [["matk", flat(m)]])
    take(rf"\bATK{SEP}{NUM}(?!%|\.?\d)", lambda m: [["atk", flat(m)]])
    take(rf"\b{NUM} ATK\b", lambda m: [["atk", flat(m)]])                       # "gain 100 ATK"
    take(rf"additional {NUM} (?:[A-Za-z]+ )*P\.DMG", lambda m: [["fixp", flat(m)]])  # "deal an additional 180 Neutral Melee P.DMG"
    # damage bonuses
    take(rf"Magic(?:al)? Skill DMG{SEP}{NUM}%", lambda m: [["mdmg", pct(m)]])
    take(rf"physical Skill DMG{SEP}{NUM}%", lambda m: [["pdmg", pct(m)]])
    take(rf"Ranged P\.?DMG{SEP}{NUM}%|{NUM}% ranged PDMG", lambda m: [["ranged", pct(m, 1 if m.group(1) else 2)]])
    take(rf"Melee P\.?DMG{SEP}{NUM}%", lambda m: [["melee", pct(m)]])
    take(rf"P\.DMG{SEP}{NUM}%", lambda m: [["pdmg", pct(m)]])
    take(rf"M\.DMG{SEP}{NUM}%", lambda m: [["mdmg", pct(m)]])
    take(rf"CRIT DMG[^.%]*?(?:\+|by )\s*{NUM}%", lambda m: [["critdmg", pct(m)]])
    take(rf"\bCRIT{SEP}{NUM}(?!%|\.?\d)", lambda m: [["crit", flat(m)]])
    take(rf"\b{NUM} Crit\b", lambda m: [["crit", flat(m)]])
    take(rf"ASPD{SEP}{NUM}%", lambda m: [["aspd", pct(m)]])
    take(rf"DMG vs all sizes by {NUM}%", lambda m: [["sizeall", pct(m)]])
    take(rf"(?:Race DMG Bonus vs|DMG vs) ([A-Za-z\- ]+?){SEP}{NUM}%",
         lambda m: [[f"race:{RACE_WORDS[w]}", pct(m, 2)] for w in re.split(r" and |, ", m.group(1)) if w in RACE_WORDS] or None)
    take(rf"\b({ELEMS}) DMG{SEP}{NUM}%", lambda m: [[f"elem:{m.group(1).title()}", pct(m, 2)]])
    # base stats: "STR +4", "LUK ... by 10", "AGI and DEX +1", "STR, INT, and DEX ... by 15"
    take(rf"\b({STATS}(?:(?:,\s*(?:and\s+)?|\s+and\s+){STATS})*)[^.%]*?(?:\+|by )\s*{NUM}(?!%|\.?\d)",
         lambda m: [[STATWORD[w.upper()], flat(m, 2)] for w in re.split(r",\s*(?:and\s+)?|\s+and\s+", m.group(1))])
    # a stat named twice is usually a second, conditional clause ("Ensemble Aura: ..."): keep the first
    seen, result = set(), []
    for k, v in out:
        if k not in seen:
            seen.add(k)
            result.append([k, v])
    return result


sk_index = load("skills/index.json")["jobs"]
# Jobs rtnw has no skills for, taken from roworlddb.com when its file was
# fetched: merged into rtnw's entry (children from both), then each one is
# added to its parent's children, so the order of the index does not matter.
if os.path.exists(os.path.join(RAW, "skills", "index_rdb.json")):
    rdb_jobs = (load("skills/index_rdb.json").get("jobs") or {})
    added = [k for k, v in rdb_jobs.items()
             if v.get("has_skills") and not sk_index.get(k, {}).get("has_skills") and os.path.exists(os.path.join(RAW, "skills", f"{k}.json"))]
    for k in added:
        old = sk_index.get(k, {})
        kids = [*(old.get("children") or []), *(rdb_jobs[k].get("children") or [])]
        sk_index[k] = {**old, **rdb_jobs[k], "children": list(dict.fromkeys(int(c) for c in kids))}
    for k in added:
        par = str(sk_index[k].get("parent") or "")
        if par in sk_index and int(k) not in (sk_index[par].get("children") or []):
            sk_index[par] = {**sk_index[par], "children": [*(sk_index[par].get("children") or []), int(k)]}
skill_jobs = {k: {"name": v["job_name"], "parent": v.get("parent"), "children": v.get("children") or [],
                  "img": img(v.get("job_icon_big")) or img(v.get("job_icon")), "hasSkills": bool(v.get("has_skills"))}
              for k, v in sk_index.items()}
buff_skills = []
for fn in sorted(os.listdir(os.path.join(RAW, "skills"))):
    if not re.fullmatch(r"\d+\.json", fn):
        continue
    j = load(f"skills/{fn}")
    for group in ("skills", "unique_skills"):
        for sid, sk in (j.get(group) or {}).items():
            lvls = sk.get("levels") or {}
            if not lvls:
                continue
            first = lvls.get("1") or next(iter(lvls.values()))
            if "Buff" not in [x["name"] for x in first.get("skill_tags", [])]:
                continue
            levels = []
            for lv in sorted(lvls, key=int):
                desc = re.sub(r"</?color[^>]*>", "", lvls[lv]["des"]).strip()
                levels.append({"desc": desc, "fx": skill_fx(desc)})
            party = bool(re.search(r"teammates|party members|allies", levels[0]["desc"], re.I))
            buff_skills.append({"id": int(sid), "job": str(j["job_id"]), "name": sk["name"], "img": img(sk.get("icon")),
                                "party": party, "natural": sk.get("natural_max_level"), "levels": levels})
save("buffs.json", {"jobs": skill_jobs, "skills": buff_skills})

# ---- support: heals, protection and party buffs ----------------------------
# For the Support tab. Heals are read from the skill text ("450%*M.ATK + 235
# HP", "100%*P.ATK HP", "59.7% Max HP per second"), since the numbers there
# match the level data. Texts repeat across levels with only the numbers
# changing, so each skill keeps one template and a list of numbers per level.
HEAL_PART = re.compile(r"(\d+(?:\.\d+)?)%\s*\*\s*(M\.ATK|MATK|P\.ATK|ATK)(?:\s*\+\s*(\d[\d,]*))?\s*HP", re.I)
HEAL_MAXHP = re.compile(r"(?:restor|heal)\w*[^.]*?(\d+(?:\.\d+)?)% Max HP (?:per second|every sec)", re.I)
PARTY = re.compile(r"\b(?:teammates?|party members?|allies|ally|allied)\b", re.I)  # \b: not "additionally"
PROTECT_TAGS = {"Shield", "DR", "Revive", "Immune", "Protection", "Clear"}
NOT_SUPPORT = {"DMG", "Control", "Debuff"}
GUARD = re.compile(r"damage taken|DMG taken|invincible|shield|revive", re.I)


def sentence_at(text, pos):
    a = max(text.rfind(". ", 0, pos), text.rfind("\n", 0, pos))
    b = min([x for x in (text.find(". ", pos), text.find("\n", pos)) if x >= 0] or [len(text)])
    return a + 1, b


def heal_parts(text):
    parts = []
    for m in HEAL_PART.finditer(text):
        a, b = sentence_at(text, m.start())
        sent = text[a:b]
        stat = "matk" if m.group(2).upper().startswith("M") else "atk"
        parts.append(_tick(text, a, m.end(), sent, {"pct": float(m.group(1)), "flat": float((m.group(3) or "0").replace(",", "")), "stat": stat}))
    for m in HEAL_MAXHP.finditer(text):
        a, b = sentence_at(text, m.start())
        parts.append(_tick(text, a, m.end(), text[a:b], {"pct": float(m.group(1)), "flat": 0.0, "stat": "maxhp"}))
    return parts


def _tick(text, sent_start, end, sent, part):
    ev = re.search(r"every (\d+(?:\.\d+)?) sec|every sec|each sec|per second", sent, re.I)
    if ev:
        part["every"] = float(ev.group(1)) if ev.group(1) else 1.0
        _, sent_end = sentence_at(text, end - 1)
        dur = re.search(r"for (?:up to )?(\d+(?:\.\d+)?) ?s(?:ec)?\b", text[end:sent_end])
        if not dur:  # "Creates a Sanctuary ... for 8 sec. Each sec, ..."
            before = re.findall(r"for (\d+(?:\.\d+)?) sec", text[:sent_start])
            dur = before[-1] if before else None
        else:
            dur = dur.group(1)
        if dur:
            part["dur"] = float(dur)
    if re.search(r"\bAura\b", sent):
        part["aura"] = True
    return part


def heal_mod(text):
    """A passive that changes heals: +x% to all, +x% to one skill, or a cut to some."""
    t = re.sub(r"\s+", " ", text)
    m = re.search(r"^(.+?) effectiveness reduced by (\d+(?:\.\d+)?)%", t)
    if m:
        names = [x.strip() for x in re.split(r",\s*(?:and\s+)?|\s+and\s+", m.group(1)) if x.strip()]
        return {"skills": names, "mult": 1 - float(m.group(2)) / 100, "choice": True}
    m = re.search(r"([A-Z][\w' ]+?)'s Healing \+\s*(\d+(?:\.\d+)?)%", t)
    if m:
        return {"skills": [m.group(1).strip()], "add": float(m.group(2)) / 100}
    m = re.search(r"\bHealing (?:by|\+)\s*(\d+(?:\.\d+)?)%", t)
    if m and not re.search(r"Received Healing|healing received", t, re.I):
        return {"skills": None, "add": float(m.group(1)) / 100}
    return None


def compact_levels(descs):
    tpls, nums = [], []
    for d in descs:
        ns = []
        tpls.append(re.sub(r"\d+(?:\.\d+)?", lambda m: (ns.append(m.group(0)), "{%d}" % (len(ns) - 1))[1], d))
        nums.append(ns)
    if len(set(tpls)) == 1:
        return tpls[0], nums
    return None, None


sup_skills = []
for fn in sorted(os.listdir(os.path.join(RAW, "skills"))):
    if not re.fullmatch(r"\d+\.json", fn):
        continue
    j = load(f"skills/{fn}")
    jid = str(j["job_id"])
    entries = [(sid, sk, False) for sid, sk in (j.get("skills") or {}).items()]
    ult = (j.get("unique_skills") or {}).get(jid)  # the file also repeats the parents' ultimates
    if isinstance(ult, dict) and ult.get("levels"):
        entries.append((f"u{jid}", ult, True))
    for sid, sk in (j.get("traits") or {}).items():
        entries.append((sid, sk, False))
    for sid, sk, is_ult in entries:
        lvls = sk.get("levels") or {}
        if not lvls:
            continue
        keys = sorted(lvls, key=int)
        descs = [re.sub(r"</?color[^>]*>", "", lvls[k].get("des") or "").strip() for k in keys]
        if not descs[0]:
            continue
        tags = {x["name"] for x in (lvls[keys[0]].get("skill_tags") or [])}
        heals = [heal_parts(d) for d in descs]
        mods = [heal_mod(d) for d in descs]
        party = bool(PARTY.search(descs[0]))
        if any(heals):
            kind = "heal"
        elif any(mods) and ("Passive" in tags or not tags):
            kind = "mod"
        elif not party or tags & NOT_SUPPORT:
            continue
        elif is_ult:
            kind = "protect" if GUARD.search(descs[0]) else "buff"
        elif tags & PROTECT_TAGS or ("Support" in tags and not tags & {"Buff", "Blessing"}):
            kind = "protect"
        elif tags & {"Buff", "Blessing", "Support", "Passive"}:
            kind = "buff"
        else:
            continue
        levels = []
        for k, d, h, md in zip(keys, descs, heals, mods):
            lv = {"cd": round((lvls[k].get("cooldown") or 0) / 1000, 2)}
            if h:
                lv["heal"] = h
            if md:
                lv["mod"] = md
            if kind == "buff":
                fx = skill_fx(d)
                if fx:
                    lv["fx"] = fx
            sh = re.search(r"block damage equal to (\d+(?:\.\d+)?)% Max HP", d)
            if sh:
                lv["shield"] = float(sh.group(1))
            levels.append(lv)
        tpl, nums = compact_levels(descs)
        if tpl is not None:
            for lv, ns in zip(levels, nums):
                lv["n"] = ns
        else:
            for lv, d in zip(levels, descs):
                lv["desc"] = d
        sup_skills.append({"id": sid if is_ult else int(sid), "job": jid, "name": sk["name"], "img": img(sk.get("icon")),
                           "kind": kind, "ult": is_ult, "party": party, "natural": sk.get("natural_max_level"),
                           "tags": sorted(tags), "t": tpl, "levels": levels})
# traits repeat in every job file of a line (same id): keep the first
seen_sup, sup_out = set(), []
for s in sup_skills:
    if s["id"] in seen_sup:
        continue
    seen_sup.add(s["id"])
    sup_out.append(s)
save("support.json", {"skills": sup_out})

# ---- monsters: pick a target instead of typing its race / size / element ----
MON_TYPES = {"Normal", "Elite", "Mini", "Boss", "MVP"}
mon_raw = load("monsters/index.json")["monsters"]
mon_out, mon_seen = [], set()
for m in sorted(mon_raw, key=lambda x: (x.get("level") or 0)):
    name = (m.get("name") or "").strip()
    typ = (m.get("type") or {}).get("name")
    race, el, size = ((m.get(k) or {}).get("name") for k in ("race", "element", "body"))
    if not name or typ not in MON_TYPES or race not in RACES + ("Demi-Human",) or el not in ELEMENTS or size not in SIZES:
        continue
    key = (name, typ, race, el, size)
    if key in mon_seen:  # the same monster at several levels: keep the lowest
        continue
    mon_seen.add(key)
    mon_out.append({"n": name, "lv": m.get("level"), "t": typ, "r": race, "e": el, "s": size, "img": img(m.get("image"))})
save("monsters.json", mon_out)

# ---- attack skills: Skill %, flat damage, element and kind per level ----------
# "400% + 400 Holy Melee P.DMG", "2x70% PDMG", "120%+120 Neutral ranged physical damage", "600% Water MDMG".
# Formulas that need weapon weight, cart weight or two stats ("250%*(ATK + Weapon Weight*0.7)") do not match on purpose.
# A stat-scaling part ("378%+Agi*1.13%+540") is skipped: the % before it is the skill %, and the
# skill keeps a note (stat) so the page can say it is not counted.
ATK_LINE = re.compile(r"(?:(\d+)\s*x\s*)?(?<![*\d.])(\d+(?:\.\d+)?)%\s*(?:\+\s*(STR|AGI|VIT|INT|DEX|LUK)\s*\*\s*[\d.]+%\s*)?"
                      r"(?:\+\s*(\d[\d,]*)\s*)?(?:AoE\s+)?(?:(" + ELEMS + r")\s+)?(?:(Melee|Ranged)\s+)?"
                      r"(?:(P|M)\.?\s?DMG|(physical|magic(?:al)?)\s+(?:damage|DMG))", re.I)
WORD_HITS = {"twice": 2, "thrice": 3}


def _count(h):
    n = next((int(g) for g in h.groups() if g and g.isdigit()), None)
    if n is None:
        n = next((WORD_HITS[g.lower()] for g in h.groups() if g and g.lower() in WORD_HITS), 1)
    return max(1, n)


def attack_hits(part, m):
    """How many times the skill % lands. Only counts tied to the damage phrase:
    right before it ("2 hits of 400%", "dealing 2 times 280%", "2x70%"), a count
    followed by "each" ("fires 5x Bolts at the target, each dealing", "striking 2x,
    each hit dealing", "Attacks the target twice, each dealing"), or right after it
    ("... PDMG twice", "... PDMG 3 times")."""
    if m.group(1):
        return max(1, int(m.group(1)))
    a = max(part.rfind(". ", 0, m.start()), part.rfind("\n", 0, m.start())) + 1
    before, after = part[a:m.start()], part[m.end():]
    h = (re.search(r"(?:\b(\d+) (?:hits|rounds|times) of|\b(\d+) times)\s*$", before, re.I)
         or re.search(r"(?:\b(\d+)\s*x\b|\b(twice|thrice)\b)[^.%]*\beach\b[^.%]*$", before, re.I)
         or re.match(r"\s*(?:(twice|thrice)\b|(\d+) times\b)", after, re.I))
    return _count(h) if h else 1
atk_skills = []
for fn in sorted(os.listdir(os.path.join(RAW, "skills"))):
    if not re.fullmatch(r"\d+\.json", fn):
        continue
    j = load(f"skills/{fn}")
    jid = str(j["job_id"])
    entries = [(int(sid), sk, False) for sid, sk in (j.get("skills") or {}).items()]
    ult = (j.get("unique_skills") or {}).get(jid)
    if isinstance(ult, dict) and ult.get("levels"):
        entries.append((f"u{jid}", ult, True))
    for sid, sk, is_ult in entries:
        lvls = sk.get("levels") or {}
        keys = sorted(lvls, key=int)
        if not keys:
            continue
        tags = {x["name"] for x in (lvls[keys[0]].get("skill_tags") or [])}
        if "DMG" not in tags and not is_ult:
            continue
        descs = [re.sub(r"</?color[^>]*>", "", lvls[k].get("des") or "").strip() for k in keys]
        levels = []
        for k, d in zip(keys, descs):
            part = d.split("Active:", 1)[1] if "Active:" in d else d  # skip the passive half
            m = ATK_LINE.search(part)
            if not m:
                levels = None
                break
            magic = (m.group(7) or "").upper() == "M" or (m.group(8) or "").lower().startswith("magic")
            side = (m.group(6) or "").lower()
            kind = ("magic-ranged" if side == "ranged" else "magic") if magic else side or None
            levels.append({"pct": float(m.group(2)), "flat": float((m.group(4) or "0").replace(",", "")),
                           "hits": attack_hits(part, m), **({"stat": m.group(3).upper()} if m.group(3) else {}),
                           "el": (m.group(5) or "").title() or None, "kind": kind,
                           "cd": round((lvls[k].get("cooldown") or 0) / 1000, 2)})
        if not levels:
            continue
        tpl, nums = compact_levels(descs)
        for lv, ns, d in zip(levels, nums or [None] * len(levels), descs):
            if tpl is not None:
                lv["n"] = ns
            else:
                lv["desc"] = d
        atk_skills.append({"id": sid, "job": jid, "name": sk["name"], "img": img(sk.get("icon")), "ult": is_ult,
                           "natural": sk.get("natural_max_level"), "t": tpl, "levels": levels})
save("attacks.json", atk_skills)

# ---- pets: the stats a pet's bond level gives its owner ----------------------
PET_KEY = {**ATTR_KEY, 52: "mpred", 54: "rpred", 322: "pvp", 323: "pvpres", 373: "rmred"}
pets_out = []
for p in load("pets.json")["pets"]:
    levels = []
    for L in p.get("levels") or []:
        fx = []
        for a in (L.get("skill") or {}).get("attrs") or []:
            k = PET_KEY.get(a.get("id"))
            if a.get("target") != "player" or not k:
                continue
            fx.append([k, a["value"] / 100 if a.get("isPercentage") else a["value"]])
        levels.append({"lv": L.get("level"), "title": L.get("title") or "", "desc": (L.get("skill") or {}).get("description") or "", "fx": fx})
    pets_out.append({"id": p["id"], "n": p["name"], "img": img(p.get("icon")), "q": (p.get("quality") or {}).get("name"), "levels": levels})
save("pets.json", pets_out)

# ---- shop -----------------------------------------------------------------
def shop_img(p):
    if not p or not p.startswith("/media/images/"):
        return None
    path = p[len("/media/images/"):]
    if path.startswith("/") or ".." in path.split("/"):
        return None
    wanted.add(path)
    return path


shop = load("shop.json")
cur = {c["id"]: c["name"] for c in shop["currencies"]}
save("shop.json", [
    {
        "n": i["name"], "store": i["storeName"], "tab": i["tabName"], "num": i["itemNum"], "q": i.get("quality"),
        "cur": cur.get(i["price"]["currencyId"], str(i["price"]["currencyId"])),
        "curId": i["price"]["currencyId"], "price": i["price"]["amount"],
        "limit": i.get("limitNum") or 0, "refresh": i.get("timeRefresh") or 0,
        "img": shop_img(i.get("iconPath")),
    }
    for i in shop["items"] if (i.get("price") or {}).get("amount")
])

with open(os.path.join(RAW, "images_rdb.txt"), "w", encoding="utf-8") as f:
    f.write("".join(p + "\n" for p in sorted(wanted_rdb - wanted)))
with open(os.path.join(RAW, "images.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(sorted(wanted)) + "\n")
print(f"  {len(wanted)} images listed in {RAW}/images.txt")
