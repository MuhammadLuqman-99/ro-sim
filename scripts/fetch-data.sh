#!/usr/bin/env bash
# Pull the SEA game data that rtnw.online extracted from the client, then
# build the compact files the web page reads (web/data/*.json).
# Raw files land in data/raw/ and both folders stay out of git.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="https://rtnw.online"
LOC="en-US"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
RAW="data/raw"
mkdir -p "$RAW/equipment"

get() { # url-path out-file
  curl -fsSL --retry 2 -A "$UA" -o "$2" "$BASE$1"
  printf '  %-60s %8s bytes\n' "$1" "$(wc -c <"$2" | tr -d ' ')"
}

echo "Fetching from $BASE"
get "/sea/refine/refine_$LOC.json"                               "$RAW/refine.json"
get "/sea/card-simulator/data/handbook_cards_$LOC.json"          "$RAW/cards.json"
get "/sea/card-simulator/data/card_monster_sources_$LOC.json"    "$RAW/card_sources.json"
get "/sea/card-simulator/data/card_fusion_simulator_$LOC.json"   "$RAW/card_fusion.json"
get "/sea/shop/data/shop_index_$LOC.json"                        "$RAW/shop.json"
get "/sea/equipment/data/equipment_index_$LOC.json"              "$RAW/equipment_index.json"

# Equipment stats live in chunk files named by the index. Start clean so a
# chunk rtnw dropped or renamed can't leave old stats behind.
rm -f "$RAW"/equipment/*.json
chunks=$(python3 -I -c 'import json,sys; print("\n".join(sorted({i["_detailChunk"] for i in json.load(open(sys.argv[1]))["items"]})))' "$RAW/equipment_index.json")
for c in $chunks; do
  get "/sea/equipment/data/optimized/$LOC/$c" "$RAW/equipment/$c"
done

get "/sea/skill-simulator/data/icon_paths.json"                 "$RAW/icon_paths.json"
get "/sea/apocalypse-simulator/data/apocalypse_planner_$LOC.json" "$RAW/apocalypse.json"
get "/sea/skill-simulator/data/engine_runes_$LOC.json"          "$RAW/runes.json"

# Monsters (to pick a target's race, size and element) and pets (bond stats).
mkdir -p "$RAW/monsters"
get "/sea/monster-album/data/monster_index_$LOC.json"           "$RAW/monsters/index.json"
get "/sea/pet/data/pet_library_$LOC.json"                       "$RAW/pets.json"

# Skills per job (buffs for the Damage tab, heals and party skills for the
# Support tab): an index, then one file per job that has skills in SEA.
mkdir -p "$RAW/skills"
rm -f "$RAW"/skills/*.json
get "/sea/skill-simulator/data/skills_index_$LOC.json"          "$RAW/skills/index.json"
jobs=$(python3 -I -c 'import json,sys; print("\n".join(k for k, v in json.load(open(sys.argv[1]))["jobs"].items() if v.get("has_skills")))' "$RAW/skills/index.json")
for id in $jobs; do
  case "$id" in *[!0-9]*|"") echo "  skipped odd job id: $id" ;; *) get "/sea/skill-simulator/data/jobs_$LOC/$id.json" "$RAW/skills/$id.json" ;; esac
done

# Equipment affixes: an index, a manifest and ~20 shard files.
mkdir -p "$RAW/affix"
rm -f "$RAW"/affix/shard-*.json
get "/sea/affix-simulator/data/stunt_package_index_$LOC.json"   "$RAW/affix/index.json"
get "/sea/affix-simulator/data/stunt_shard_manifest_$LOC.json"  "$RAW/affix/manifest.json"
shards=$(python3 -I -c 'import json,sys; print("\n".join(sorted(set(json.load(open(sys.argv[1]))["packageToShard"].values()))))' "$RAW/affix/manifest.json")
for sh in $shards; do
  case "$sh" in shard-[0-9]*.json) get "/sea/affix-simulator/data/optimized/$LOC/$sh" "$RAW/affix/$sh" ;; *) echo "  skipped odd shard name: $sh" ;; esac
done

python3 -I scripts/build-data.py "$RAW" web/data

python3 -I scripts/get-images.py "$RAW/images.txt" web/img
date -u +%Y-%m-%dT%H:%MZ > web/data/fetched_at.txt
echo "Done. Data in web/data/"
