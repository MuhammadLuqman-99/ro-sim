<a href="https://muhammadluqman-99.github.io/ro-sim/"><img src="docs/banner.webp" width="100%" alt="Ragnarok: The New World SEA Spend Simulator, created by IkanAI"></a>

# ro-sim

**Live: https://muhammadluqman-99.github.io/ro-sim/** · created by **IkanAI** (IGN, Ragnarok: The New World SEA)

Luqman's own tool for **Ragnarok: The New World (SEA)**: see what cards and gear
really give, and what a refine goal costs in RM, before spending money in game.

```sh
./scripts/fetch-data.sh   # pull fresh game data (rtnw.online's SEA client export)
./scripts/serve.sh        # http://localhost:8790
npm test                  # refine maths checks
```

## Tabs

| Tab | What it answers |
|---|---|
| Refine cost | RM to go from +A to +B: typical (P50), bad luck (P90, P99), chance your budget is enough. Counts materials you already own. Shows which +1 steps eat the money. |
| Cards | All 195 cards: slot, effect, MVP or not, which monster drops it and at what rate. Search by stat ("CRIT", "ATK%"). |
| Gear | 3,261 items: base stats, stat per +1 refine, stats at the refine you pick, sort by any stat, filter by job and level. |
| Shop in RM | Every Starstone price in the shops, turned into ringgit. |

## How the numbers are made

- Refine: success +1; drop −1 but never below the last safe level (+6/+9/+12/+15); otherwise stay.
  This matches rtnw.online's own +3→+6 figure exactly. The game also has a pity bonus whose
  rule is not public, so it is left out: above +12 real costs can be up to ~15% lower.
- Legendary Ore (blessing): the data says +1 point per use, which may be wrong. Read the rate
  the game shows with the ore on and type it in.
- RM per Starstone defaults to 0.0655 (12,980 for RM 850, top-up seller, Jul 2026). Change it in the header.
- `data/raw` is not committed. `web/data` and `web/img` are, so the site deploys as plain files; `fetch-data.sh` rebuilds all three.

## Not built yet

- Card fusion odds (how the 3 affix weights work is unknown even to rtnw.online).
- A full character sheet (stat formulas and damage are not in the export).
- Kafra box / gacha odds (not in the export).

## Deploy

Live at https://muhammadluqman-99.github.io/ro-sim/ (GitHub Pages, free).
Every push to `main` runs the tests and publishes `web/` (`.github/workflows/pages.yml`).
After a game patch: `./scripts/fetch-data.sh`, check locally, commit `web/data` + `web/img`, push.
