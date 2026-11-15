import { expected, simulate, percentile, stepRates } from "./lib/refine.js";
import { SLOTS, RACES, SIZES, ELEMENTS, sumStats, damage, upgradeStarstones, resonance, runeLevel, withPanel, skillBuffStats, setBonuses, gearAtk } from "./lib/build.js";
import { parseStats } from "./lib/statscan.js";
import { chainOf, defaultLevel, descOf, levelOf, healMods, healSkill, withBuffs, buffGain, gainKeys } from "./lib/support.js";
import { slotsOf, outcomes, problems, resultLines, targetChance, hasEffect, mainChance, option as fusionOption } from "./lib/fusion.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n, d = 0) => Number(n).toLocaleString("en-MY", { maximumFractionDigits: d, minimumFractionDigits: d });
const rm = (n) => "RM " + fmt(n, n < 100 ? 2 : 0);
const QUALITY = { 1: "Common", 2: "Uncommon", 3: "Rare", 4: "Epic", 5: "Legend", 6: "Mythic" };
const OBTAIN = {
  MonsterConfig: "Monster drop", MvpConfigTable: "MVP", BossRaidTrophyTable: "Boss raid", TradeCommodityTable: "Exchange",
  TaskConfig: "Quest", ItemConfig: "Item / box", HeimDungeonsConfig: "Dungeon", AuctionItemTableConfig: "Auction",
  InfinityTowerTableConfig: "Endless Tower", DaySignInConfig: "Daily sign-in", ForestGameOverAccountTableConfig: "Event",
};
const DEFAULT_RM_PER_STAR = 0.0655; // 12,980 Starstones for RM 850 (top-up seller listing, Jul 2026)

let simCache = { key: null };
// Saved builds live only in this browser and expire 60 minutes after the last change.
const SAVE_TTL_MS = 60 * 60 * 1000;
function freshSave(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (!saved) return null;
    if (!Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > SAVE_TTL_MS) { localStorage.removeItem(key); return null; }
    return saved;
  } catch { localStorage.removeItem(key); return null; }
}

const state = { rmPerStar: Number(localStorage.getItem("rmPerStar")) || DEFAULT_RM_PER_STAR };

async function load(name) {
  const r = await fetch(`data/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}. Run ./scripts/fetch-data.sh`);
  return name.endsWith(".json") ? r.json() : r.text();
}

async function main() {
  let refine, cards, gear, shop, fetchedAt, apoc, affixes, fusion, runes, buffs, support, monsters, attacks, pets;
  try {
    [refine, cards, gear, shop, fetchedAt, apoc, affixes, fusion, runes, buffs, support, monsters, attacks, pets] = await Promise.all(
      ["refine.json", "cards.json", "equipment.json", "shop.json", "fetched_at.txt", "apocalypse.json", "affixes.json", "fusion.json", "runes.json", "buffs.json", "support.json",
        "monsters.json", "attacks.json", "pets.json"].map(load));
  } catch (e) {
    $("main").innerHTML = `<p class="note" style="color:var(--bad)">${esc(e.message)}</p>`;
    return;
  }
  $("#fetched-at").textContent = fetchedAt.trim();

  // tabs
  const show = (t) => {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.id === `tab-${t}`));
    history.replaceState(null, "", `#${t}`);
    if (t === "support") renderSupport(); // it skips work while hidden
  };
  $("#tabs").addEventListener("click", (e) => e.target.dataset.tab && show(e.target.dataset.tab));
  const start = location.hash.slice(1);
  if (start && document.getElementById(`tab-${start}`)) show(start);

  const rate = $("#rm-per-star");
  rate.value = state.rmPerStar;
  rate.addEventListener("change", () => {
    state.rmPerStar = Number(rate.value) || DEFAULT_RM_PER_STAR;
    localStorage.setItem("rmPerStar", state.rmPerStar);
    renderRefine(refine); renderShop(shop); renderGear(gear, refine); renderBuildResults(); renderFusion(); renderSupport();
  });

  setupRefine(refine);
  setupCards(cards);
  setupGear(gear, refine);
  setupShop(shop);
  B.buffData = buffs;
  Object.assign(B, { monsters, attacks, pets });
  setupBuild(gear, cards, refine, apoc, affixes, fusion, runes);
  setupFusion(fusion);
  setupSupport(support);
}

// ---------------------------------------------------------------- refine
function setupRefine(data) {
  const f = $("#refine-form");
  for (let i = 0; i < data.maxLevel; i++) f.from.add(new Option(`+${i}`, i));
  for (let i = 1; i <= data.maxLevel; i++) f.to.add(new Option(`+${i}`, i));
  f.from.value = 0; f.to.value = 10;
  let t;
  f.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => renderRefine(data), 200); });
  renderRefine(data);
}

function refineOpts(f) {
  const owned = {};
  for (const el of f.elements) if (el.name?.startsWith("own-")) owned[el.name.slice(4)] = Number(el.value) || 0;
  return {
    owned,
    blessing: f.blessing.checked,
    blessingFrom: Number(f.blessingFrom.value) || 0,
    // empty field -> use the bonus from the data
    blessingBonus: f.blessingBonus.value === "" ? undefined : Number(f.blessingBonus.value),
  };
}

function renderRefine(data) {
  const f = $("#refine-form");
  const from = Number(f.from.value);
  const to = Number(f.to.value);
  if (to <= from) {
    $("#refine-kpis").innerHTML = `<div class="kpi"><div class="label">Pick a target above the start level.</div></div>`;
    $("#refine-table").innerHTML = "";
    return;
  }
  const opts = refineOpts(f);
  // Keep one render under ~40M simulated attempts so the tab never freezes.
  const avgTries = expected(data, from, to, opts).attempts;
  const asked = Number(f.runs.value);
  const runsN = Math.max(500, Math.min(asked, Math.floor(4e7 / Math.max(1, avgTries))));
  // Budget and RM rate don't change the dice: reuse the last runs when only they change.
  const key = JSON.stringify([from, to, runsN, opts]);
  if (simCache.key !== key) simCache = { key, ...simulate(data, from, to, opts, runsN, 20261115) };
  const { mats, runs } = simCache;
  const R = state.rmPerStar;
  const col = (fn) => runs.map(fn).sort((a, b) => a - b);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const stars = col((r) => r.starstones);
  const budget = Number(f.budget.value) || 0;
  const within = runs.filter((r) => r.starstones * R <= budget).length / runs.length;

  const p50 = percentile(stars, 0.5) * R, p90 = percentile(stars, 0.9) * R, p99 = percentile(stars, 0.99) * R;
  $("#refine-kpis").innerHTML = `
    <div class="kpi good"><div class="label">Typical (half of players pay less)</div><div class="value">${rm(p50)}</div><div class="sub">P50 · ${fmt(percentile(stars, 0.5))} Starstones</div></div>
    <div class="kpi warn"><div class="label">Bad luck (1 in 10 pay more)</div><div class="value">${rm(p90)}</div><div class="sub">P90 · ${fmt(percentile(stars, 0.9))} Starstones</div></div>
    <div class="kpi bad"><div class="label">Very bad luck (1 in 100)</div><div class="value">${rm(p99)}</div><div class="sub">P99 · ${fmt(percentile(stars, 0.99))} Starstones</div></div>
    <div class="kpi ${within >= 0.8 ? "good" : within >= 0.5 ? "warn" : "bad"}"><div class="label">Chance RM ${fmt(budget)} is enough</div><div class="value">${fmt(within * 100, 0)}%</div><div class="sub">+${from} → +${to}, ${fmt(runsN)} simulated players${runsN < asked ? " (cut from " + fmt(asked) + " to stay fast)" : ""}</div></div>`;

  const rows = [
    ["Attempts", col((r) => r.attempts), (x) => fmt(x)],
    ...mats.map((m, i) => [`${m} used`, col((r) => r.used[i]), (x) => fmt(x)]).filter(([, xs]) => xs[xs.length - 1] > 0),
    ["Bound Zeny", col((r) => r.zeny), (x) => fmt(x)],
    ...(opts.blessing ? [["Legendary Ore used", col((r) => r.blessItems), (x) => fmt(x)]] : []),
    ["Starstones to buy", stars, (x) => fmt(x)],
    ["Real money", stars, (x) => rm(x * R)],
  ];
  $("#refine-table").innerHTML = `<table class="mid"><thead><tr><th>+${from} → +${to}</th><th class="num">Average</th><th class="num">P50</th><th class="num">P90</th><th class="num">P99</th><th class="num">Worst run</th></tr></thead><tbody>
    ${rows.map(([label, xs, show]) => `<tr${label === "Real money" ? ' class="hot"' : ""}><td>${esc(label)}</td><td class="num">${show(mean(xs))}</td><td class="num">${show(percentile(xs, 0.5))}</td><td class="num">${show(percentile(xs, 0.9))}</td><td class="num">${show(percentile(xs, 0.99))}</td><td class="num">${show(xs[xs.length - 1])}</td></tr>`).join("")}
  </tbody></table>`;

  // per-step cost (average, buying everything)
  const steps = data.levels.map((lv) => {
    const e = expected(data, lv.level, lv.level + 1, { ...opts, owned: {} });
    return { lv, e };
  });
  const maxRm = Math.max(0, ...steps.filter((s) => s.lv.level >= from && s.lv.level < to).map((s) => s.e.starstones * R));
  $("#refine-steps").innerHTML = `<table class="mid"><thead><tr><th>Step</th><th>Rates</th><th class="num">Success</th><th class="num">Drop −1</th><th class="num">Stay</th><th>Material / try</th><th class="num">Zeny / try</th><th class="num">Avg tries</th><th class="num">Avg cost</th></tr></thead><tbody>
    ${steps.map(({ lv, e }) => {
      const r = stepRates(lv, opts);
      const S = +(r.p * 100).toFixed(1), D = +(r.d * 100).toFixed(1), F = +(100 - S - D).toFixed(1);
      const inRange = lv.level >= from && lv.level < to;
      const cost = e.starstones * R;
      const safe = data.safeLevels.includes(lv.level + 1) ? ' <span class="tag">safe</span>' : "";
      return `<tr class="${inRange && cost >= maxRm * 0.25 ? "hot" : ""}" style="${inRange ? "" : "opacity:.45"}">
        <td>+${lv.level} → +${lv.level + 1}${safe}</td>
        <td><div class="bar"><i class="s" style="width:${S}%"></i><i class="d" style="width:${D}%"></i><i class="f" style="width:${F}%"></i></div></td>
        <td class="num">${S}%${S !== lv.success ? ` <span class="src">(${lv.success})</span>` : ""}</td><td class="num">${D ? D + "%" : "—"}</td><td class="num">${F ? F + "%" : "—"}</td>
        <td>${esc(lv.mat)} ×${lv.matAmount}</td><td class="num">${fmt(lv.zeny)}</td>
        <td class="num">${fmt(e.attempts, 1)}</td><td class="num">${rm(cost)}</td></tr>`;
    }).join("")}
  </tbody></table>`;

  const ex = expected(data, from, to, opts);
  $("#refine-note").innerHTML = `Exact average for +${from} → +${to}: ${fmt(ex.attempts, 1)} tries, ${fmt(ex.starstones)} Starstones (${rm(ex.starstones * R)}) if you buy every material.
    Rules used: success +1, "drop" −1 but never below the last safe level (+6/+9/+12/+15), otherwise stay.
    The game also has a pity bonus after fails whose exact rule is not public, so real costs can be up to ~15% lower at +12 and above.
    Blessing bonus is a guess from the data (1 point): check the rate shown in game with the ore on and type it in.
    Materials are priced at the Starstone shop rate (Oridecon 30, Enriched 60, HD 120 Bound Starstones each).`;
}

// ---------------------------------------------------------------- cards
function setupCards(cards) {
  const f = $("#cards-form");
  [...new Set(cards.map((c) => c.slot))].sort().forEach((s) => f.slot.add(new Option(s, s)));
  [...new Set(cards.map((c) => c.q))].sort().forEach((q) => f.q2.add(new Option(QUALITY[q] || q, q)));
  f.addEventListener("input", () => renderCards(cards));
  renderCards(cards);
}

function renderCards(cards) {
  const f = $("#cards-form");
  const q = f.q.value.trim().toLowerCase();
  const list = cards.filter((c) =>
    (!f.slot.value || c.slot === f.slot.value) &&
    (!f.q2.value || c.q === Number(f.q2.value)) &&
    (!f.farm.checked || (!c.mvp && c.src.length)) &&
    (!q || (c.name + " " + c.lines.join(" ") + " " + c.src.map((s) => s.n).join(" ")).toLowerCase().includes(q)))
    .sort((a, b) => b.q - a.q || a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));
  $("#cards-count").textContent = `${list.length} of ${cards.length} cards`;
  const img = (path, cls, alt) => path ? `<img class="${cls}" src="img/${esc(path)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`;
  const drop = (s) => `<div class="drop">${img(s.img, "mob", s.n)}<span>${esc(s.n)} <span class="src">Lv${s.lv ?? "?"} ${esc(s.t || "")}${s.r ? ` · ${fmt(s.r, 3)}% (~1 in ${fmt(100 / s.r)})` : ""}</span></span></div>`;
  $("#cards-table").innerHTML = `<div class="card-grid">${list.map((c) => `
    <article class="card-tile q${c.q}-edge">
      ${img(c.img, "card-art", c.name)}
      <div class="card-body">
        <div class="name q${c.q}">${esc(c.name)}</div>
        <div><span class="tag">${esc(c.slot)}</span><span class="tag">${esc(QUALITY[c.q] || c.q)}</span>${c.mvp ? '<span class="tag mvp">MVP</span>' : ""}${c.affixes ? `<span class="tag">+${c.affixes} random</span>` : ""}</div>
        <div class="lines effect">${c.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
        <div class="drops">${c.src.length ? c.src.slice(0, 3).map(drop).join("") + (c.src.length > 3 ? `<div class="src">+${c.src.length - 3} more</div>` : "")
          : `<div class="src">${esc((c.obtain || []).map((o) => OBTAIN[o] || o).join(" · ") || "—")}</div>`}</div>
      </div>
    </article>`).join("")}</div>`;
}

// ---------------------------------------------------------------- gear
function fmtAttr(attr, v) {
  if (!attr) return String(v);
  const pct = (x, k) => {
    const n = x * k;
    return attr.rn === 0 || Math.floor(x) === 0 ? `${fmt(Math.trunc(n))}%` : `${fmt(Number.isInteger(n) ? n : Number(n.toFixed(1)), 1)}%`;
  };
  switch (attr.ps) {
    case 0: return fmt(v);
    case 1: return pct(v, 0.01);
    case 3: return pct(v, 0.25);
    case 4: return fmt(Math.trunc(0.1 * v));
    case 5: return fmt(Math.floor(0.01 * v) / 100, 2);
    default: return fmt(Math.trunc(0.01 * v));
  }
}

function setupGear(gear, refine) {
  const f = $("#gear-form");
  [...new Set(gear.items.map((i) => i.slot))].sort().forEach((s) => f.slot.add(new Option(s, s)));
  Object.entries(gear.jobs).sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, n]) => f.job.add(new Option(n, id)));
  [...new Set(gear.items.map((i) => i.q))].sort().forEach((q) => f.q2.add(new Option(QUALITY[q] || q, q)));
  const used = new Set(gear.items.flatMap((i) => [...i.st, ...i.rf].map(([a]) => String(a))));
  [...used].filter((a) => gear.attrs[a]).sort((a, b) => gear.attrs[a].n.localeCompare(gear.attrs[b].n))
    .forEach((a) => f.sort.add(new Option(gear.attrs[a].n, a)));
  f.addEventListener("input", () => renderGear(gear, refine));
  renderGear(gear, refine);
}

function renderGear(gear, refine) {
  const f = $("#gear-form");
  const q = f.q.value.trim().toLowerCase();
  const N = Math.max(0, Math.min(20, Number(f.refine.value) || 0));
  const job = f.job.value ? Number(f.job.value) : null;
  const maxLv = Number(f.lv.value) || 999;
  const sortA = f.sort.value;
  const at = (it, a) => {
    let v = 0;
    for (const [id, x] of it.st) if (String(id) === a) v += x;
    for (const [id, x] of it.rf) if (String(id) === a) v += x * N;
    return v;
  };
  let list = gear.items.filter((i) =>
    (i.st.length || i.rf.length) &&
    (!f.slot.value || i.slot === f.slot.value) &&
    (!f.q2.value || i.q === Number(f.q2.value)) &&
    i.lv <= maxLv &&
    (job === null || i.jobs === null || i.jobs.includes(job)) &&
    (!q || (i.n + " " + i.suit.join(" ")).toLowerCase().includes(q)));
  list = sortA ? list.filter((i) => at(i, sortA) > 0).sort((a, b) => at(b, sortA) - at(a, sortA))
               : list.sort((a, b) => a.n.localeCompare(b.n));
  const cost = expected(refine, 0, N);
  $("#gear-count").innerHTML = `${list.length} items${list.length > 300 ? " (showing first 300, narrow the filters)" : ""}.
    Getting one item to +${N} from +0 costs about <b>${rm(cost.starstones * state.rmPerStar)}</b> on average if you buy every material (weapon rates; armor uses Elunium at the same Starstone price).`;
  const line = ([a, v], mult = 1) => `${esc(gear.attrs[a]?.n ?? a)} +${fmtAttr(gear.attrs[a], v * mult)}`;
  $("#gear-table").innerHTML = `<table><thead><tr><th>Item</th><th>Slot</th><th class="num">Lv</th><th>Base stats</th><th>Per +1 refine</th><th>At +${N} (refine part)</th>${sortA ? `<th class="num">${esc(gear.attrs[sortA].n)} at +${N}</th>` : ""}</tr></thead><tbody>
    ${list.slice(0, 300).map((i) => `<tr>
      <td><div class="item-cell">${i.img ? `<img class="gear-icon q${i.q}-edge" src="img/${esc(i.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ""}<div><div class="name q${i.q}">${esc(i.n)}</div>${i.suit.map((s) => `<span class="tag">${esc(s)} set</span>`).join("")}${i.jobs ? `<div class="src">${esc(i.jobs.map((j) => gear.jobs[j] || j).join(", "))}</div>` : ""}</div></div></td>
      <td>${esc(i.slot)}</td><td class="num">${i.lv}</td>
      <td class="lines">${i.st.map((s) => `<div>${line(s)}</div>`).join("") || "—"}</td>
      <td class="lines">${i.rf.map((s) => `<div>${line(s)}</div>`).join("") || "—"}</td>
      <td class="lines">${N ? i.rf.map((s) => `<div>${line(s, N)}</div>`).join("") || "—" : "—"}</td>
      ${sortA ? `<td class="num">${fmtAttr(gear.attrs[sortA], at(i, sortA))}</td>` : ""}</tr>`).join("")}
  </tbody></table>`;
}

// ---------------------------------------------------------------- shop
function setupShop(shop) {
  $("#shop-form").addEventListener("input", () => renderShop(shop));
  renderShop(shop);
}

function renderShop(shop) {
  const f = $("#shop-form");
  const q = f.q.value.trim().toLowerCase();
  const isStar = (i) => i.curId === 201 || i.curId === 2201;
  const list = shop.filter((i) => (!f.stars.checked || isStar(i)) && (!q || (i.n + " " + i.store + " " + i.tab).toLowerCase().includes(q)))
    .sort((a, b) => (isStar(b) - isStar(a)) || a.store.localeCompare(b.store) || a.price - b.price);
  $("#shop-count").textContent = `${list.length} items${list.length > 400 ? " (showing first 400, search to narrow)" : ""}`;
  $("#shop-table").innerHTML = `<table class="mid"><thead><tr><th>Item</th><th>Shop / tab</th><th class="num">Qty</th><th>Price</th><th class="num">In RM</th><th class="num">Buy limit</th></tr></thead><tbody>
    ${list.slice(0, 400).map((i) => `<tr><td><div class="item-cell">${i.img ? `<img class="shop-icon q${i.q ?? 1}-edge" src="img/${esc(i.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="shop-icon"></span>`}<span class="name">${esc(i.n)}</span></div></td><td>${esc(i.store)} · ${esc(i.tab)}</td><td class="num">${i.num}</td>
      <td>${fmt(i.price)} ${esc(i.cur)}</td><td class="num">${isStar(i) ? rm(i.price * state.rmPerStar) : "—"}</td>
      <td class="num">${i.limit ? fmt(i.limit) : "—"}</td></tr>`).join("")}
  </tbody></table>`;
}

// ---------------------------------------------------------------- build & damage
const STAT_LABEL = {
  atk: "ATK", ratk: "Refine ATK", atkp: "ATK% (gear)", matk: "M.ATK", rmatk: "Refine M.ATK", matkp: "M.ATK% (gear)",
  fixp: "Fixed PDMG", fixm: "Fixed MDMG", fixall: "Fixed Bonus DMG", pdmg: "PDMG Bonus%", mdmg: "MDMG Bonus%",
  melee: "Melee PDMG%", ranged: "Ranged PDMG%", rmagic: "Ranged MDMG%", crit: "CRIT", critdmg: "CRIT DMG%",
  sizeall: "DMG vs all sizes%", elemall: "Elemental DMG%", aspd: "ASPD%", hp: "HP", hpp: "Max HP%", sp: "SP", spp: "Max SP%",
  def: "DEF", rdef: "Refine DEF", defp: "DEF%", mdef: "M.DEF", rmdef: "Refine M.DEF", mdefp: "M.DEF%",
  hit: "HIT", flee: "FLEE", critres: "CRIT RES", critdmgres: "CRIT DMG RES%", pred: "PDMG Reduction%", mred: "MDMG Reduction%",
  rpred: "Ranged PDMG Reduction%", vct: "Variable Cast Time%", fct: "Fixed Cast Time%", heal: "Healing%", rheal: "Received Healing%",
  royal: "Royal Might DMG%", royalres: "Royal Might DMG Reduction%", eresall: "Elemental DMG Reduction%", load: "Load",
  str: "STR", agi: "AGI", vit: "VIT", int: "INT", dex: "DEX", luk: "LUK",
  mult: "Total DMG multiplier% (runes)", dmgres: "DMG taken −% (runes)",
  atkall: "ATK% of total (skill buffs)", matkall: "M.ATK% of total (skill buffs)",
  mpred: "Melee PDMG Reduction%", rmred: "Ranged MDMG Reduction%", pvp: "PVP DMG%", pvpres: "PVP DMG Reduction%", season_off: "Aggressive (season)", season_def: "Defensive (season)",
};
const PCT_KEYS = /^(atkall|matkall|mult|dmgres|mpred|rmred|atkp|matkp|pdmg|mdmg|melee|ranged|rmagic|critdmg|critdmgres|sizeall|elemall|aspd|hpp|spp|defp|mdefp|pred|mred|rpred|vct|fct|heal|rheal|royal|royalres|eresall|pvp|pvpres|(race|size|elem|vselem|eres|rres|sres):.*)$/;
function statLabel(k) {
  if (STAT_LABEL[k]) return STAT_LABEL[k];
  const [kind, v] = k.split(":");
  return ({ race: `DMG vs ${v}%`, size: `DMG vs ${v} size%`, elem: `${v} skill DMG%`, vselem: `DMG vs ${v} target%`,
    eres: `${v} DMG Reduction%`, rres: `DMG Reduction vs ${v}%`, sres: `DMG Reduction vs ${v} size%`, res: `${v} RES` })[kind] || k;
}
const fmtStat = (k, v) => PCT_KEYS.test(k) ? `${fmt(v * 100, Math.abs(v * 100) < 10 && v * 100 % 1 ? 1 : 0)}%` : fmt(v, v % 1 ? 1 : 0);
function countsFor(ctx) {
  const magic = ctx.type.startsWith("magic");
  return new Set([
    ...(magic ? ["matk", "rmatk", "matkp", "fixm", "mdmg"] : ["atk", "ratk", "atkp", "fixp", "pdmg", "critdmg"]),
    "fixall", "mult", magic ? "matkall" : "atkall", ctx.type === "melee" ? "melee" : ctx.type === "ranged" ? "ranged" : ctx.type === "magic-ranged" ? "rmagic" : "",
    `race:${ctx.race}`, `size:${ctx.size}`, "sizeall", `elem:${ctx.skillElement}`, "elemall", `vselem:${ctx.targetElement}`,
  ]);
}

const B = { now: {}, plan: {}, lookup: null, refine: null, gear: null, cards: null, apoc: [], affixes: [],
  mode: "panel", panel: {}, base: { atk: 300, matk: 300 }, buffs: [], skillBuffs: [], gearView: "all" };
const BUILD_KEY = "ro-sim:build:v1";

function setupBuild(gear, cards, refine, apoc, affixes, fusion, runes) {
  B.gear = gear; B.cards = cards; B.refine = refine; B.apoc = apoc; B.affixes = affixes; B.fusion = fusion; B.runes = runes;
  B.lookup = { items: new Map(gear.items.map((i) => [i.id, i])), cards: new Map(cards.map((c) => [c.id, c])),
    apoc: new Map(apoc.map((a) => [a.id, a])), affix: new Map(affixes.map((a) => [a.id, a])),
    cardaffix: new Map(Object.entries(fusion.random)), runes, sets: gear.sets, pets: new Map(B.pets.map((p) => [p.id, p])) };
  const f = $("#build-form");
  setupJobPicker();
  setupShot();
  RACES.forEach((r) => f.race.add(new Option(r, r)));
  SIZES.forEach((r) => f.size.add(new Option(r, r)));
  ELEMENTS.forEach((r) => { f.skillElement.add(new Option(r, r)); f.targetElement.add(new Option(r, r)); });
  f.size.value = "Medium";
  setupMonsters();

  // restore the last session (ids that no longer exist are dropped)
  try {
    const saved = freshSave(BUILD_KEY);
    if (saved) {
      for (const [k, v] of Object.entries(saved.form || {})) if (f.elements[k]) f.elements[k].value = v;
      for (const side of ["now", "plan"]) B[side] = cleanBuild(saved[side]);
      if (["all", "equip", "shadow"].includes(saved.gearView)) B.gearView = saved.gearView; // the old "shadow: false" is ignored on purpose
      if (saved.mode === "gear" || saved.mode === "panel") B.mode = saved.mode;
      for (const [k, v] of Object.entries(saved.panel || {})) if (typeof k === "string" && Number.isFinite(v)) B.panel[k] = v;
      for (const k of ["atk", "matk"]) if (Number.isFinite(saved.base?.[k])) B.base[k] = saved.base[k];
      // old saves kept base ATK inside the form
      if (Number.isFinite(Number(saved.form?.baseAtk)) && saved.form?.baseAtk !== undefined && !saved.base) B.base.atk = Number(saved.form.baseAtk);
      if (Number.isFinite(Number(saved.form?.baseMatk)) && saved.form?.baseMatk !== undefined && !saved.base) B.base.matk = Number(saved.form.baseMatk);
      B.buffs = (Array.isArray(saved.buffs) ? saved.buffs : []).filter((x) => typeof x?.key === "string" && Number.isFinite(x.value))
        .map((x) => ({ key: x.key, value: x.value, label: String(x.label || "").slice(0, 40) }));
      const known = new Set((B.buffData?.skills || []).map((x) => x.id));
      B.skillBuffs = (Array.isArray(saved.skillBuffs) ? saved.skillBuffs : []).filter((x) => known.has(Number(x?.id)))
        .map((x) => ({ id: Number(x.id), lv: Math.max(1, Number(x.lv) || 1) }));
    }
  } catch { /* ignore a broken save */ }
  const savedForm = freshSave(BUILD_KEY)?.form;
  fillAtkSkills(savedForm?.atkSkill, savedForm?.atkLv);
  showMonster();

  f.addEventListener("change", (e) => {
    if (e.target.name === "atkSkill") { fillAtkLevels(); applyAtkSkill(); }
    else if (e.target.name === "atkLv") applyAtkSkill();
    else if (e.target.name === "monster") applyMonster();
    else return;
    renderPanel(); renderBuildResults();
  });
  f.addEventListener("input", (e) => {
    if (["skill", "skillFlat", "hits", "type", "skillElement"].includes(e.target.name)) atkNote(); // typed by hand: no longer exactly the picked skill
    if (e.target.name === "monster" && monLabels.has(e.target.value.trim())) applyMonster(); // picked from the list
    renderPanel(); renderBuildResults();
  });
  setupPanel();
  $("#gear-view").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    B.gearView = b.dataset.view;
    renderBuildTable();
    saveBuild();
    if (B.gearView === "shadow") {
      const y = $("#gear-view").getBoundingClientRect().top + window.scrollY - 70; // keep the buttons and the "Fill a whole set" row in view
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  });
  $("#copy-now").addEventListener("click", () => { B.plan = structuredClone(B.now); renderBuildTable(); renderExtras(); renderRunes(); renderBuildResults(); });
  $("#clear-plan").addEventListener("click", () => { B.plan = {}; renderBuildTable(); renderExtras(); renderRunes(); renderBuildResults(); });
  setupExtras();
  setupRunes();
  const setSlot = (side, slot, patch) => {
    B[side][slot] = { item: null, refine: 0, card: null, ...(B[side][slot] || {}), ...patch };
    renderBuildTable();
    renderBuildResults();
  };
  $("#build-table").addEventListener("change", (e) => {
    const el = e.target;
    const { side, slot, field } = el.dataset;
    if (!side) return;
    if (field === "item") {
      const text = el.value.trim();
      if (!text) return setSlot(side, slot, { item: null });
      const id = labelToItem.get(el.getAttribute("list"))?.get(text);
      if (id != null) return setSlot(side, slot, { item: id });
      el.classList.add("bad"); // not a known item: leave the old pick
      el.title = "Pick a name from the list";
      return;
    }
    if (field === "card") return setSlot(side, slot, { card: el.value ? Number(el.value) : null });
  });
  $("#build-table").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-step]");
    if (btn) {
      const { side, slot } = btn.dataset;
      const r = Number(B[side][slot]?.refine) || 0;
      return setSlot(side, slot, { refine: Math.max(0, Math.min(20, r + Number(btn.dataset.step))) });
    }
    const clr = e.target.closest("button[data-clear]");
    if (clr) setSlot(clr.dataset.side, clr.dataset.slot, { item: null, refine: 0, card: null });
  });
  renderBuildTable();
  renderExtras();
  renderRunes();
  renderPanel();
  renderBuffs();
  renderJobButton();
  renderBuildResults();
}

function cleanBuild(b) {
  const out = {};
  const els = new Set(RUNE_ELS), grp = new Set(B.runes.groups.map((g) => g.id)), sts = new Set(B.runes.stats.map((x) => x.attr));
  out.runes = Array.from({ length: 5 }, (_, i) => {
    const r = Array.isArray(b?.runes) ? b.runes[i] : null;
    if (!r || !els.has(r.el)) return emptyRune();
    return {
      el: r.el, lv: Math.max(1, Math.min(4, Number(r.lv) || 1)), celestial: Boolean(r.celestial),
      group: grp.has(Number(r.group)) ? Number(r.group) : null, count: Boolean(r.count),
      colors: [0, 1].map((k) => (els.has(r.colors?.[k]) ? r.colors[k] : null)),
      stats: [0, 1, 2].map((k) => (sts.has(Number(r.stats?.[k])) ? Number(r.stats[k]) : null)),
    };
  });
  out.extras = (Array.isArray(b?.extras) ? b.extras : []).filter((x) =>
    (x?.kind === "apoc" && B.lookup.apoc.has(x.id)) ||
    (x?.kind === "affix" && B.lookup.affix.has(x.id)) ||
    (x?.kind === "cardaffix" && B.lookup.cardaffix.has(x.id)) ||
    (x?.kind === "pet" && B.lookup.pets.has(x.id) && Number.isFinite(Number(x.lv))) ||
    (x?.kind === "stat" && typeof x.key === "string" && Number.isFinite(x.value)))
    .map((x) => x.kind === "pet" ? { kind: "pet", id: x.id, lv: Number(x.lv) }
      : ["apoc", "affix", "cardaffix"].includes(x.kind) ? { kind: x.kind, id: x.id } : { kind: "stat", key: x.key, value: x.value, label: String(x.label || "").slice(0, 40) });
  for (const slot of SLOTS) {
    const s = b?.[slot.id];
    if (!s) continue;
    out[slot.id] = {
      item: B.lookup.items.has(s.item) ? s.item : null,
      refine: Math.max(0, Math.min(20, Number(s.refine) || 0)),
      card: B.lookup.cards.has(s.card) ? s.card : null,
    };
  }
  return out;
}

function saveBuild() {
  const f = $("#build-form");
  const form = {};
  for (const el of f.elements) if (el.name) form[el.name] = el.value;
  localStorage.setItem(BUILD_KEY, JSON.stringify({ savedAt: Date.now(), form, now: B.now, plan: B.plan, gearView: B.gearView,
    mode: B.mode, panel: B.panel, base: B.base, buffs: B.buffs, skillBuffs: B.skillBuffs }));
}

function buildCtx() {
  const f = $("#build-form");
  return {
    type: f.type.value, race: f.race.value, size: f.size.value,
    skillElement: f.skillElement.value, targetElement: f.targetElement.value,
    skill: (f.skill.value.trim() === "" ? 100 : Number(f.skill.value) || 0) / 100,
    skillFlat: Math.max(0, Number(f.skillFlat.value) || 0),
    hits: Math.max(1, Math.min(99, Math.round(Number(f.hits.value) || 1))),
    baseAtk: Number(B.base.atk) || 0, baseMatk: Number(B.base.matk) || 0,
    critBase: Number(f.critBase.value) || 1.5,
    targetReduction: (Number(f.targetReduction.value) || 0) / 100,
    roll: f.roll.value,
  };
}

// Item search lists: one <datalist> per slot type and job, built once.
const labelToItem = new Map(); // datalist id -> Map(label -> item id)
function itemList(slot, job) {
  const id = `dl-${slot.at}-${job ?? "any"}`;
  if (!labelToItem.has(id)) {
    const list = B.gear.items.filter((i) => i.at === slot.at && (i.fx.length || i.rfx.length) &&
      (job === null || i.jobs === null || i.jobs.includes(job)))
      .sort((a, b) => b.lv - a.lv || b.q - a.q || a.n.localeCompare(b.n));
    const map = new Map();
    for (const i of list) {
      let label = `${i.n} · Lv${i.lv} · ${QUALITY[i.q] || i.q}`;
      if (map.has(label)) label += ` #${i.id}`;
      map.set(label, i.id);
    }
    labelToItem.set(id, map);
    const dl = document.createElement("datalist");
    dl.id = id;
    dl.innerHTML = [...map.keys()].map((l) => `<option value="${esc(l)}"></option>`).join("");
    $("#build-datalists").append(dl);
  }
  return id;
}
function itemLabel(listId, itemId) {
  for (const [label, id] of labelToItem.get(listId) || []) if (id === itemId) return label;
  const i = B.lookup.items.get(itemId);
  return i ? `${i.n} · Lv${i.lv} · ${QUALITY[i.q] || i.q}` : "";
}
const cardOptionCache = new Map();
function cardOptions(slot) {
  if (!cardOptionCache.has(slot.card)) {
    const list = B.cards.filter((c) => c.slot === slot.card).sort((a, b) => b.q - a.q || a.name.localeCompare(b.name));
    cardOptionCache.set(slot.card, `<option value="">No card</option>` +
      list.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.lines[0] || "")}</option>`).join(""));
  }
  return cardOptionCache.get(slot.card);
}

function renderBuildTable() {
  // Replacing a focused input fires its blur (and a pending change) mid-render;
  // let that finish first so two renders never overlap.
  const focused = document.activeElement;
  if (focused && $("#build-table").contains(focused)) focused.blur();
  const job = $("#build-form").job.value ? Number($("#build-form").job.value) : null;
  for (const b of $("#gear-view").querySelectorAll("button")) b.classList.toggle("on", b.dataset.view === B.gearView);
  const slotIcon = (slot) => B.gear.slotIcons?.[slot.at];
  const sideCell = (side, slot) => {
    const s = B[side][slot.id] || {};
    const item = s.item != null ? B.lookup.items.get(s.item) : null;
    const card = s.card != null ? B.lookup.cards.get(s.card) : null;
    const listId = itemList(slot, job);
    const r = Number(s.refine) || 0;
    const icon = item?.img
      ? `<img class="pick-icon q${item.q}-edge" src="img/${esc(item.img)}" alt="" loading="lazy">`
      : `<span class="pick-icon empty">${slotIcon(slot) ? `<img src="img/${esc(slotIcon(slot))}" alt="">` : ""}</span>`;
    return `<td class="side-cell" data-label="${side === "now" ? "Now · what you wear" : "Plan · what you'd put in"}"><div class="pick">
      ${icon}
      <div class="pick-main">
        <div class="pick-row">
          <input class="item-search" list="${listId}" value="${esc(item ? itemLabel(listId, item.id) : "")}" placeholder="Type to search ${esc(slot.label.toLowerCase())}…"
            data-side="${side}" data-slot="${slot.id}" data-field="item" aria-label="${side} ${esc(slot.label)}">
          ${item ? `<button type="button" class="clear" data-clear="1" data-side="${side}" data-slot="${slot.id}" title="Remove">✕</button>` : ""}
        </div>
        <div class="pick-row">
          <span class="stepper ${item ? "" : "off"}" title="Refine level">
            <button type="button" data-step="-1" data-side="${side}" data-slot="${slot.id}" aria-label="Refine down" ${r <= 0 ? "disabled" : ""}>−</button>
            <b>+${r}</b>
            <button type="button" data-step="1" data-side="${side}" data-slot="${slot.id}" aria-label="Refine up" ${r >= 20 ? "disabled" : ""}>+</button>
          </span>
          ${slot.shadow ? `<span class="note">no card slot</span>` : `
          ${card?.img ? `<img class="card-thumb" src="img/${esc(card.img)}" alt="">` : `<span class="card-thumb empty"></span>`}
          <select class="card-pick" data-side="${side}" data-slot="${slot.id}" data-field="card" aria-label="${side} ${esc(slot.label)} card">${cardOptions(slot)}</select>`}
        </div>
      </div>
    </div></td>`;
  };
  const changed = (id) => {
    const a = B.now[id] || {}, b = B.plan[id] || {};
    return (a.item ?? null) !== (b.item ?? null) || (Number(a.refine) || 0) !== (Number(b.refine) || 0) || (a.card ?? null) !== (b.card ?? null);
  };
  const rows = SLOTS.filter((s) => B.gearView === "all" || (B.gearView === "shadow") === Boolean(s.shadow));
  $("#build-table").innerHTML = `<table class="gear-compare"><thead><tr><th>Slot</th><th class="side-h">Now · what you wear</th><th class="side-h">Plan · what you are thinking of</th></tr></thead><tbody>
    ${rows.map((slot, i) => `${slot.shadow && !rows[i - 1]?.shadow ? `<tr class="group"><td colspan="3">${shadowFillTool(job)}</td></tr>${shadowFillRow(job)}` : ""}
      <tr data-row="${slot.id}" class="${changed(slot.id) ? "changed" : ""}">
        <td><div class="slot-name">${slotIcon(slot) ? `<span class="slot-icon"><img src="img/${esc(slotIcon(slot))}" alt=""></span>` : ""}<span>${esc(slot.label)}${changed(slot.id) ? `<span class="pill changed-pill">changed</span>` : ""}</span></div></td>
        ${sideCell("now", slot)}${sideCell("plan", slot)}</tr>`).join("")}
  </tbody></table>`;
  for (const el of $("#build-table").querySelectorAll("select[data-field=card]")) {
    const v = B[el.dataset.side][el.dataset.slot]?.card;
    el.value = v == null ? "" : String(v);
  }
}

// nothing picked on this side of the Damage tab (no slot, extra or rune)
const sideEmpty = (side) => !SLOTS.some((sl) => B[side][sl.id]?.item != null || B[side][sl.id]?.card != null) &&
  !(B[side].extras || []).length && !(B[side].runes || []).some((r) => r?.el);

function renderBuildResults() {
  if (!B.lookup) return;
  const ctx = buildCtx();
  const now = sumStats(B.now, B.lookup, ctx.roll);
  const plan = sumStats(B.plan, B.lookup, ctx.roll);
  let ctxRun = ctx;
  if (B.mode === "panel") {
    const w = withPanel(now.t, plan.t, B.panel);
    now.t = w.now; plan.t = w.plan;
    ctxRun = { ...ctx, ...w.base };
  }
  // buffs count on both sides, on top of the screen numbers
  const sb = skillBuffStats(B.skillBuffs, B.buffData);
  for (const [k, v] of [...B.buffs.map((b) => [b.key, b.value]), ...sb.fx]) {
    now.t[k] = (now.t[k] || 0) + v;
    plan.t[k] = (plan.t[k] || 0) + v;
  }
  now.notes.push(...sb.notes);
  const dn = damage(now.t, ctxRun);
  const dp = damage(plan.t, ctxRun);
  const change = dn.hit > 0 ? dp.hit / dn.hit - 1 : 0;
  const stars = upgradeStarstones(B.now, B.plan, B.refine);
  const cost = stars * state.rmPerStar;
  // From the character screen with nothing changed yet, Plan is simply Now.
  const sameAsNow = B.mode === "panel" && sideEmpty("plan") && sideEmpty("now");
  const planEmpty = sideEmpty("plan") && !sameAsNow;
  const crit = (d) => d.crit == null ? "magic: no crit" : `crit ${fmt(d.crit)}`;
  $("#build-kpis").innerHTML = `
    <div class="kpi"><div class="label">Now · damage per hit</div><div class="value">${fmt(dn.hit)}</div><div class="sub">${ctx.hits > 1 ? `× ${ctx.hits} hits = ${fmt(dn.hit * ctx.hits)} · ` : ""}${crit(dn)} · ${ctx.type.startsWith("magic") ? "M.ATK" : "ATK"} ${fmt(dn.atk)}</div></div>
    <div class="kpi"><div class="label">Plan · damage per hit</div><div class="value">${planEmpty ? "—" : fmt(dp.hit)}</div><div class="sub">${planEmpty ? "fill the Plan column, or Copy Now → Plan" : `${ctx.hits > 1 ? `× ${ctx.hits} hits = ${fmt(dp.hit * ctx.hits)} · ` : ""}${crit(dp)} · ${ctx.type.startsWith("magic") ? "M.ATK" : "ATK"} ${fmt(dp.atk)}`}</div></div>
    <div class="kpi ${change > 0.0005 ? "good" : change < -0.0005 ? "bad" : ""}"><div class="label">Plan vs Now</div><div class="value">${planEmpty ? "—" : `${change >= 0 ? "+" : ""}${fmt(change * 100, 1)}%`}</div><div class="sub">${sameAsNow ? "change a slot, rune or extra to compare" : `vs ${esc(ctx.race)} · ${esc(ctx.size)} · ${esc(ctx.targetElement)}`}</div></div>
    <div class="kpi ${cost > 0 ? "warn" : ""}"><div class="label">Refines in Plan cost about</div><div class="value">${rm(cost)}</div><div class="sub">${cost > 0 && change > 0.0005 ? `${rm(cost / (change * 100))} per +1% damage · ` : ""}average, all materials bought</div></div>`;


  renderSets();
  const counts = countsFor(ctx);
  const keys = [...new Set([...Object.keys(now.t), ...Object.keys(plan.t)])].filter((k) => (now.t[k] || 0) !== 0 || (plan.t[k] || 0) !== 0)
    .sort((a, b) => (counts.has(b) - counts.has(a)) || statLabel(a).localeCompare(statLabel(b)));
  const statRow = (k) => {
    const a = now.t[k] || 0, b = plan.t[k] || 0, d = b - a;
    return `<tr class="${counts.has(k) ? "counts" : ""}"><td>${esc(statLabel(k))}</td><td class="num">${fmtStat(k, a)}</td><td class="num">${fmtStat(k, b)}</td>
      <td class="num"><span class="pill ${d > 0 ? "up" : d < 0 ? "down" : "flat"}">${d ? (d > 0 ? "+" : "") + fmtStat(k, d) : "same"}</span></td></tr>`;
  };
  const dmgKeys = keys.filter((k) => counts.has(k)), otherKeys = keys.filter((k) => !counts.has(k));
  $("#build-stats").innerHTML = keys.length ? `<table class="stat-compare"><thead><tr><th>Stat</th><th class="num">Now</th><th class="num">Plan</th><th class="num">Change</th></tr></thead><tbody>
    ${dmgKeys.length ? `<tr class="group"><td colspan="4">Counts in damage vs ${esc(ctx.race)} · ${esc(ctx.size)} · ${esc(ctx.targetElement)}</td></tr>${dmgKeys.map(statRow).join("")}` : ""}
    ${otherKeys.length ? `<tr class="group"><td colspan="4">Other stats</td></tr>${otherKeys.map(statRow).join("")}` : ""}
    </tbody></table>` : `<p class="note">Pick some gear above to see the stats.</p>`;

  const extra = [...new Set([...now.notes, ...plan.notes])];
  const statPts = keys.filter((k) => ["str", "agi", "vit", "int", "dex", "luk"].includes(k));
  $("#build-notes").innerHTML = `
    ${extra.length ? `<b>Card effects not in the number</b> (procs, immunities, special rules):<br>${extra.map(esc).join("<br>")}<br><br>` : ""}
    ${statPts.length ? `STR/AGI/VIT/INT/DEX/LUK from gear are listed but not turned into ATK, because the game's stat formula is not public. Check the ATK on your character panel after equipping.<br>` : ""}
    How the estimate works: (ATK without gear + gear ATK × (1 + ATK%)) × skill % + the skill's flat part + fixed damage, then × PDMG Bonus%, × melee/ranged%, × race%, × size%, × skill element%, × target element%, × (1 − target reduction).
    Each kind of bonus is its own multiplier, as in other Ragnarok mobile games. The real formula is not public and target DEF is left out, so trust the % change more than the raw number.`;
  saveBuild();
  renderSupport(); // the Support tab's Plan follows this gear
}

// ---- extra bonuses: Apocalypse traits + typed stats (Title, Relic, Pet…)
const EXTRA_STATS = ["atk", "atkp", "matk", "matkp", "pdmg", "mdmg", "melee", "ranged", "rmagic", "critdmg", "crit",
  "fixp", "fixm", "fixall", ...RACES.map((r) => `race:${r}`), ...SIZES.map((z) => `size:${z}`), "sizeall",
  ...ELEMENTS.map((e) => `elem:${e}`), "elemall", ...ELEMENTS.map((e) => `vselem:${e}`),
  "str", "agi", "vit", "int", "dex", "luk", "hp", "hpp", "def", "mdef", "aspd", "pred", "mred", "royal", "royalres", "heal", "rheal"];
const APOC_PARTS = ["Weapon", "Off-Hand", "Armor", "Cape", "Shoes", "Accessory"];

function setupExtras() {
  const box = $("#build-extras");
  box.addEventListener("change", (e) => {
    if (e.target.dataset.role === "part") fillApocSelect(e.target.dataset.side);
    if (e.target.dataset.role === "affix-part") fillAffixList(e.target.dataset.side);
    if (e.target.dataset.role === "cardaffix-slot") fillCardAffixSelect(e.target.dataset.side);
    if (e.target.dataset.role === "pet") fillPetLevels(e.target.dataset.side);
  });
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const side = btn.dataset.side;
    const list = (B[side].extras ||= []);
    if (btn.dataset.act === "del") list.splice(Number(btn.dataset.i), 1);
    if (btn.dataset.act === "add-apoc") {
      const id = Number(box.querySelector(`select[data-role=apoc][data-side=${side}]`).value);
      if (B.lookup.apoc.has(id)) list.push({ kind: "apoc", id });
    }
    if (btn.dataset.act === "add-affix") {
      const input = box.querySelector(`input[data-role=affix][data-side=${side}]`);
      const id = affixLabels.get(input.getAttribute("list"))?.get(input.value.trim());
      if (id == null) { input.classList.add("bad"); input.title = "Pick an affix from the list"; return; }
      list.push({ kind: "affix", id });
    }
    if (btn.dataset.act === "add-cardaffix") {
      const key = box.querySelector(`select[data-role=cardaffix][data-side=${side}]`).value;
      if (B.lookup.cardaffix.has(key)) list.push({ kind: "cardaffix", id: key });
    }
    if (btn.dataset.act === "add-pet") {
      const id = Number(box.querySelector(`select[data-role=pet][data-side=${side}]`).value);
      const lv = Number(box.querySelector(`select[data-role=pet-lv][data-side=${side}]`).value);
      if (B.lookup.pets.has(id) && Number.isFinite(lv)) list.push({ kind: "pet", id, lv });
    }
    if (btn.dataset.act === "add-stat") {
      const key = box.querySelector(`select[data-role=stat][data-side=${side}]`).value;
      const raw = Number(box.querySelector(`input[data-role=val][data-side=${side}]`).value);
      const label = box.querySelector(`input[data-role=label][data-side=${side}]`).value.trim().slice(0, 40);
      if (key && Number.isFinite(raw) && raw !== 0) list.push({ kind: "stat", key, value: PCT_KEYS.test(key) ? raw / 100 : raw, label });
    }
    renderExtras();
    renderBuildResults();
  });
}

function fillApocSelect(side) {
  const box = $("#build-extras");
  const part = box.querySelector(`select[data-role=part][data-side=${side}]`).value;
  const job = $("#build-form").job.value ? Number($("#build-form").job.value) : null;
  const list = B.apoc.filter((a) => a.parts.includes(part) && (job === null || a.jobs === null || a.jobs.includes(job)))
    .sort((a, b) => (b.fx.length > 0) - (a.fx.length > 0) || (a.cat !== "Stat") - (b.cat !== "Stat") || b.q - a.q || a.cat.localeCompare(b.cat) || a.text.localeCompare(b.text));
  box.querySelector(`select[data-role=apoc][data-side=${side}]`).innerHTML =
    list.map((a) => `<option value="${a.id}">${esc(QUALITY[a.q] || a.q)} · ${esc(a.text.length > 90 ? a.text.slice(0, 88) + "…" : a.text)}</option>`).join("");
}

const AFFIX_PARTS = ["Weapon", "Accessory", "Armor", "Cape"];
const affixLabels = new Map(); // datalist id -> Map(label -> affix id)
function fillAffixList(side) {
  const box = $("#build-extras");
  const part = box.querySelector(`select[data-role=affix-part][data-side=${side}]`).value;
  const job = $("#build-form").job.value ? Number($("#build-form").job.value) : null;
  const id = `af-${part}-${job ?? "any"}`;
  if (!affixLabels.has(id)) {
    const map = new Map();
    B.affixes.filter((a) => a.parts.includes(part) && (job === null || a.jobs === null || a.jobs.includes(job)))
      .sort((a, b) => a.name.localeCompare(b.name) || b.q - a.q || b.lv - a.lv)
      .forEach((a) => {
        let label = `${a.name} · L${a.lv} · ${QUALITY[a.q] || a.q} — ${a.text.length > 80 ? a.text.slice(0, 78) + "…" : a.text}`;
        if (map.has(label)) label += ` #${a.id}`;
        map.set(label, a.id);
      });
    affixLabels.set(id, map);
    const dl = document.createElement("datalist");
    dl.id = id;
    dl.innerHTML = [...map.keys()].map((l) => `<option value="${esc(l)}"></option>`).join("");
    $("#build-datalists").append(dl);
  }
  const input = box.querySelector(`input[data-role=affix][data-side=${side}]`);
  input.setAttribute("list", id);
  input.placeholder = `Type to search ${affixLabels.get(id).size} ${part.toLowerCase()} affixes…`;
}

const TIER_NAME = { 2: "Green", 3: "Blue", 4: "Purple" };
function fillCardAffixSelect(side) {
  const box = $("#build-extras");
  const slot = box.querySelector(`select[data-role=cardaffix-slot][data-side=${side}]`).value;
  const seen = new Set();
  const keys = (B.fusion.slotRandom[slot] || []).filter((k) => {
    const t = B.fusion.random[k]?.text;
    return t && !seen.has(t) && seen.add(t);
  }).sort((a, b) => B.fusion.random[b].tier - B.fusion.random[a].tier || B.fusion.random[a].text.localeCompare(B.fusion.random[b].text));
  box.querySelector(`select[data-role=cardaffix][data-side=${side}]`).innerHTML =
    keys.map((k) => `<option value="${esc(k)}">${esc(TIER_NAME[B.fusion.random[k].tier] || "")} · ${esc(B.fusion.random[k].text)}</option>`).join("");
}

function fillPetLevels(side) {
  const box = $("#build-extras");
  const pet = B.lookup.pets.get(Number(box.querySelector(`select[data-role=pet][data-side=${side}]`).value));
  box.querySelector(`select[data-role=pet-lv][data-side=${side}]`).innerHTML = (pet?.levels || []).filter((l) => l.fx.length)
    .map((l, i, a) => `<option value="${l.lv}" ${i === a.length - 1 ? "selected" : ""}>Bond ${l.lv} · ${esc(l.title)}</option>`).join("");
}

function extraLabel(x) {
  if (x.kind === "pet") {
    const p = B.lookup.pets.get(x.id);
    const l = p.levels.find((v) => v.lv === x.lv) ?? p.levels.at(-1);
    return `${p.img ? `<img class="line-icon" src="img/${esc(p.img)}" alt="">` : ""}<span class="tag">Pet</span> <b>${esc(p.n)}</b> Bond ${l.lv} · ${esc(l.desc)}`;
  }
  if (x.kind === "cardaffix") {
    const o = B.lookup.cardaffix.get(x.id);
    return `<span class="tag">Card affix</span> <span class="tier-${(TIER_NAME[o.tier] || "").toLowerCase()}">${esc(o.text)}</span>`;
  }
  if (x.kind === "affix") {
    const a = B.lookup.affix.get(x.id);
    return `${a.img ? `<img class="line-icon" src="img/${esc(a.img)}" alt="">` : ""}<span class="tag">Affix</span> <span class="q${a.q}">${esc(a.name)} L${a.lv}</span> ${esc(a.text)}`;
  }
  if (x.kind === "apoc") {
    const a = B.lookup.apoc.get(x.id);
    return `<span class="tag">Apocalypse</span> <span class="q${a.q}">${esc(QUALITY[a.q] || a.q)}</span> ${esc(a.text)}`;
  }
  const num = (n) => Number(n).toLocaleString("en-MY", { maximumFractionDigits: 2 });
  const v = PCT_KEYS.test(x.key) ? `${num(x.value * 100)}%` : num(x.value);
  return `<span class="tag">${esc(x.label || "Other")}</span> ${esc(statLabel(x.key))} ${x.value > 0 ? "+" : ""}${v}`;
}

function renderExtras() {
  const col = (side) => {
    const list = B[side].extras || [];
    return `<div class="extra-col">
      <div class="extra-head">${side === "now" ? "Now" : "Plan"}</div>
      ${list.length ? list.map((x, i) => `<div class="extra-line"><span>${extraLabel(x)}</span><button type="button" data-act="del" data-side="${side}" data-i="${i}" title="Remove">✕</button></div>`).join("")
        : `<div class="note">Nothing added.</div>`}
      <div class="extra-add">
        <select data-role="part" data-side="${side}" aria-label="Apocalypse part">${APOC_PARTS.map((p) => `<option>${p}</option>`).join("")}</select>
        <select data-role="apoc" data-side="${side}" aria-label="Apocalypse trait"></select>
        <button type="button" data-act="add-apoc" data-side="${side}">+ Apocalypse</button>
      </div>
      <div class="extra-add">
        <select data-role="cardaffix-slot" data-side="${side}" aria-label="Card slot">${Object.keys(B.fusion.slotRandom).sort().map((p) => `<option>${esc(p)}</option>`).join("")}</select>
        <select data-role="cardaffix" data-side="${side}" class="cardaffix-pick" aria-label="Card affix"></select>
        <button type="button" data-act="add-cardaffix" data-side="${side}">+ Card affix</button>
      </div>
      <div class="extra-add">
        <select data-role="affix-part" data-side="${side}" aria-label="Affix part">${AFFIX_PARTS.map((p) => `<option>${p}</option>`).join("")}</select>
        <input data-role="affix" data-side="${side}" class="affix-search" aria-label="Affix">
        <button type="button" data-act="add-affix" data-side="${side}">+ Affix</button>
      </div>
      <div class="extra-add">
        <select data-role="pet" data-side="${side}" aria-label="Pet">${[...B.lookup.pets.values()].sort((a, b) => a.n.localeCompare(b.n)).map((p) => `<option value="${p.id}">${esc(p.n)}${p.q ? ` · ${esc(p.q)}` : ""}</option>`).join("")}</select>
        <select data-role="pet-lv" data-side="${side}" aria-label="Bond level"></select>
        <button type="button" data-act="add-pet" data-side="${side}">+ Pet</button>
      </div>
      <div class="extra-add">
        <input data-role="label" data-side="${side}" placeholder="Title / Relic…" aria-label="Where the bonus comes from">
        <select data-role="stat" data-side="${side}" aria-label="Stat">${EXTRA_STATS.map((k) => `<option value="${k}">${esc(statLabel(k))}</option>`).join("")}</select>
        <input data-role="val" data-side="${side}" type="number" step="any" placeholder="value" aria-label="Value (type 5 for 5%)">
        <button type="button" data-act="add-stat" data-side="${side}">+ Add</button>
      </div>
    </div>`;
  };
  $("#build-extras").innerHTML = `<div class="extra-grid">${col("now")}${col("plan")}</div>`;
  fillApocSelect("now");
  fillApocSelect("plan");
  fillAffixList("now");
  fillAffixList("plan");
  fillCardAffixSelect("now");
  fillCardAffixSelect("plan");
  fillPetLevels("now");
  fillPetLevels("plan");
}

// ---------------------------------------------------------------- card fusion
const FZ = { data: null, main: { card: null, affixes: [] }, mat: { card: null, affixes: [] }, lock: "", target: "" };
const FUSION_KEY = "ro-sim:fusion:v1";
const TIER = { 2: "green", 3: "blue", 4: "purple" };

function setupFusion(data) {
  FZ.data = data;
  FZ.byId = new Map(data.cards.map((c) => [c.id, c]));
  const f = $("#fusion-form");
  [...new Set(data.cards.filter((c) => !c.mvp).map((c) => c.slot))].sort().forEach((s) => f.slot.add(new Option(s, s)));
  try {
    const saved = freshSave(FUSION_KEY);
    if (saved) {
      if ([...f.slot.options].some((o) => o.value === saved.slot)) f.slot.value = saved.slot;
      f.pieces.value = saved.pieces ?? "";
      for (const side of ["main", "mat"]) {
        const c = FZ.byId.get(saved[side]?.card);
        if (c && !c.mvp && c.slot === f.slot.value) FZ[side] = { card: c.id, affixes: (saved[side].affixes || []).map((k) => (data.random[k] || data.fixed[k] ? k : null)) };
      }
      FZ.lock = saved.lock || ""; FZ.target = saved.target || "";
    }
  } catch { /* ignore a broken save */ }
  f.slot.addEventListener("change", () => { FZ.main = { card: null, affixes: [] }; FZ.mat = { card: null, affixes: [] }; FZ.lock = FZ.target = ""; renderFusion(); });
  f.pieces.addEventListener("input", renderFusion);
  for (const side of ["main", "mat"]) {
    $(`#fusion-${side}`).addEventListener("change", (e) => {
      const el = e.target;
      if (el.dataset.role === "card") { FZ[side] = { card: el.value ? Number(el.value) : null, affixes: [] }; FZ.lock = ""; }
      if (el.dataset.role === "affix") FZ[side].affixes[Number(el.dataset.i)] = el.value || null;
      renderFusion();
    });
  }
  $("#fusion-lock").addEventListener("change", (e) => { FZ.lock = e.target.value; renderFusion(); });
  $("#fusion-target").addEventListener("change", (e) => { FZ.target = e.target.value; renderFusion(); });
  renderFusion();
}

function fusionCardPanel(side, slot) {
  const d = FZ.data;
  const main = FZ.byId.get(FZ.main.card);
  const pool = d.cards.filter((c) => c.slot === slot && !c.mvp &&
    (side === "main" || !main || c.q === main.q || c.q === main.q - 1))
    .sort((a, b) => b.q - a.q || a.name.localeCompare(b.name));
  const card = FZ.byId.get(FZ[side].card);
  const fixed = card ? fusionOption(d, card.fixed) : null;
  const affixSel = (i) => {
    const keys = card ? (d.libs[String(card.lib)] || []) : [];
    const seen = new Set();
    const opts = keys.filter((k) => !seen.has(d.random[k]?.text) && seen.add(d.random[k]?.text));
    const fixedOpts = card ? (d.slotFixed[card.slot] || []).filter((k) => k !== card.fixed && d.fixed[k]) : [];
    const sel = (k) => (FZ[side].affixes[i] === k ? "selected" : "");
    return `<label class="fz-pos"><span>Affix ${i + 1}</span><select data-role="affix" data-i="${i}" ${card ? "" : "disabled"}>
      <option value="">— none —</option>
      <optgroup label="Random affixes">${opts.map((k) => `<option value="${esc(k)}" ${sel(k)}>${esc(d.random[k].text)}</option>`).join("")}</optgroup>
      <optgroup label="Another card's fixed effect (from an earlier fusion)">${fixedOpts.map((k) => `<option value="${esc(k)}" ${sel(k)}>${esc(display1(d.fixed[k]))}</option>`).join("")}</optgroup>
    </select></label>`;
  };
  return `<div class="fz-head">${side === "main" ? "Main card · keeps its quality" : "Material · used up"}</div>
    <div class="fz-top">${card?.img ? `<img class="fz-art q${card.q}-edge" src="img/${esc(card.img)}" alt="">` : `<span class="fz-art empty"></span>`}
      <select data-role="card" aria-label="${side} card"><option value="">— pick a card —</option>
        ${pool.map((c) => `<option value="${c.id}" ${c.id === FZ[side].card ? "selected" : ""}>${esc(c.name)} · ${esc(QUALITY[c.q] || c.q)}</option>`).join("")}</select></div>
    <div class="fz-pos"><span>Fixed</span><div class="fz-fixed">${fixed ? fixed.lines["1"].map(esc).join("<br>") : "—"}${card?.immune ? ' <span class="tag">no decay</span>' : ""}</div></div>
    ${card ? Array.from({ length: Math.min(2, card.affixes) }, (_, i) => affixSel(i)).join("") : ""}`;
}

function renderFusion() {
  if (!FZ.data) return;
  const d = FZ.data;
  const f = $("#fusion-form");
  const slot = f.slot.value;
  $("#fusion-main").innerHTML = fusionCardPanel("main", slot);
  // drop a material that no longer fits the main card's quality
  const main = FZ.byId.get(FZ.main.card);
  const matC = FZ.byId.get(FZ.mat.card);
  if (main && matC && !(matC.q === main.q || matC.q === main.q - 1)) FZ.mat = { card: null, affixes: [] };
  $("#fusion-mat").innerHTML = fusionCardPanel("mat", slot);
  const mat = FZ.byId.get(FZ.mat.card);

  const mainSlots = main ? slotsOf(main, FZ.main.affixes) : [];
  const matSlots = mat ? slotsOf(mat, FZ.mat.affixes) : [];
  const n = mainSlots.length;
  const posName = (i) => (i === 0 ? "fixed effect" : `affix ${i}`);

  // lock options: only when both cards are the same quality
  const canLock = main && mat && main.q === mat.q;
  const lockOpts = [`<option value="">No lock</option>`];
  if (canLock) for (const side of ["main", "mat"]) {
    const sl = side === "main" ? mainSlots : matSlots;
    sl.forEach((k, i) => { if (k && i < n) lockOpts.push(`<option value="${side}:${i}">${side === "main" ? "Main" : "Material"} ${posName(i)}: ${esc(display1(fusionOption(d, k)))}</option>`); });
  }
  if (FZ.lock) {
    const [ls, lp] = FZ.lock.split(":");
    if (Number(lp) >= n || !(ls === "main" ? mainSlots : matSlots)[Number(lp)]) FZ.lock = "";
  }
  if (!canLock) FZ.lock = "";
  $("#fusion-lock").innerHTML = lockOpts.join("");
  $("#fusion-lock").value = FZ.lock;
  $("#fusion-lock").disabled = !canLock;
  $("#fusion-lock").title = canLock ? "" : "Locking needs both cards at the same quality";
  const lock = FZ.lock ? { side: FZ.lock.split(":")[0], pos: Number(FZ.lock.split(":")[1]) } : null;

  const seenText = new Set();
  const targets = [...mainSlots, ...matSlots].filter(Boolean).filter((k) => {
    const t = display1(fusionOption(d, k));
    return !seenText.has(t) && seenText.add(t);
  });
  if (!targets.includes(FZ.target)) FZ.target = targets.find((k) => !k.startsWith("fixed:")) || targets[0] || "";
  $("#fusion-target").innerHTML = targets.map((k) => `<option value="${esc(k)}">${esc(display1(fusionOption(d, k)))}</option>`).join("") || `<option value="">—</option>`;
  $("#fusion-target").value = FZ.target;

  const errs = problems(main, mat, lock);
  $("#fusion-problems").innerHTML = errs.length ? `<div class="fz-warn">${errs.map(esc).join("<br>")}</div>` : "";
  localStorage.setItem(FUSION_KEY, JSON.stringify({ savedAt: Date.now(), slot, pieces: f.pieces.value, main: FZ.main, mat: FZ.mat, lock: FZ.lock, target: FZ.target }));
  if (errs.length) {
    $("#fusion-kpis").innerHTML = $("#fusion-positions").innerHTML = $("#fusion-outcomes").innerHTML = "";
    return;
  }

  const outs = outcomes(d, mainSlots, matSlots, lock);
  const p = FZ.target ? targetChance(d, outs, FZ.target) : 0;
  const pieces = Number(f.pieces.value);
  const perTry = pieces > 0 ? pieces * 2 * state.rmPerStar : null;
  $("#fusion-kpis").innerHTML = `
    <div class="kpi ${p >= 0.5 ? "good" : p >= 0.2 ? "warn" : "bad"}"><div class="label">Chance per fusion</div><div class="value">${fmt(p * 100, 1)}%</div><div class="sub">${esc(display1(fusionOption(d, FZ.target)))}</div></div>
    <div class="kpi"><div class="label">Fusions needed on average</div><div class="value">${p > 0 ? fmt(1 / p, 1) : "—"}</div><div class="sub">with the same kind of material each time</div></div>
    <div class="kpi"><div class="label">Cost per fusion</div><div class="value">${perTry == null ? "—" : rm(perTry)}</div><div class="sub">${perTry == null ? "type the Spirit Pieces from the game" : `${fmt(pieces)} Spirit Pieces × 2 Starstones`}</div></div>
    <div class="kpi warn"><div class="label">Average cost to get it</div><div class="value">${perTry == null || !(p > 0) ? "—" : rm(perTry / p)}</div><div class="sub">Spirit Pieces only, not the material cards</div></div>`;

  $("#fusion-positions").innerHTML = `<table class="mid"><thead><tr><th>Position</th><th>Main card</th><th>Material</th><th class="num">Main wins</th><th class="num">Material wins</th></tr></thead><tbody>
    ${Array.from({ length: n }, (_, i) => {
      const a = mainSlots[i], b = matSlots[i];
      const pm = mainChance(d, a, b, i, lock);
      const cell = (k) => k ? `<span class="${tierClass(d, k)}">${esc(display1(fusionOption(d, k)))}</span>` : "—";
      return `<tr><td>${esc(posName(i))}${lock?.pos === i ? ' <span class="tag">locked</span>' : ""}</td><td>${cell(a)}</td><td>${cell(b)}</td>
        <td class="num">${pm == null ? "—" : fmt(pm * 100, 1) + "%"}</td><td class="num">${pm == null ? "—" : fmt((1 - pm) * 100, 1) + "%"}</td></tr>`;
    }).join("")}</tbody></table>`;

  $("#fusion-outcomes").innerHTML = `<table class="mid"><thead><tr><th class="num">Chance</th><th>Fused card</th><th></th></tr></thead><tbody>
    ${outs.map((o) => `<tr class="${hasEffect(d, o.keys, FZ.target) ? "hit" : ""}"><td class="num"><b>${fmt(o.p * 100, 1)}%</b></td>
      <td class="lines">${resultLines(d, o.keys).map((lines) => `<div>${lines.map(esc).join("<br>")}</div>`).join("")}</td>
      <td>${hasEffect(d, o.keys, FZ.target) ? '<span class="pill up">has it</span>' : ""}</td></tr>`).join("")}</tbody></table>`;
}
function display1(o) { return o ? (o.text ?? (o.lines?.["1"] || []).join(" · ")) : ""; }
function tierClass(d, k) { const t = d.random[k]?.tier; return t ? `tier-${TIER[t]}` : ""; }

// ---- runes (crystals): 5 per side, picked like the game's rune screen
const RUNE_ELS = ["Gale", "Geo", "Aqua", "Pyro", "Lumina"];
const emptyRune = () => ({ el: null, lv: 1, celestial: false, group: null, count: false, colors: [null, null], stats: [null, null, null] });
let runePicker = null; // "side:i" whose effect grid is open
function sideRunes(side) {
  if (!Array.isArray(B[side].runes) || B[side].runes.length !== 5) B[side].runes = Array.from({ length: 5 }, emptyRune);
  return B[side].runes;
}

function setupRunes() {
  const box = $("#build-runes");
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rf]");
    if (!b || b.disabled || b.tagName === "SELECT") return;
    const { side, i, rf, v } = b.dataset;
    const r = sideRunes(side)[Number(i)];
    const key = `${side}:${i}`;
    if (rf === "el") { if (!r.el) Object.assign(r, emptyRune()); r.el = v; }
    else if (rf === "clear") { Object.assign(r, emptyRune()); if (runePicker === key) runePicker = null; }
    else if (rf === "lv") r.lv = Number(v);
    else if (rf === "celestial") r.celestial = !r.celestial;
    else if (rf === "count") r.count = !r.count;
    else if (rf === "pick") runePicker = runePicker === key ? null : key;
    else if (rf === "group") {
      r.group = Number(v);
      r.count = Boolean(B.runes.groups.find((g) => g.id === r.group)?.countDefault);
      runePicker = null;
    } else if (rf === "c0" || rf === "c1") { const k = Number(rf.slice(1)); r.colors[k] = r.colors[k] === v ? null : v; }
    else return;
    renderRunes();
    renderBuildResults();
  });
  box.addEventListener("change", (e) => {
    const el = e.target;
    const { side, i, rf } = el.dataset;
    if (!side || !rf?.startsWith("s")) return;
    sideRunes(side)[Number(i)].stats[Number(rf.slice(1))] = el.value ? Number(el.value) : null;
    renderRunes();
    renderBuildResults();
  });
}

function renderRunes() {
  const R = B.runes;
  const d = (side, i) => `data-side="${side}" data-i="${i}"`;
  const gems = (side, i, rf, current, small) => `<div class="gems ${small ? "small" : ""}">${RUNE_ELS.map((e) =>
    `<button type="button" class="gem el-${e.toLowerCase()} ${current === e ? "on" : ""}" ${d(side, i)} data-rf="${rf}" data-v="${e}" title="${e}" aria-label="${e}"></button>`).join("")}</div>`;
  const card = (side, r, i, used) => {
    const key = `${side}:${i}`;
    const grp = R.groups.find((g) => g.id === r.group);
    const lvl = runeLevel(r);
    const lib = R.levelLib[String(r.lv || 1)];
    const icon = grp && r.el ? grp.icons?.[r.el] : null;
    const statSel = (k) => `<select ${d(side, i)} data-rf="s${k}" aria-label="Rune stat ${k + 1}"><option value="">+ stat</option>` +
      R.stats.map((x) => {
        const [lo, hi] = x.ranges[lib] || [0, 0];
        const show = (n) => (x.pct ? `${fmt(n * 100, 1)}%` : fmt(n));
        const taken = r.stats.some((s2, k2) => k2 !== k && s2 === x.attr);
        return `<option value="${x.attr}" ${r.stats[k] === x.attr ? "selected" : ""} ${taken ? "disabled" : ""}>${esc(x.name)} ${show(lo)}~${show(hi)}</option>`;
      }).join("") + `</select>`;
    if (!r.el) {
      return `<div class="rune empty"><div class="rune-art"><span class="gem big"></span></div>
        <div class="rune-body"><div class="rune-title">Rune ${i + 1}</div><div class="note">Pick a crystal</div>${gems(side, i, "el", null)}</div></div>`;
    }
    return `<div class="rune el-${r.el.toLowerCase()}">
      <button type="button" class="rune-art" ${d(side, i)} data-rf="pick" title="Choose the main effect">
        ${icon ? `<img src="img/${esc(icon)}" alt="">` : `<span class="gem big el-${r.el.toLowerCase()}"></span>`}
        <span class="lv-badge">Lv${lvl}</span>
      </button>
      <div class="rune-body">
        <div class="rune-row">
          ${gems(side, i, "el", r.el)}
          <div class="seg">${[1, 2, 3, 4].map((l) => `<button type="button" class="${r.lv === l ? "on" : ""}" ${d(side, i)} data-rf="lv" data-v="${l}">Lv${l}</button>`).join("")}</div>
          <button type="button" class="star ${r.celestial ? "on" : ""}" ${d(side, i)} data-rf="celestial" title="Celestial: main effect +1 level">★</button>
          <button type="button" class="rune-x" ${d(side, i)} data-rf="clear" title="Remove rune">✕</button>
        </div>
        <button type="button" class="effect-btn" ${d(side, i)} data-rf="pick">${grp ? `<b>${esc(grp.name)}</b>${grp.mult ? ' <span class="tag">dmg</span>' : ""}` : "Choose main effect ▾"}</button>
        ${grp ? `<div class="rune-desc">Lv${lvl}: ${esc(grp.levels[lvl - 1])}</div>` : ""}
        ${grp?.mult ? `<button type="button" class="count-btn ${r.count ? "on" : ""}" ${d(side, i)} data-rf="count">${r.count ? "✓ Counted in damage" : "Not counted · click if it fits your fight"}</button>` : ""}
        <div class="rune-row"><span class="mini">Colours</span>${gems(side, i, "c0", r.colors[0], true)}<span class="mini">·</span>${gems(side, i, "c1", r.colors[1], true)}</div>
        <div class="rune-stats">${[0, 1, 2].map(statSel).join("")}</div>
      </div>
      ${runePicker === key ? `<div class="effect-grid">${R.groups.map((g) => {
        const usedElsewhere = used.has(g.id) && r.group !== g.id;
        return `<button type="button" class="effect-tile ${r.group === g.id ? "on" : ""}" ${d(side, i)} data-rf="group" data-v="${g.id}" ${usedElsewhere ? "disabled" : ""}
          title="${esc(g.levels[lvl - 1])}${usedElsewhere ? " (already on another rune)" : ""}">
          <img src="img/${esc(g.icons?.[r.el] || "")}" alt="" loading="lazy"><span>${esc(g.name)}</span>${g.mult ? "<i>dmg</i>" : ""}</button>`;
      }).join("")}</div>` : ""}
    </div>`;
  };
  const col = (side) => {
    const runes = sideRunes(side);
    const used = new Set(runes.map((r) => r.group).filter(Boolean));
    const { count, tiers } = resonance(runes);
    // every element: colours so far (out of 7), the bonus you have, and the next one
    const order = [...RUNE_ELS].sort((x, y) => (count[y] || 0) - (count[x] || 0));
    const rows = order.map((e) => {
      const n = count[e] || 0, tier = tiers[e] || 0;
      const next = [2, 4, 7].find((t) => t > n);
      const cur = tier ? R.elements[e]?.[String(tier)]?.lines : null;
      const nxt = next ? R.elements[e]?.[String(next)]?.lines : null;
      const dots = Array.from({ length: 7 }, (_, k) => `<i class="${k < n ? "on" : ""} ${[1, 3, 6].includes(k) ? "mark" : ""}"></i>`).join("");
      return `<div class="res-el el-${e.toLowerCase()} ${tier ? "active" : ""}">
        <div class="res-top"><span class="gem tiny el-${e.toLowerCase()}"></span><b>${e}</b><span class="res-dots">${dots}</span><span class="mini">${n}/7</span></div>
        ${cur ? `<div class="res-now">✓ ${esc(cur.join(" · "))}</div>` : ""}
        ${nxt ? `<div class="res-next">${n ? `+${next - n} more ${e} colour${next - n > 1 ? "s" : ""}` : `${next} ${e} colours`} → ${esc(nxt.join(" · "))}</div>` : `<div class="res-next">Max tier reached</div>`}
      </div>`;
    }).join("");
    return `<div class="extra-col"><div class="extra-head">${side === "now" ? "Now" : "Plan"}</div>
      <details class="res-box" ${Object.keys(count).length ? "open" : ""}><summary>Resonance: colour bonuses (2 / 4 / 7 of one element)</summary>${rows}</details>
      <div class="rune-grid">${runes.map((r, i) => card(side, r, i, used)).join("")}</div></div>`;
  };
  $("#build-runes").innerHTML = `<div class="extra-grid">${col("now")}${col("plan")}</div>`;
}

// ---- your character now: numbers from the character screen, or base ATK for gear-only mode
function panelKeys(ctx) {
  const magic = ctx.type.startsWith("magic");
  return [
    magic ? "matk" : "atk",
    magic ? "mdmg" : "pdmg",
    ...(ctx.type === "melee" ? ["melee"] : ctx.type === "ranged" ? ["ranged"] : ctx.type === "magic-ranged" ? ["rmagic"] : []),
    ...(magic ? [] : ["critdmg"]),
    `race:${ctx.race}`, `size:${ctx.size}`, `elem:${ctx.skillElement}`, `vselem:${ctx.targetElement}`,
  ];
}
function setupPanel() {
  $("#mode-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    B.mode = b.dataset.mode;
    renderPanel();
    renderBuildResults();
  });
  $("#panel-fields").addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.base) { B.base[el.dataset.base] = el.value === "" ? 0 : Number(el.value); renderBuildResults(); return; }
    const k = el.dataset.k;
    if (!k) return;
    if (el.value.trim() === "") delete B.panel[k];
    else B.panel[k] = PCT_KEYS.test(k) ? Number(el.value) / 100 : Number(el.value);
    renderBuildResults();
  });
}
function renderPanel() {
  for (const b of $("#mode-seg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === B.mode);
  const ctx = buildCtx();
  if (B.mode === "gear") {
    $("#panel-fields").innerHTML = `
      <label>ATK without gear <input type="number" min="0" data-base="atk" value="${Number(B.base.atk) || 0}"></label>
      <label>M.ATK without gear <input type="number" min="0" data-base="matk" value="${Number(B.base.matk) || 0}"></label>`;
    $("#panel-hint").textContent = "Fill in every slot you wear below. \"Without gear\" = the ATK on your character screen minus what your gear, cards and runes give.";
    return;
  }
  $("#panel-fields").innerHTML = panelKeys(ctx).map((k) => {
    const v = B.panel[k];
    const shown = v == null ? "" : PCT_KEYS.test(k) ? +(v * 100).toFixed(2) : v;
    return `<label>${esc(statLabel(k))} <input type="number" step="any" data-k="${esc(k)}" value="${shown}" placeholder="${PCT_KEYS.test(k) ? "%" : ""}"></label>`;
  }).join("");
  $("#panel-hint").textContent = "Type what your character screen shows (leave a box empty if you can't find it). Then fill in only the slots you want to change: Now = what is in that slot today, Plan = what you would put in. Empty slots, runes and extras on both sides change nothing.";
}
const jobChain = (jobId) => chainOf(B.buffData.jobs, jobId);
function skillLine(sk, lv) {
  const level = sk.levels[Math.min(sk.levels.length, lv) - 1];
  const counted = level.fx.map(([k, v]) => `${statLabel(k)} +${PCT_KEYS.test(k) ? `${+(v * 100).toFixed(2)}%` : +v.toFixed(2)}`).join(", ");
  return { level, counted };
}
function renderBuffs() {
  const D = B.buffData;
  const formJob = $("#build-form").job.value;
  const pickJob = renderBuffs.job ?? (formJob || "");
  const chain = jobChain(pickJob);
  const counts = (x) => x.levels.some((l) => l.fx.length);
  const order = (a, b) => counts(b) - counts(a) || a.name.localeCompare(b.name);
  const own = D.skills.filter((x) => chain.includes(x.job)).sort(order);
  const seenName = new Set(own.map((x) => x.name));
  const party = D.skills.filter((x) => x.party && !chain.includes(x.job)).sort(order)
    .filter((x) => !seenName.has(x.name) && seenName.add(x.name)); // same buff from two jobs: show once
  if (![...own, ...party].some((x) => x.id === renderBuffs.pick)) renderBuffs.pick = (own[0] || party[0])?.id;
  const tile = (x) => `<button type="button" class="skill-tile ${x.id === renderBuffs.pick ? "on" : ""} ${B.skillBuffs.some((p) => p.id === x.id) ? "added" : ""}" data-skill="${x.id}"
      title="${esc(x.name)} (${esc(D.jobs[x.job]?.name || x.job)}): ${esc(x.levels[0].desc.slice(0, 140))}">
      ${x.img ? `<img src="img/${esc(x.img)}" alt="" loading="lazy">` : ""}<span>${esc(x.name)}</span>${counts(x) ? "" : "<i>text</i>"}</button>`;
  const jobsWithBuffs = [...new Set([...D.skills.map((x) => x.job), ...(pickJob && D.jobs[pickJob] ? [String(pickJob)] : [])])]
    .sort((a, b) => (D.jobs[a]?.name || "").localeCompare(D.jobs[b]?.name || ""));
  const chainNames = chain.map((j) => D.jobs[j]?.name).filter(Boolean).join(", ");
  const lines = B.skillBuffs.map((p, i) => {
    const sk = D.skills.find((x) => x.id === p.id);
    if (!sk) return "";
    const { level, counted } = skillLine(sk, p.lv);
    return `<div class="extra-line"><span>${sk.img ? `<img class="line-icon" src="img/${esc(sk.img)}" alt="">` : ""}<b>${esc(sk.name)}</b>
        <select data-skill-lv="${i}" aria-label="Level">${sk.levels.map((_, k) => `<option value="${k + 1}" ${p.lv === k + 1 ? "selected" : ""}>Lv${k + 1}</option>`).join("")}</select>
        ${counted ? `<span class="pill up">${esc(counted)}</span>` : `<span class="note">${esc(level.desc.slice(0, 120))}</span>`}</span>
      <button type="button" data-skill-del="${i}" title="Remove">✕</button></div>`;
  }).join("");
  const typed = B.buffs.map((x, i) => `<div class="extra-line"><span><span class="tag">${esc(x.label || "Buff")}</span> ${esc(statLabel(x.key))} ${x.value > 0 ? "+" : ""}${PCT_KEYS.test(x.key) ? `${+(x.value * 100).toFixed(2)}%` : +x.value.toFixed(2)}</span>
      <button type="button" data-buff-del="${i}" title="Remove">✕</button></div>`).join("");
  $("#buff-box").innerHTML = `${lines}${typed}${!lines && !typed ? '<div class="note">No buffs yet.</div>' : ""}
    <div class="extra-add">
      <select id="skill-job" aria-label="Job">${`<option value="">Any job</option>` + jobsWithBuffs.map((j) => `<option value="${j}" ${j === pickJob ? "selected" : ""}>${esc(D.jobs[j]?.name || j)}</option>`).join("")}</select>
    </div>
    ${own.length ? `<div class="skill-sec">${esc(chain.map((j) => D.jobs[j]?.name).join(" · "))}</div><div class="skill-grid">${own.map(tile).join("")}</div>`
      : pickJob ? `<div class="note no-buffs">${esc(chainNames)}: no buff skills in the game data yet${D.jobs[pickJob] && !D.skills.some((x) => x.job === String(pickJob)) ? " (this job's skills are not out in SEA yet)" : ""}. Party buffs from other jobs are below.</div>` : ""}
    <div class="skill-sec">Party buffs from other jobs</div><div class="skill-grid">${party.map(tile).join("")}</div>
    <div class="extra-add skill-pickrow"><span id="skill-chosen"></span><select id="skill-lv" aria-label="Level"></select><button type="button" id="skill-add">+ Add skill</button></div>
    <div class="note" id="skill-preview"></div>
    <div class="extra-add">
      <input id="buff-label" placeholder="Other buff (food, item…)" aria-label="Buff name">
      <select id="buff-stat" aria-label="Stat">${EXTRA_STATS.map((k) => `<option value="${k}">${esc(statLabel(k))}</option>`).join("")}</select>
      <input id="buff-val" type="number" step="any" placeholder="value" aria-label="Value (5 for 5%)">
      <button type="button" id="buff-add">+ Add</button>
    </div>`;
  fillSkillLevels();
}
function fillSkillLevels() {
  const sk = B.buffData.skills.find((x) => x.id === renderBuffs.pick);
  if ($("#skill-chosen")) $("#skill-chosen").innerHTML = sk ? `${sk.img ? `<img class="line-icon" src="img/${esc(sk.img)}" alt="">` : ""}<b>${esc(sk.name)}</b>` : "";
  const lvSel = $("#skill-lv");
  if (!sk || !lvSel) { if (lvSel) lvSel.innerHTML = ""; $("#skill-preview").textContent = ""; return; }
  const cur = Number(lvSel.value) || defaultLevel(sk);
  lvSel.innerHTML = sk.levels.map((_, k) => `<option value="${k + 1}" ${k + 1 === Math.min(cur, sk.levels.length) ? "selected" : ""}>Lv${k + 1}</option>`).join("");
  const { level, counted } = skillLine(sk, Number(lvSel.value));
  $("#skill-preview").innerHTML = `${esc(level.desc)}${counted ? ` <span class="pill up">counts: ${esc(counted)}</span>` : ' <span class="pill flat">not counted (not a plain stat)</span>'}`;
}
document.addEventListener("change", (e) => {
  if (e.target.id === "skill-job") { renderBuffs.job = e.target.value; renderBuffs(); }
  if (e.target.id === "skill-lv") fillSkillLevels();
  if (e.target.dataset?.skillLv != null) { B.skillBuffs[Number(e.target.dataset.skillLv)].lv = Number(e.target.value); renderBuffs(); renderBuildResults(); }
});
document.addEventListener("click", (e) => {
  const st = e.target.closest("[data-skill]");
  if (st) { renderBuffs.pick = Number(st.dataset.skill); renderBuffs(); return; }
  if (e.target.id === "skill-add") {
    const id = renderBuffs.pick, lv = Number($("#skill-lv").value) || 1;
    if (B.buffData.skills.some((x) => x.id === id) && !B.skillBuffs.some((x) => x.id === id)) B.skillBuffs.push({ id, lv });
    renderBuffs(); renderBuildResults(); return;
  }
  const sdel = e.target.closest("[data-skill-del]");
  if (sdel) { B.skillBuffs.splice(Number(sdel.dataset.skillDel), 1); renderBuffs(); renderBuildResults(); }
});
document.addEventListener("click", (e) => {
  const del = e.target.closest("[data-buff-del]");
  if (del) { B.buffs.splice(Number(del.dataset.buffDel), 1); renderBuffs(); renderBuildResults(); return; }
  if (e.target.id === "buff-add") {
    const key = $("#buff-stat").value, raw = Number($("#buff-val").value);
    if (!key || !Number.isFinite(raw) || raw === 0) return;
    B.buffs.push({ key, value: PCT_KEYS.test(key) ? raw / 100 : raw, label: $("#buff-label").value.trim().slice(0, 40) });
    renderBuffs();
    renderBuildResults();
  }
});

// ---- target monster and attack skill: pick them instead of typing numbers
const monLabels = new Map(); // datalist label -> monster
function setupMonsters() {
  const typeRank = { MVP: 0, Mini: 1, Boss: 2, Elite: 3, Normal: 4 };
  const list = [...B.monsters].sort((a, b) => typeRank[a.t] - typeRank[b.t] || a.n.localeCompare(b.n) || a.lv - b.lv);
  for (const m of list) {
    let label = `${m.n} · Lv ${m.lv} · ${m.t}`;
    if (monLabels.has(label)) label += ` · ${m.r} ${m.e}`;
    if (!monLabels.has(label)) monLabels.set(label, m);
  }
  $("#monster-list").innerHTML = [...monLabels.keys()].map((l) => `<option value="${esc(l)}"></option>`).join("");
}
function showMonster() {
  const m = monLabels.get($("#build-form").monster.value.trim());
  const im = $("#mon-img");
  im.hidden = !m?.img;
  if (m?.img) { im.src = `img/${m.img}`; im.title = `${m.n}: ${m.r} · ${m.s} · ${m.e}`; }
}
function applyMonster() {
  const f = $("#build-form");
  const el = f.monster;
  const m = monLabels.get(el.value.trim());
  el.classList.toggle("bad", Boolean(el.value.trim()) && !m);
  el.title = el.value.trim() && !m ? "Pick a name from the list" : "";
  if (m) { f.race.value = m.r; f.size.value = m.s; f.targetElement.value = m.e; }
  showMonster();
}

const atkById = () => new Map(B.attacks.map((s) => [String(s.id), s]));
function fillAtkSkills(want, wantLv) {
  const f = $("#build-form");
  const chain = jobChain(f.job.value);
  const D = B.buffData.jobs;
  const list = B.attacks.filter((s) => !chain.length || chain.includes(s.job));
  const byJob = new Map();
  for (const s of list) (byJob.get(s.job) || byJob.set(s.job, []).get(s.job)).push(s);
  const jobs = [...byJob.keys()].sort((a, b) => (chain.length ? chain.indexOf(b) - chain.indexOf(a) : (D[a]?.name || "").localeCompare(D[b]?.name || "")));
  const cur = want ?? f.atkSkill.value;
  f.atkSkill.innerHTML = `<option value="">Type my own skill %</option>` + jobs.map((j) => `<optgroup label="${esc(D[j]?.name || j)}">${byJob.get(j)
    .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.ult ? " (Ultimate)" : ""}</option>`).join("")}</optgroup>`).join("");
  f.atkSkill.value = list.some((s) => String(s.id) === String(cur)) ? String(cur) : "";
  fillAtkLevels(wantLv);
  atkNote();
}
function fillAtkLevels(wantLv) {
  const f = $("#build-form");
  const sk = atkById().get(f.atkSkill.value);
  f.atkLv.disabled = !sk;
  if (!sk) { f.atkLv.innerHTML = ""; return; }
  const lv = Math.max(1, Math.min(sk.levels.length, Number(wantLv) || defaultLevel(sk)));
  f.atkLv.innerHTML = sk.levels.map((_, k) => `<option value="${k + 1}" ${k + 1 === lv ? "selected" : ""}>${k + 1}</option>`).join("");
}
function atkLevel() {
  const f = $("#build-form");
  const sk = atkById().get(f.atkSkill.value);
  if (!sk) return null;
  const lv = Math.max(1, Math.min(sk.levels.length, Number(f.atkLv.value) || 1));
  return { sk, lv, L: sk.levels[lv - 1] };
}
function applyAtkSkill() {
  const f = $("#build-form");
  const a = atkLevel();
  if (a) {
    f.skill.value = a.L.pct;
    f.skillFlat.value = a.L.flat;
    f.hits.value = a.L.hits;
    if (a.L.el) f.skillElement.value = a.L.el;
    if (a.L.kind) f.type.value = a.L.kind;
  }
  atkNote();
}
function atkNote() {
  const f = $("#build-form");
  const a = atkLevel();
  if (!a) { $("#atk-note").textContent = "Pick your attack skill to fill Skill %, flat, hits and element from the game data, or type them yourself."; return; }
  const desc = descOf(a.sk, a.lv);
  const same = Number(f.skill.value) === a.L.pct && Number(f.skillFlat.value) === a.L.flat && Number(f.hits.value) === a.L.hits;
  $("#atk-note").innerHTML = `${a.sk.img ? `<img class="line-icon" src="img/${esc(a.sk.img)}" alt="">` : ""}<b>${esc(a.sk.name)} Lv${a.lv}</b>: ${esc(desc.length > 260 ? desc.slice(0, 258) + "…" : desc)}${same ? "" : ' <span class="pill flat">numbers changed by hand</span>'}`;
}

// ---- job picker: job icons grouped by family, like choosing a class in game
function setJob(id) {
  const f = $("#build-form");
  f.job.value = id ? String(id) : "";
  $("#job-grid").hidden = true;
  renderJobButton();
  renderBuildTable();
  renderExtras();
  renderBuffs.job = undefined;
  renderBuffs();
  fillAtkSkills();
  renderPanel();
  renderBuildResults();
}
function renderJobButton() {
  const id = $("#build-form").job.value;
  const j = id ? B.buffData.jobs[id] : null;
  $("#job-btn").innerHTML = j
    ? `${j.img ? `<img src="img/${esc(j.img)}" alt="">` : ""}<span>${esc(j.name)}</span><i>▾</i>`
    : `<span class="job-any">?</span><span>Any job</span><i>▾</i>`;
}
function setupJobPicker() {
  $("#job-btn").addEventListener("click", () => {
    const grid = $("#job-grid");
    grid.hidden = !grid.hidden;
    if (!grid.hidden) renderJobGrid();
  });
  $("#job-grid").addEventListener("click", (e) => {
    const t = e.target.closest("[data-job]");
    if (t) setJob(t.dataset.job);
  });
}
function renderJobGrid() {
  const J = B.buffData.jobs;
  const cur = $("#build-form").job.value;
  const tile = (id) => {
    const j = J[id];
    if (!j) return "";
    return `<button type="button" class="job-tile ${String(id) === cur ? "on" : ""} ${j.hasSkills ? "" : "noskills"}" data-job="${id}" title="${esc(j.name)}${j.hasSkills ? "" : " (skills not out in SEA yet)"}">
      ${j.img ? `<img src="img/${esc(j.img)}" alt="" loading="lazy">` : `<span class="job-any">?</span>`}<span>${esc(j.name)}</span></button>`;
  };
  // each family: base job, then every branch as a chain (2nd → transcendent → 3rd)
  const branch = (id) => {
    const out = [id];
    let kids = J[id]?.children || [];
    while (kids.length === 1) { out.push(kids[0]); kids = J[kids[0]]?.children || []; }
    return out;
  };
  const roots = (J["101"]?.children || []).filter((id) => J[id]);
  $("#job-grid").innerHTML = `<div class="job-fam any">${tile("101")}<button type="button" class="job-tile ${cur ? "" : "on"}" data-job=""><span class="job-any">?</span><span>Any job</span></button></div>` +
    roots.map((root) => `<div class="job-fam"><div class="job-base">${tile(root)}</div><div class="job-branches">
      ${(J[root].children || []).map((c) => `<div class="job-chain">${branch(c).map(tile).join('<span class="job-arrow">›</span>')}</div>`).join("")}
    </div></div>`).join("");
}

// ---- read the character screen from a screenshot (OCR runs in the browser)
let ocrWorker = null, ocrLoading = null;
// One worker for the whole page, even if two reads start while it loads.
function ocr() {
  if (ocrWorker) return Promise.resolve(ocrWorker);
  ocrLoading ||= loadOcr().then((w) => (ocrWorker = w)).finally(() => { ocrLoading = null; });
  return ocrLoading;
}
async function loadOcr() {
  if (!window.Tesseract) {
    await new Promise((ok, fail) => {
      const sc = document.createElement("script");
      sc.src = "vendor/tesseract/tesseract.min.js";
      sc.onload = ok; sc.onerror = () => fail(new Error("Could not load the screenshot reader."));
      document.head.append(sc);
    });
  }
  const base = new URL("vendor/tesseract/", location.href).href;
  return window.Tesseract.createWorker("eng", 1, {
    workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang", workerBlobURL: false,
  });
}
// Bigger, grey, dark-on-light: what OCR reads best.
async function prepareImage(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(3, 2200 / Math.max(bmp.width, bmp.height)); // small shots grow, huge photos shrink
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), px = img.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const invert = sum / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (invert) y = 255 - y;
    y = Math.max(0, Math.min(255, (y - 128) * 1.6 + 128));
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Both the Damage tab and the Support tab can read a screenshot. It is the same
// character, so one read fills both: every stat goes to the Damage tab's
// screen numbers, and M.ATK, P.ATK and Healing% also go to the Support tab.
const SHOT = {
  build: { file: "#shot-file", status: "#shot-status", review: "#shot-review", rows: [], seq: 0 },
  support: { file: "#sup-shot-file", status: "#sup-shot-status", review: "#sup-shot-review", rows: [], seq: 0 },
};
const SUP_SHOT_KEYS = ["matk", "atk", "heal"];
async function readShot(blob, where = "build") {
  const S = SHOT[where], status = $(S.status);
  if (!blob || !/^image\//.test(blob.type)) { status.textContent = "That is not an image."; return; }
  if (blob.size > 15 * 1024 * 1024) { status.textContent = "Image is too big (over 15 MB)."; return; }
  const seq = ++S.seq; // a newer screenshot replaces this one
  try {
    status.textContent = ocrWorker ? "Reading the screenshot…" : "Loading the reader (about 7 MB, first time only)…";
    const w = await ocr();
    if (seq !== S.seq) return;
    status.textContent = "Reading the screenshot…";
    const { data } = await w.recognize(await prepareImage(blob));
    if (seq !== S.seq) return;
    S.rows = parseStats(data.text).map((r) => ({ ...r, use: true }));
    if (where === "support") S.rows.sort((a, b) => SUP_SHOT_KEYS.includes(b.key) - SUP_SHOT_KEYS.includes(a.key));
    const mine = S.rows.filter((r) => SUP_SHOT_KEYS.includes(r.key)).length;
    status.textContent = !S.rows.length ? "No stats found. Try a sharper screenshot of just the stats panel, or type them in."
      : where === "support" && !mine ? `Found ${S.rows.length} stats, but not M.ATK, P.ATK or Healing%. Type those in, or apply the rest to the Damage tab.`
        : `Found ${S.rows.length} stats. Check them, fix any wrong number, then apply.`;
    renderShotReview(where, data.text);
  } catch (err) {
    if (seq === S.seq) status.textContent = `Could not read it: ${err?.message || err}`;
  }
}
function renderShotReview(where, rawText) {
  const S = SHOT[where];
  const seen = rawText ? `<details class="note"><summary>What the reader saw</summary><pre>${esc(rawText)}</pre></details>` : "";
  if (!S.rows.length) { $(S.review).innerHTML = seen; return; }
  $(S.review).innerHTML = `<table class="mid shot-table"><thead><tr><th></th><th>Stat</th><th class="num">Value</th><th>From the line</th></tr></thead><tbody>
    ${S.rows.map((r, i) => `<tr class="${where === "support" && SUP_SHOT_KEYS.includes(r.key) ? "hot" : ""}"><td><input type="checkbox" data-shot-use="${i}" ${r.use ? "checked" : ""}></td><td>${esc(statLabel(r.key))}</td>
      <td class="num"><input type="number" step="any" data-shot-val="${i}" value="${PCT_KEYS.test(r.key) ? +(r.value * 100).toFixed(2) : r.value}">${PCT_KEYS.test(r.key) ? "%" : ""}</td>
      <td class="note">${esc(r.raw.slice(0, 60))}</td></tr>`).join("")}</tbody></table>
    <div class="extra-add"><button type="button" data-shot-apply>✓ Use these</button><button type="button" data-shot-cancel>Cancel</button></div>
    ${where === "support" ? `<div class="note">Highlighted stats fill this tab; the others fill the Damage tab's character screen.</div>` : ""}
    ${seen}`;
}
function applyShot(rows) {
  for (const r of rows) B.panel[r.key] = r.value;
  B.mode = "panel";
  const sup = rows.filter((r) => SUP_SHOT_KEYS.includes(r.key));
  for (const r of sup) SUP.me[r.key] = r.value;
  if (sup.length) saveSupport();
  renderPanel();
  renderBuildResults(); // also redraws the Support tab
  renderSupportInputs();
  return sup.length;
}
function setupShot() {
  for (const [where, S] of Object.entries(SHOT)) {
    $(S.file).addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) readShot(f, where); e.target.value = ""; });
    $(S.review).addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.shotUse != null) S.rows[Number(t.dataset.shotUse)].use = t.checked;
      if (t.dataset.shotVal != null) {
        const r = S.rows[Number(t.dataset.shotVal)];
        const v = Number(t.value);
        if (Number.isFinite(v)) r.value = PCT_KEYS.test(r.key) ? v / 100 : v;
      }
    });
    $(S.review).addEventListener("click", (e) => {
      if (e.target.dataset.shotCancel != null) { S.seq++; S.rows = []; $(S.review).innerHTML = ""; $(S.status).textContent = ""; }
      if (e.target.dataset.shotApply != null) {
        const use = S.rows.filter((r) => r.use);
        S.rows = []; $(S.review).innerHTML = "";
        const sup = applyShot(use);
        $(S.status).textContent = where === "support"
          ? `Applied ${sup} stat${sup === 1 ? "" : "s"} here${use.length > sup ? ` and ${use.length - sup} to the Damage tab` : ""}.`
          : `Applied ${use.length} stats to "Your character now"${sup ? ` (M.ATK, P.ATK and Healing% also went to the Support tab)` : ""}.`;
      }
    });
  }
  document.addEventListener("paste", (e) => {
    const where = $("#tab-build").classList.contains("on") ? "build" : $("#tab-support").classList.contains("on") ? "support" : null;
    if (!where) return;
    const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith("image/"));
    if (item) { e.preventDefault(); readShot(item.getAsFile(), where); }
  });
}

// ---- gear sets: progress per side, and "fill a whole shadow set" in one go
const SHADOW_SLOTS = SLOTS.filter((s) => s.shadow);
const FILL = { open: false, set: null, q: null };
function jobOk(i, job) { return job === null || i.jobs === null || i.jobs.includes(job); }
function shadowSets(job) {
  // sets that have a piece for every shadow slot (for this job)
  const out = [];
  for (const [sid, set] of Object.entries(B.gear.sets)) {
    if (/^GM\b/i.test(set.name)) continue; // developer test set
    const pieces = B.gear.items.filter((i) => i.sets.includes(Number(sid)) && i.at >= 21 && jobOk(i, job));
    if (!pieces.length || !SHADOW_SLOTS.every((sl) => pieces.some((i) => i.at === sl.at))) continue;
    const qs = [...new Set(pieces.map((i) => i.q))].sort((a, b) => b - a);
    out.push({ id: Number(sid), name: set.name, lv: Math.min(...pieces.map((i) => i.lv)), qs, pieces });
  }
  return out.sort((a, b) => b.lv - a.lv || a.name.localeCompare(b.name));
}
function setPiece(set, slot, q) {
  const c = set.pieces.filter((i) => i.at === slot.at);
  return c.find((i) => i.q === q) || c.sort((a, b) => Math.abs(a.q - q) - Math.abs(b.q - q))[0];
}
function shadowFillTool(job) {
  return `<span class="group-title">Shadow gear</span>
    <button type="button" id="fill-toggle" class="fill-toggle">${FILL.open ? "✕ Close" : "✨ Fill a whole set"}</button>`;
}
function shadowFillRow(job) {
  if (!FILL.open) return "";
  const sets = shadowSets(job);
  if (!sets.length) return `<tr class="fill-row"><td colspan="3"><div class="note">No shadow sets for this job.</div></td></tr>`;
  const cur = sets.find((x) => x.id === FILL.set) || sets[0];
  FILL.set = cur.id;
  if (!cur.qs.includes(FILL.q)) FILL.q = cur.qs[0];
  const tile = (x) => `<button type="button" class="set-tile ${x.id === cur.id ? "on" : ""}" data-set="${x.id}">
      <div class="set-icons">${SHADOW_SLOTS.map((sl) => { const p = setPiece(x, sl, FILL.q); return p?.img ? `<img class="q${p.q}-edge" src="img/${esc(p.img)}" alt="" loading="lazy">` : "<span></span>"; }).join("")}</div>
      <b>${esc(x.name)}</b><span class="note">Lv${x.lv}</span></button>`;
  const best = B.gear.sets[cur.id]?.effects.filter((e) => e.q === FILL.q || e.q === 0).map((e) => e.desc).join("; ");
  return `<tr class="fill-row"><td colspan="3">
    <div class="set-tiles">${sets.map(tile).join("")}</div>
    <div class="fill-actions">
      <span class="mini">Quality</span>
      ${cur.qs.map((q) => `<button type="button" class="q-pill q${q}-edge ${q === FILL.q ? "on" : ""}" data-q="${q}"><span class="q${q}">${esc(QUALITY[q] || q)}</span></button>`).join("")}
      ${best ? `<span class="pill up">6/6: ${esc(best)}</span>` : ""}
      <span class="grow"></span>
      <button type="button" class="fill-go" data-fill="now">Put on Now</button>
      <button type="button" class="fill-go" data-fill="plan">Put on Plan</button>
    </div></td></tr>`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#fill-toggle")) { FILL.open = !FILL.open; renderBuildTable(); return; }
  const st = e.target.closest("[data-set]");
  if (st) { FILL.set = Number(st.dataset.set); renderBuildTable(); return; }
  const qp = e.target.closest("[data-q]");
  if (qp && qp.closest(".fill-row")) { FILL.q = Number(qp.dataset.q); renderBuildTable(); return; }
  const b = e.target.closest("button[data-fill]");
  if (!b) return;
  const job = $("#build-form").job.value ? Number($("#build-form").job.value) : null;
  const set = shadowSets(job).find((x) => x.id === FILL.set);
  if (!set) return;
  for (const sl of SHADOW_SLOTS) {
    const pick = setPiece(set, sl, FILL.q);
    if (pick) B[b.dataset.fill][sl.id] = { item: pick.id, refine: B[b.dataset.fill][sl.id]?.refine || 0, card: null };
  }
  FILL.open = false;
  renderBuildTable();
  renderBuildResults();
});
function renderSets() {
  const col = (side) => {
    const list = setBonuses(B[side], B.lookup);
    if (!list.length) return `<div class="note">No set pieces worn.</div>`;
    return list.map((x) => {
      const on = x.active.length > 0;
      const lines = on ? x.active.map((e) => esc(e.desc)).join("; ") : `needs ${x.need} pieces`;
      const worn = SLOTS.map((sl) => B.lookup.items.get(B[side][sl.id]?.item)).filter((i) => i?.sets?.includes(x.id));
      const missing = Math.max(0, x.need - worn.length);
      const icons = worn.map((i) => i.img ? `<img class="q${i.q}-edge" src="img/${esc(i.img)}" alt="" title="${esc(i.n)}">` : "").join("") +
        Array.from({ length: missing }, () => `<span class="missing"></span>`).join("");
      return `<div class="set-chip ${on ? "on" : ""}"><div class="set-icons small">${icons}</div><div><b>${esc(x.name)}</b> ${x.count}/${x.need}${on && x.active.some((e) => e.q) ? ` · ${esc(QUALITY[x.minQ] || x.minQ)}` : ""}<span>${lines}</span></div></div>`;
    }).join("");
  };
  $("#build-sets").innerHTML = `<div class="sets-box"><div class="extra-head">Set bonuses</div>
    <div class="extra-grid"><div><div class="mini">Now</div>${col("now")}</div><div><div class="mini">Plan</div>${col("plan")}</div></div>
    <div class="note">Shadow sets need all 6 pieces; the weakest piece decides the tier. Bonuses count in the damage number.</div></div>`;
}

// ---------------------------------------------------------------- support
// Heals, shields and party buffs for support jobs. Your stats come from your
// character screen; the Plan side adds what the gear you plan in the Damage
// tab changes (Plan − Now), so one gear table serves both tabs.
const SUP = { data: null, job: "", me: {}, friend: { magic: false }, levels: {}, off: {}, mods: {}, selfBuff: true };
const SUPPORT_KEY = "ro-sim:support:v1";
const SUP_ME = [["matk", "M.ATK"], ["atk", "P.ATK"], ["heal", "Healing %"]];
const SUP_FRIEND = [["maxhp", "Max HP"], ["rheal", "Received Healing %"], ["atk", "ATK (M.ATK for a mage)"]];
const supPct = (k) => k === "heal" || k === "rheal";
const supNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function supSkills(chain) {
  const rank = { heal: 0, mod: 1, buff: 2, protect: 3 };
  return SUP.data.skills.filter((s) => chain.includes(s.job))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || chain.indexOf(b.job) - chain.indexOf(a.job));
}
// jobs whose line heals, or gives the party at least 3 buffs or protections
function supportJobs() {
  const J = B.buffData.jobs;
  return new Set(Object.keys(J).filter((id) => {
    if (/not yet available/i.test(J[id].name)) return false;
    const sk = supSkills(chainOf(J, id));
    return sk.some((s) => s.kind === "heal") || sk.filter((s) => s.kind === "buff" || s.kind === "protect").length >= 3;
  }));
}
const supLv = (s) => Math.min(s.levels.length, SUP.levels[String(s.id)] ?? defaultLevel(s));

function setupSupport(data) {
  SUP.data = data;
  const jobs = supportJobs();
  const saved = freshSave(SUPPORT_KEY);
  if (saved) {
    if (jobs.has(String(saved.job))) SUP.job = String(saved.job);
    for (const [k] of SUP_ME) if (Number.isFinite(saved.me?.[k])) SUP.me[k] = saved.me[k];
    for (const [k] of SUP_FRIEND) if (Number.isFinite(saved.friend?.[k])) SUP.friend[k] = saved.friend[k];
    SUP.friend.magic = Boolean(saved.friend?.magic);
    const ids = new Set(data.skills.map((s) => String(s.id)));
    for (const k of ["levels", "off", "mods"]) {
      for (const [id, v] of Object.entries(saved[k] || {})) if (ids.has(id)) SUP[k][id] = k === "levels" ? Math.max(1, Number(v) || 1) : Boolean(v);
    }
    SUP.selfBuff = saved.selfBuff !== false;
  } else {
    // first visit: start from the Damage tab's job and screen numbers
    const dj = $("#build-form").job.value;
    SUP.job = jobs.has(dj) ? dj : "513";
    if (Number.isFinite(B.panel.matk)) SUP.me.matk = B.panel.matk;
    if (Number.isFinite(B.panel.atk)) SUP.me.atk = B.panel.atk;
  }
  if (!SUP.job) SUP.job = "513";
  $("#sup-selfbuff").checked = SUP.selfBuff;

  const tab = $("#tab-support");
  tab.addEventListener("input", (e) => {
    const el = e.target;
    const k = el.dataset.me ?? el.dataset.friend;
    if (k == null) return;
    const box = el.dataset.me != null ? SUP.me : SUP.friend;
    if (el.value.trim() === "") delete box[k];
    else box[k] = supPct(k) ? Number(el.value) / 100 : Number(el.value);
    renderSupport();
  });
  tab.addEventListener("change", (e) => {
    const el = e.target, d = el.dataset;
    if (el.id === "sup-selfbuff") SUP.selfBuff = el.checked;
    else if (d.friendMagic != null) SUP.friend.magic = el.value === "magic";
    else if (d.supLv) SUP.levels[d.supLv] = Number(el.value);
    else if (d.supOn) SUP.off[d.supOn] = !el.checked;
    else if (d.supMod) SUP.mods[d.supMod] = el.checked;
    else return;
    renderSupport();
  });
  tab.addEventListener("click", (e) => {
    const t = e.target.closest("[data-sup-job]");
    if (!t || t.classList.contains("noskills")) return;
    SUP.job = t.dataset.supJob;
    renderSupportJobs();
    renderSupport();
  });
  renderSupportJobs();
  renderSupportInputs();
  renderSupport();
}

function saveSupport() {
  localStorage.setItem(SUPPORT_KEY, JSON.stringify({ savedAt: Date.now(), job: SUP.job, me: SUP.me, friend: SUP.friend,
    levels: SUP.levels, off: SUP.off, mods: SUP.mods, selfBuff: SUP.selfBuff }));
}

function renderSupportJobs() {
  const J = B.buffData.jobs, ok = supportJobs();
  const tile = (id) => {
    const j = J[id];
    const heals = supSkills(chainOf(J, id)).some((s) => s.kind === "heal");
    return `<button type="button" class="job-tile ${id === SUP.job ? "on" : ""} ${j.hasSkills ? "" : "noskills"}" data-sup-job="${id}" title="${esc(j.name)}${j.hasSkills ? "" : " (skills not out in SEA yet)"}">
      ${j.img ? `<img src="img/${esc(j.img)}" alt="" loading="lazy">` : `<span class="job-any">?</span>`}<span>${esc(j.name)}</span>${heals ? `<b class="heal-dot" title="heals">✚</b>` : ""}</button>`;
  };
  // each family's branches as chains, keeping only support jobs
  const chainsOf = (root) => (J[root]?.children || []).map((c) => {
    const out = [root, c];
    let kids = J[c]?.children || [];
    while (kids.length === 1) { out.push(kids[0]); kids = J[kids[0]]?.children || []; }
    return out.filter((id) => ok.has(String(id))).map(String);
  }).filter((ch) => ch.length);
  const roots = (J["101"]?.children || []).map(String);
  const seen = new Set();
  $("#sup-jobs").innerHTML = roots.map((root) => {
    const chains = chainsOf(root).map((ch) => ch.filter((id) => (id === root ? true : !seen.has(id) && seen.add(id))));
    if (!chains.length) return "";
    return `<div class="job-fam">${chains.map((ch, i) => `<div class="job-chain">${(i ? ch.filter((id) => id !== root) : ch).map(tile).join('<span class="job-arrow">›</span>')}</div>`).join("")}</div>`;
  }).join("");
}

function renderSupportInputs() {
  if (!SUP.data) return;
  const field = (attr, [k, label], box) => {
    const v = box[k];
    const shown = v == null ? "" : supPct(k) ? +(v * 100).toFixed(2) : v;
    return `<label>${esc(label)} <input type="number" step="any" min="0" data-${attr}="${k}" value="${shown}" placeholder="${supPct(k) ? "%" : ""}"></label>`;
  };
  $("#sup-me").innerHTML = SUP_ME.map((x) => field("me", x, SUP.me)).join("");
  $("#sup-friend").innerHTML = `<label>Friend attacks with <select data-friend-magic="1">
      <option value="phys" ${SUP.friend.magic ? "" : "selected"}>P.ATK (physical)</option>
      <option value="magic" ${SUP.friend.magic ? "selected" : ""}>M.ATK (magic)</option></select></label>` +
    SUP_FRIEND.map((x) => field("friend", x, SUP.friend)).join("");
}

function supLevelSelect(s) {
  const lv = supLv(s);
  return `<select data-sup-lv="${esc(s.id)}" aria-label="Level">${s.levels.map((_, k) =>
    `<option value="${k + 1}" ${lv === k + 1 ? "selected" : ""}>Lv${k + 1}${s.natural && k + 1 > s.natural ? "+" : ""}</option>`).join("")}</select>`;
}
const supIcon = (s) => (s.img ? `<img class="line-icon" src="img/${esc(s.img)}" alt="">` : "");
const supName = (s) => `${supIcon(s)}<b>${esc(s.name)}</b>${s.ult ? ' <span class="tag ult">Ultimate</span>' : ""}`;

function renderSupport() {
  if (!SUP.data || !B.lookup || !$("#tab-support").classList.contains("on")) return;
  const J = B.buffData.jobs;
  const chain = chainOf(J, SUP.job);
  const skills = supSkills(chain);
  const heals = skills.filter((s) => s.kind === "heal");
  const mods = skills.filter((s) => s.kind === "mod");
  const buffs = skills.filter((s) => s.kind === "buff");
  const protect = skills.filter((s) => s.kind === "protect");

  // passives that change heals; a choice like Purgatorial Angel starts off
  const modOn = (s) => SUP.mods[String(s.id)] ?? !levelOf(s, supLv(s)).mod?.choice;
  const activeMods = mods.filter(modOn).map((s) => levelOf(s, supLv(s)).mod).filter(Boolean);
  const onBuffs = buffs.filter((s) => !SUP.off[String(s.id)]);
  const buffFx = onBuffs.flatMap((s) => levelOf(s, supLv(s)).fx || []);

  // Plan = screen + what the Damage tab's Plan gear changes
  const roll = buildCtx().roll;
  const tn = sumStats(B.now, B.lookup, roll).t, tp = sumStats(B.plan, B.lookup, roll).t;
  const planEmpty = sideEmpty("plan");
  const d = planEmpty ? { matk: 0, atk: 0, heal: 0 }
    : { matk: gearAtk(tp, true) - gearAtk(tn, true), atk: gearAtk(tp, false) - gearAtk(tn, false), heal: (tp.heal || 0) - (tn.heal || 0) };
  const me0 = { matk: supNum(SUP.me.matk), atk: supNum(SUP.me.atk), heal: supNum(SUP.me.heal) };
  const mp0 = { matk: me0.matk + d.matk, atk: me0.atk + d.atk, heal: me0.heal + d.heal };
  const meNow = SUP.selfBuff ? withBuffs(me0, buffFx) : me0;
  const mePlan = SUP.selfBuff ? withBuffs(mp0, buffFx) : mp0;
  const target = { maxhp: supNum(SUP.friend.maxhp), rheal: supNum(SUP.friend.rheal) };
  const changed = d.matk || d.atk || d.heal;
  const sgn = (v, pct) => `${v >= 0 ? "+" : "−"}${pct ? `${fmt(Math.abs(v) * 100, 1)}%` : fmt(Math.abs(v))}`;
  $("#sup-gear").innerHTML = planEmpty
    ? `Plan = Now. To compare gear, fill the Plan column in the <a href="#build" data-goto="build">Damage tab</a>; its changes show here.`
    : changed ? `Plan gear from the <a href="#build" data-goto="build">Damage tab</a>: M.ATK ${sgn(d.matk)} · P.ATK ${sgn(d.atk)} · Healing ${sgn(d.heal, true)}`
      : `The Plan gear in the <a href="#build" data-goto="build">Damage tab</a> changes no M.ATK, P.ATK or Healing%.`;

  // ---- heals
  const statName = { matk: "M.ATK", atk: "P.ATK", maxhp: "friend's Max HP" };
  let best = null;
  const healRows = heals.map((s) => {
    const lv = supLv(s);
    const m = healMods(s.name, activeMods);
    const now = healSkill(s, lv, meNow, target, m), plan = healSkill(s, lv, mePlan, target, m);
    return now.map((p, i) => {
      const q = plan[i];
      if (!p.aura && (!best || p.cast > best.now.cast)) best = { s, now: p, plan: q };
      const formula = `${fmt(p.pct, p.pct % 1 ? 1 : 0)}% × ${statName[p.stat]}${p.flat ? ` + ${fmt(p.flat)}` : ""}`;
      const when = p.aura ? `aura, every ${fmt(p.every, 1)} s` : p.every ? `every ${fmt(p.every, 1)} s${p.ticks ? ` × ${p.ticks}` : " while it lasts"}` : `cooldown ${fmt(levelOf(s, lv).cd, 1)} s`;
      const bonus = (m.add ? ` · passives +${fmt(m.add * 100, 0)}%` : "") + (m.mult !== 1 ? ` · ×${fmt(m.mult, 2)}` : "");
      const cell = (x) => `<b>${fmt(x.hit)}</b><div class="src">${x.ticks > 1 && x.cast ? `${fmt(x.cast)} per cast · ` : ""}${x.perSec ? `${fmt(x.perSec)} HP/s${x.every ? " while on" : " spammed"}` : ""}</div>`;
      const ch = p.hit > 0 ? q.hit / p.hit - 1 : 0;
      return `<tr><td>${i ? `<span class="src">${p.aura ? "Ensemble Aura" : "and"}</span>` : `${supName(s)}<div class="src">${esc(J[s.job]?.name || "")}</div>`}</td>
        <td>${i ? "" : supLevelSelect(s)}</td>
        <td title="${esc(descOf(s, lv))}">${esc(formula)}<div class="src">${esc(when + bonus)}</div></td>
        <td class="num" data-label="Now">${cell(p)}</td><td class="num" data-label="Plan">${cell(q)}</td>
        <td class="num" data-label="Change"><span class="pill ${ch > 0.0005 ? "up" : ch < -0.0005 ? "down" : "flat"}">${Math.abs(ch) > 0.0005 ? `${ch > 0 ? "+" : ""}${fmt(ch * 100, 1)}%` : "same"}</span></td></tr>`;
    }).join("");
  }).join("");
  $("#sup-mods").innerHTML = mods.length ? mods.map((s) => {
    const md = levelOf(s, supLv(s)).mod;
    const what = !md ? "" : md.mult != null ? `${md.skills.join(", ")} ×${fmt(md.mult, 2)}` : `${md.skills ? `${md.skills.join(", ")} ` : "all heals "}+${fmt(md.add * 100, 1)}%`;
    return `<label class="mod-chip ${modOn(s) ? "on" : ""}" title="${esc(descOf(s, supLv(s)))}"><input type="checkbox" data-sup-mod="${esc(s.id)}" ${modOn(s) ? "checked" : ""}>
      ${supIcon(s)}<b>${esc(s.name)}</b>${s.levels.length > 1 ? supLevelSelect(s) : ""}<span>${esc(what)}${md?.choice ? " (pick this only if you took it)" : ""}</span></label>`;
  }).join("") + `<div class="note">Passives that change heals. "All heals" ones may already be in the Healing% on your screen; untick them if so.</div>` : "";
  const noStat = heals.length && !me0.matk && !me0.atk && !target.maxhp;
  $("#sup-heals").innerHTML = heals.length
    ? `${noStat ? `<p class="note warn-note">Type your M.ATK (and P.ATK for songs and potions) above to see real numbers.</p>` : ""}
      <table class="mid sup-table sup-heal"><thead><tr><th>Skill</th><th>Level</th><th>Heals</th><th class="num">Now · HP</th><th class="num">Plan · HP</th><th class="num">Change</th></tr></thead><tbody>${healRows}</tbody></table>`
    : `<p class="note">${esc(J[SUP.job]?.name || "This job")} has no healing skills. Its party buffs and protections are below.</p>`;

  // ---- party buffs
  const gk = gainKeys(SUP.friend.magic);
  const friend = { magic: SUP.friend.magic, atk: supNum(SUP.friend.atk) };
  const buffRows = buffs.map((s) => {
    const lv = supLv(s), on = !SUP.off[String(s.id)];
    const fx = levelOf(s, lv).fx || [];
    const g = buffGain(fx, friend);
    const counted = fx.some(([k]) => gk.has(k));
    const listed = fx.filter(([k]) => !gk.has(k)).map(([k, v]) => `${statLabel(k)} +${PCT_KEYS.test(k) ? `${+(v * 100).toFixed(2)}%` : +v.toFixed(2)}`);
    return `<tr class="${on ? "" : "off"}"><td><label class="buff-on"><input type="checkbox" data-sup-on="${esc(s.id)}" ${on ? "checked" : ""}>${supName(s)}</label><div class="src">${esc(J[s.job]?.name || "")}</div></td>
      <td>${s.levels.length > 1 ? supLevelSelect(s) : `Lv${lv}`}</td>
      <td>${esc(descOf(s, lv))}${listed.length ? `<div class="src">listed: ${esc(listed.join(", "))}</div>` : ""}</td>
      <td class="num" data-label="Friend hits harder">${counted ? (g == null ? `<span class="src">type friend's ATK</span>` : `<span class="pill up">+${fmt(g * 100, 1)}%</span>`) : `<span class="pill flat">text</span>`}</td></tr>`;
  }).join("");
  const total = buffGain(buffFx, friend);
  $("#sup-buffs").innerHTML = buffs.length ? `<table class="mid sup-table sup-list"><thead><tr><th>Buff</th><th>Level</th><th>What it does</th><th class="num">Friend hits harder</th></tr></thead><tbody>${buffRows}
      <tr class="total"><td colspan="3"><b>All ticked buffs together</b> <span class="src">(ATK and ATK% multiply, so this is more than the sum)</span></td><td class="num">${total == null ? "—" : `<b>+${fmt(total * 100, 1)}%</b>`}</td></tr></tbody></table>`
    : `<p class="note">No party buffs in this job line.</p>`;

  // ---- protection
  const protRows = protect.map((s) => {
    const lv = supLv(s), L = levelOf(s, lv);
    const shield = L.shield != null ? (target.maxhp ? `<b>${fmt(target.maxhp * L.shield / 100)}</b> HP shield` : `<span class="src">type friend's Max HP</span>`) : "";
    return `<tr><td>${supName(s)}<div class="src">${esc(J[s.job]?.name || "")}</div></td><td>${s.levels.length > 1 ? supLevelSelect(s) : `Lv${lv}`}</td>
      <td>${esc(descOf(s, lv))}</td><td class="num" data-label="On your friend">${shield}${L.cd ? `<div class="src">cooldown ${fmt(L.cd, 1)} s</div>` : ""}</td></tr>`;
  }).join("");
  $("#sup-protect").innerHTML = protect.length ? `<table class="mid sup-table sup-list"><thead><tr><th>Skill</th><th>Level</th><th>What it does</th><th class="num">On your friend</th></tr></thead><tbody>${protRows}</tbody></table>`
    : `<p class="note">No shields or protections in this job line.</p>`;

  // ---- KPIs
  const stars = upgradeStarstones(B.now, B.plan, B.refine), cost = planEmpty ? 0 : stars * state.rmPerStar;
  const ch = best && best.now.hit > 0 ? best.plan.hit / best.now.hit - 1 : 0;
  const kyrie = protect.find((s) => levelOf(s, supLv(s)).shield != null);
  const kStat = (me) => (best?.now.stat === "maxhp" ? `friend Max HP ${fmt(target.maxhp)}` : `${statName[best?.now.stat] || "M.ATK"} ${fmt(me[best?.now.stat] ?? me.matk)}`);
  $("#sup-kpis").innerHTML = `
    <div class="kpi"><div class="label">Now · ${best ? `${esc(best.s.name)} per cast` : "biggest heal"}</div><div class="value">${best && best.now.cast ? fmt(best.now.cast) : "—"}</div><div class="sub">${best ? `Lv${supLv(best.s)} · ${kStat(meNow)} · Healing ${fmt((meNow.heal || 0) * 100, 1)}%` : "no heals in this job line"}</div></div>
    <div class="kpi"><div class="label">Plan · same heal</div><div class="value">${best && best.plan.cast && !planEmpty ? fmt(best.plan.cast) : "—"}</div><div class="sub">${planEmpty ? "plan gear in the Damage tab" : `${kStat(mePlan)} · Healing ${fmt((mePlan.heal || 0) * 100, 1)}%`}</div></div>
    <div class="kpi ${ch > 0.0005 ? "good" : ch < -0.0005 ? "bad" : ""}"><div class="label">Plan vs Now (heals)</div><div class="value">${planEmpty || !best ? "—" : `${ch >= 0 ? "+" : ""}${fmt(ch * 100, 1)}%`}</div><div class="sub">${cost > 0 ? `refines in Plan cost about ${rm(cost)}${ch > 0.0005 ? ` · ${rm(cost / (ch * 100))} per +1%` : ""}` : "same skill level, gear changes only"}</div></div>
    <div class="kpi ${total ? "good" : ""}"><div class="label">Your buffs: friend hits harder</div><div class="value">${total == null ? "—" : `+${fmt(total * 100, 1)}%`}</div><div class="sub">${total == null ? "type your friend's ATK" : `${onBuffs.length} buff${onBuffs.length === 1 ? "" : "s"} ticked`}${kyrie && target.maxhp ? ` · ${esc(kyrie.name)} ${fmt(target.maxhp * levelOf(kyrie, supLv(kyrie)).shield / 100)} HP` : ""}</div></div>`;

  $("#sup-notes").innerHTML = `How heals are worked out: (skill % × M.ATK, or P.ATK for songs and potions, + the flat part) × (1 + your Healing% + heal passives) × (1 + your friend's Received Healing%).
    The numbers come from each skill's text in the SEA game data. The game does not publish how Healing% stacks, so trust the % change more than the raw HP.
    "Spammed" HP/s assumes you recast it every cooldown; "while on" is for skills that tick. Levels marked + are above the normal cap (breakthrough).`;
  saveSupport();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-goto]");
  if (!a) return;
  e.preventDefault();
  document.querySelector(`#tabs button[data-tab="${a.dataset.goto}"]`)?.click();
  window.scrollTo({ top: 0 });
});

main();
