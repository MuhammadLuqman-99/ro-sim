<a href="https://muhammadluqman-99.github.io/ro-sim/"><img src="docs/banner.webp" width="100%" alt="Ragnarok: The New World SEA Spend Simulator, created by IkanAI"></a>

# ro-sim

**Live: https://muhammadluqman-99.github.io/ro-sim/** · created by **IkanAI** (IGN, Ragnarok: The New World SEA)

Luqman's own tool for **Ragnarok: The New World (SEA)**: see what cards and gear
really give, and what a refine goal costs in real money (RM, ฿, S$, Rp, ₱ or US$), before spending money in game.

```sh
./scripts/fetch-data.sh   # pull fresh game data (rtnw.online's SEA client export; roworlddb.com for jobs rtnw has no skills for yet)
./scripts/serve.sh        # http://localhost:8790
npm test                  # refine, damage, fusion, support, money and screenshot-reader checks
```

## Tabs

| Tab | What it answers |
|---|---|
| Refine cost | Real money (your currency) to go from +A to +B: typical (P50), bad luck (P90, P99), chance your budget is enough. Counts materials you already own. Shows which +1 steps eat the money. |
| Damage | Pick your job (icons), your attack skill and level (fills Skill %, flat damage, hits, element and attack type from the game data) and the target monster from the Monster Album (fills race, size and element). Type your character-screen stats or read them from a screenshot (OCR in the browser, nothing uploaded); then change only the slots you care about (Now vs Plan): item (type to search), refine (− / +), card, shadow gear with one-click set fill, gear set bonuses, 5 runes with resonance, Apocalypse traits, card and gear affixes, pets by bond level, skill buffs by job and level, typed buffs. Shows damage per hit and crit, % change, the cost of the Plan's refines and the cost per +1% damage. Saved only in the browser for 60 minutes. Works on phones. |
| Support | For Acolyte, Priest, High Priest, Bard, Dancer, Creator, Kanos and the rest: pick the job (icons), type M.ATK / P.ATK / Healing% from the character screen, set skill levels. Shows every heal per hit, per cast and HP/s (Heal, Sanctuary, Coluseo Heal, Ultimates, songs, Potion Pitcher), heal passives (Meditatio, Purgatorial Angel), how much harder a friend hits with your party buffs, and shields on a friend's Max HP. The gear you plan in the Damage tab shows up as Plan with its cost. |
| Fusion | Main + material card with their affixes, lock, the affix you want: chance per position, every possible result, fusions needed and their cost (Spirit Pieces typed from the game). |
| Cards | All 195 cards: slot, effect, MVP or not, which monster drops it and at what rate. Search by stat ("CRIT", "ATK%"). |
| Gear | 3,261 items: base stats, stat per +1 refine, stats at the refine you pick, sort by any stat, filter by job and level. |
| Shop | Every Starstone price in the shops, turned into your currency. |

## How the numbers are made

- Refine: success +1; drop −1 but never below the last safe level (+6/+9/+12/+15); otherwise stay.
  This matches rtnw.online's own +3→+6 figure exactly. The game also has a pity bonus whose
  rule is not public, so it is left out: above +12 real costs can be up to ~15% lower.
- Legendary Ore (blessing): the data says +1 point per use, which may be wrong. Read the rate
  the game shows with the ore on and type it in.
- Currency: pick where you top up in the header (Malaysia, Thailand, Singapore, Indonesia, Philippines or US$); the first visit guesses from the time zone. Each default price per Starstone is that country's 12,980-Starstone pack from a top-up seller (RM 850, ฿6,831, S$266.29, Rp3,919,894, ₱12,972, US$212; Jul–Nov 2026). Type your own price per Starstone if you top up cheaper.
- `data/raw` is not committed. `web/data` and `web/img` are, so the site deploys as plain files; `fetch-data.sh` rebuilds all three.

## Not built yet

- Card fusion odds (how the 3 affix weights work is unknown even to rtnw.online).
- Exact damage: the game's formula is not public. The Damage tab uses the usual Ragnarok mobile shape (each bonus type multiplies), ignores target DEF and does not turn STR/INT/etc. into ATK. Trust the % change between two builds more than the raw number.
- Heals: the skill numbers come from the game text, but how Healing% stacks is not public; the Support tab adds Healing% bonuses together and multiplies the rest.
- Skills: rtnw.online first. Sage, Scholar, Rogue and Stalker are live in SEA but have no skills on rtnw yet (Nov 2026), so theirs come from roworlddb.com (same file format); `fetch-data.sh` switches each job back to rtnw once rtnw has it. Skills that also scale with a stat ("378% + AGI × 1.13%") count only the fixed % and say so.
- Card Fusion odds follow rtnw.online's model (weights by affix tier); the game's real rule and the Spirit Pieces per fusion are not in the data.
- Rune main effects that only work in some fights start switched off; tick "count" when they apply. Gear affixes that only work under a condition are listed, not counted.
- Kafra box / gacha odds (not in the export).

## Deploy

Live at **https://ro-sim.vercel.app** (Vercel) and https://muhammadluqman-99.github.io/ro-sim/ (GitHub Pages). Both deploy on every push to `main`: Vercel runs the tests as its build step and serves `web/` (`vercel.json`; `.vercelignore` keeps `data/raw` out), and the Pages workflow does the same.
Every push to `main` runs the tests and publishes `web/` (`.github/workflows/pages.yml`).
After a game patch: `./scripts/fetch-data.sh`, check locally, commit `web/data` + `web/img`, push.
