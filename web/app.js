import { expected, simulate, percentile, stepRates } from "./lib/refine.js";

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
const state = { rmPerStar: Number(localStorage.getItem("rmPerStar")) || DEFAULT_RM_PER_STAR };

async function load(name) {
  const r = await fetch(`data/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}. Run ./scripts/fetch-data.sh`);
  return name.endsWith(".json") ? r.json() : r.text();
}

async function main() {
  let refine, cards, gear, shop, fetchedAt;
  try {
    [refine, cards, gear, shop, fetchedAt] = await Promise.all(
      ["refine.json", "cards.json", "equipment.json", "shop.json", "fetched_at.txt"].map(load));
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
  };
  $("#tabs").addEventListener("click", (e) => e.target.dataset.tab && show(e.target.dataset.tab));
  const start = location.hash.slice(1);
  if (start && document.getElementById(`tab-${start}`)) show(start);

  const rate = $("#rm-per-star");
  rate.value = state.rmPerStar;
  rate.addEventListener("change", () => {
    state.rmPerStar = Number(rate.value) || DEFAULT_RM_PER_STAR;
    localStorage.setItem("rmPerStar", state.rmPerStar);
    renderRefine(refine); renderShop(shop); renderGear(gear, refine);
  });

  setupRefine(refine);
  setupCards(cards);
  setupGear(gear, refine);
  setupShop(shop);
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
  $("#refine-table").innerHTML = `<table><thead><tr><th>+${from} → +${to}</th><th class="num">Average</th><th class="num">P50</th><th class="num">P90</th><th class="num">P99</th><th class="num">Worst run</th></tr></thead><tbody>
    ${rows.map(([label, xs, show]) => `<tr${label === "Real money" ? ' class="hot"' : ""}><td>${esc(label)}</td><td class="num">${show(mean(xs))}</td><td class="num">${show(percentile(xs, 0.5))}</td><td class="num">${show(percentile(xs, 0.9))}</td><td class="num">${show(percentile(xs, 0.99))}</td><td class="num">${show(xs[xs.length - 1])}</td></tr>`).join("")}
  </tbody></table>`;

  // per-step cost (average, buying everything)
  const steps = data.levels.map((lv) => {
    const e = expected(data, lv.level, lv.level + 1, { ...opts, owned: {} });
    return { lv, e };
  });
  const maxRm = Math.max(0, ...steps.filter((s) => s.lv.level >= from && s.lv.level < to).map((s) => s.e.starstones * R));
  $("#refine-steps").innerHTML = `<table><thead><tr><th>Step</th><th>Rates</th><th class="num">Success</th><th class="num">Drop −1</th><th class="num">Stay</th><th>Material / try</th><th class="num">Zeny / try</th><th class="num">Avg tries</th><th class="num">Avg cost</th></tr></thead><tbody>
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
  $("#shop-table").innerHTML = `<table><thead><tr><th>Item</th><th>Shop / tab</th><th class="num">Qty</th><th>Price</th><th class="num">In RM</th><th class="num">Buy limit</th></tr></thead><tbody>
    ${list.slice(0, 400).map((i) => `<tr><td class="name">${esc(i.n)}</td><td>${esc(i.store)} · ${esc(i.tab)}</td><td class="num">${i.num}</td>
      <td>${fmt(i.price)} ${esc(i.cur)}</td><td class="num">${isStar(i) ? rm(i.price * state.rmPerStar) : "—"}</td>
      <td class="num">${i.limit ? fmt(i.limit) : "—"}</td></tr>`).join("")}
  </tbody></table>`;
}

main();
