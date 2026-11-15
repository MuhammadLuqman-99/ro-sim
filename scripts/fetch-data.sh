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

RDB="https://roworlddb.com"   # second source, same file format: only for jobs rtnw has no skills for
fetch() { # site url-path out-file: written whole or not at all
  curl -fsSL --retry 2 -A "$UA" -o "$3.part" "$1$2" && mv "$3.part" "$3" || { rm -f "$3.part"; return 1; }
  printf '  %-60s %8s bytes%s\n' "$2" "$(wc -c <"$3" | tr -d ' ')" "$([ "$1" = "$BASE" ] || echo " (${1#https://})")"
}
get() { fetch "$BASE" "$1" "$2"; }

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
# Jobs that are live in SEA but have no skills on rtnw yet (Sage, Scholar,
# Rogue and Stalker in Nov 2026) come from roworlddb.com, with its icon list.
# It is a backup: if it fails, the refresh goes on without those jobs.
extra_jobs() {
  fetch "$RDB" "/sea/skill-simulator/data/skills_index_$LOC.json" "$RAW/skills/index_rdb.json" || return 1
  fetch "$RDB" "/sea/skill-simulator/data/icon_paths.json" "$RAW/icon_paths_rdb.json" || return 1
  local extra id
  extra=$(python3 -I -c 'import json,sys; a=json.load(open(sys.argv[1]))["jobs"]; b=json.load(open(sys.argv[2])).get("jobs") or {}; print("\n".join(k for k, v in b.items() if v.get("has_skills") and not a.get(k, {}).get("has_skills")))' "$RAW/skills/index.json" "$RAW/skills/index_rdb.json") || return 1
  for id in $extra; do
    case "$id" in *[!0-9]*|"") echo "  skipped odd job id: $id" ;; *) fetch "$RDB" "/sea/skill-simulator/data/jobs_$LOC/$id.json" "$RAW/skills/$id.json" || echo "  roworlddb: job $id skipped" ;; esac
  done
}
rm -f "$RAW/icon_paths_rdb.json"
extra_jobs || { echo "  roworlddb.com not reachable or changed: jobs without rtnw skills are skipped this time"; rm -f "$RAW/skills/index_rdb.json" "$RAW/icon_paths_rdb.json"; }

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
[ -s "$RAW/images_rdb.txt" ] && python3 -I scripts/get-images.py "$RAW/images_rdb.txt" web/img https://roworlddb.com/media/images/
date -u +%Y-%m-%dT%H:%MZ > web/data/fetched_at.txt
echo "Done. Data in web/data/"
