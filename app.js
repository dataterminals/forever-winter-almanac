"use strict";

const CATLABEL = {
  MZD: "Muzzle devices", SMZD: "Suppressed muzzle devices", FGR: "Foregrips",
  FLL: "Rail flashlights", LAM: "Rail laser sights", OPT: "Optics", SCP: "Scopes",
};
const CAT_ORDER = ["MZD", "SMZD", "FGR", "FLL", "LAM", "OPT", "SCP"];
const SUBTYPE_LABEL = {
  ATTMD1: "Pistols & PDWs", ATTMD2: "Shotguns", ATTMD3: "Assault rifles & LMGs",
  ATTMD4: "Battle rifles / DMRs", ATTMD5: "Heavy / anti-materiel",
};
const SUBTYPE_ORDER = ["ATTMD1", "ATTMD2", "ATTMD3", "ATTMD4", "ATTMD5"];

let DATA = null;      // active attachments dataset (data/attachments.json)
let WEAPONS = null;   // active per-weapon stats (data/weapons.json), keyed by lowercased name
let WEAPONS_BUILD = null; // that dataset's own build stamp, for the Weapons legend

// The Stats tab is a static guide — it has no `const D = <dataset>` of its own, so it
// used to hardcode build numbers in prose and went two builds stale. weapons.json is
// loaded at boot and comes from the same full pak mount every Stats claim cites, so
// its stamp is the right source. Degrades to a phrase rather than printing "null".
const STATS_BUILD = () => WEAPONS_BUILD ?? "the live build";
let PARTS = null;     // active structural parts (data/parts.json, byWeapon -> slot -> [parts])
let AMMO = null;      // active ammunition catalogue (data/ammo.json)
let CRAFT = null;     // active crafting recipes (data/crafting.json), lazy on first Crafting visit
let ENEMYDATA = null; // active enemy intel (data/enemies.json), lazy on first Enemies visit
// Pristine vanilla copies. The active globals above are (re)composed from these +
// whichever mod overlays are switched on, by composeActive().
let DATA_V = null, WEAPONS_V = null, PARTS_V = null, AMMO_V = null, CRAFT_V = null, ENEMY_V = null;
// Mod overlays: a registry loaded at boot. Each file carries a .meta
// {id,name,short,badge,nexus,pages}. Independent — any number can be switched on.
const MOD_FILES = [
  { id: "hrr", file: "data/rebalance.json" },
  { id: "unkillables", file: "data/unkillables.json" },
];
let MODS = []; // successfully-loaded overlays, in MOD_FILES order
// which mod id changed each row / added each item — drives the per-mod "changed"/"new" badges
const affected = { weapons: new Map(), ammo: new Map(), attAdded: new Map(), enemies: new Map() };
const state = { tab: "weapons", weapon: null, att: null, q: "", layout: "split", mods: {}, ecoMode: "tiers", ecoCat: "all", lootKind: "all", enemyCat: "all" };
const idx = { attById: {}, weaponByName: {}, weaponSubtype: {}, subtypes: {} };
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const modById = (id) => MODS.find((m) => m.meta && m.meta.id === id) || null;

// per-weapon stat card rows (accuracy & magazine first — the two that visibly matter)
const WSTAT_ROWS = [
  ["accuracy", "Accuracy", (v) => v],
  ["magazine", "Magazine", (v) => v],
  // shotguns store damage PER PELLET; show the spread total too or the number reads as a typo
  ["damage", "Damage", (v, w) => (w.pellets ? `${v} × ${w.pellets} = ${w.damagePerShot}` : v)],
  ["stability", "Stability", (v) => v],
  ["recoil", "Recoil", (v) => v],
  ["rof", "Rate of fire", (v) => v + " rps"],
  ["firemodes", "Fire modes", (v) => v],
  ["weight", "Weight", (v) => v + " kg"],
  ["value", "Base value", (v) => Number(v).toLocaleString() + " cr"],
];
// stats the game computes on the fly (no stored field) — flagged with a * + hover note
const WSTAT_NOTES = {
  accuracy: "Not a stored value — the game derives it from the bullet-spread (dispersion) system. Higher = tighter grouping. The number shown is an aggregate the devs flag as WIP.",
  stability: "Attachments still grant Stability, but nothing in the shipped data reads it any more — the per-weapon curves that turned Stability into bullet spread were deleted. What it does now is unproven.",
  recoil: "Not a stored value — a compound of hidden wrist + arm recoil shown as one number. Believed to drive camera shake only (it doesn't move your point of aim), and it's often wrong once the weapon is modified.",
};

const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function init() {
  try {
    DATA = await (await fetch("data/attachments.json", { cache: "no-cache" })).json();
  } catch (e) {
    view.innerHTML = `<p class="empty">Could not load data.<br><small>${esc(e.message)}</small></p>`;
    return;
  }
  // per-weapon stats are optional — a failure here must not break the app
  try {
    const wj = await (await fetch("data/weapons.json", { cache: "no-cache" })).json();
    // Keep the dataset's own build stamp — the Weapons legend used to hardcode it,
    // so a regeneration restamped the data and left the page claiming the old build.
    WEAPONS_BUILD = wj.build;
    WEAPONS = {};
    for (const nm in wj.weapons) WEAPONS[nm.toLowerCase()] = wj.weapons[nm];
  } catch (e) { WEAPONS = {}; }
  try {
    PARTS = await (await fetch("data/parts.json", { cache: "no-cache" })).json();
    PARTS.byWeaponLC = {}; // case-insensitive join, mirroring the weapons.json lookup
    for (const nm in (PARTS.byWeapon || {})) PARTS.byWeaponLC[nm.toLowerCase()] = PARTS.byWeapon[nm];
  } catch (e) { PARTS = { byWeapon: {}, byWeaponLC: {}, slotOrder: [] }; }
  try {
    AMMO = await (await fetch("data/ammo.json", { cache: "no-cache" })).json();
    AMMO.byKey = {};
    AMMO.ammo.forEach((a) => (AMMO.byKey[a.key] = a));
  } catch (e) { AMMO = null; }
  // load every mod overlay (each optional — the app works fine without any)
  MODS = (await Promise.all(MOD_FILES.map(async (mf) => {
    try { const j = await (await fetch(mf.file, { cache: "no-cache" })).json(); j.meta = j.meta || {}; j.meta.id = j.meta.id || mf.id; return j; }
    catch (e) { return null; }
  }))).filter(Boolean);
  DATA_V = DATA; WEAPONS_V = WEAPONS; PARTS_V = PARTS; AMMO_V = AMMO;
  try { const s = localStorage.getItem("fw:wlayout"); if (["list", "grid", "split"].includes(s)) state.layout = s; } catch (e) {}
  try { const m = localStorage.getItem("fw:ecomode"); if (["tiers", "density"].includes(m)) state.ecoMode = m; } catch (e) {}
  try { const d = JSON.parse(localStorage.getItem("fw:mods") || "{}"); if (d && typeof d === "object") state.mods = d; } catch (e) {}
  applyLayout();
  composeActive(); // build the active globals from vanilla + any switched-on overlays
  wireChrome();
  // Back/forward, edited URLs, and clicked deep-links all route through applyRoute.
  window.addEventListener("hashchange", () => { if (!routing) applyRoute(); });
  applyRoute(); // hydrate initial state from the URL (deep-link) or default to Weapons
  registerSW();
}

function buildIndex() {
  DATA.attachments.forEach((a) => (idx.attById[a.id] = a));
  DATA.weapons.forEach((w) => (idx.weaponByName[w.name] = w));
  // slug <-> name/id maps for deep-link URLs (weapon names & attachment ids are
  // both unique; slugify is verified collision-free, uniqueSlug is just a guard).
  idx.weaponSlug = {}; idx.slugByWeapon = {};
  DATA.weapons.forEach((w) => { const s = uniqueSlug(slugify(w.name), idx.weaponSlug); idx.weaponSlug[s] = w.name; idx.slugByWeapon[w.name] = s; });
  idx.attSlug = {}; idx.slugByAtt = {};
  DATA.attachments.forEach((a) => { const s = uniqueSlug(slugify(a.id), idx.attSlug); idx.attSlug[s] = a.id; idx.slugByAtt[a.id] = s; });
  // muzzle subtypes -> devices + weapons
  DATA.attachments.forEach((a) => {
    if ((a.category === "MZD" || a.category === "SMZD") && a.subtype) {
      const s = (idx.subtypes[a.subtype] = idx.subtypes[a.subtype] || { mzd: [], smzd: [], weapons: new Set() });
      (a.category === "MZD" ? s.mzd : s.smzd).push(a.name);
      a.compatible.forEach((w) => s.weapons.add(w));
      if (a.category === "MZD") a.compatible.forEach((w) => (idx.weaponSubtype[w] = a.subtype));
    }
  });
  $("#stats").textContent = `${DATA.weapons.length} weapons · ${DATA.attachments.length} attachments`;
}

/* ---------- dataset overlays (Vanilla + independent per-mod toggles) ----------
   Each dataset is a bare module global. composeActive() rebuilds every active
   global from its pristine vanilla copy, layering on whichever mod overlays are
   switched on (state.mods[id]). Mods are independent — two can be on at once. */
function activeMods() { return MODS.filter((m) => state.mods[m.meta.id]); }

function composeActive() {
  const mods = activeMods();
  affected.weapons = new Map(); affected.ammo = new Map(); affected.attAdded = new Map(); affected.enemies = new Map();
  WEAPONS = composeWeapons(mods);
  AMMO = composeAmmo(mods);
  PARTS = composeParts(mods);
  DATA = composeAttachments(mods);
  if (ENEMY_V) ENEMYDATA = composeEnemies(mods);
  if (CRAFT_V) CRAFT = composeCrafting(mods);
  document.body.classList.toggle("ds-modded", mods.length > 0);
  buildIndex(); // idx (attachments, weapon-by-name, slugs, subtypes) is derived from the active DATA
}

function composeWeapons(mods) {
  if (!WEAPONS_V) return WEAPONS_V;
  const out = {};
  for (const lc in WEAPONS_V) out[lc] = Object.assign({}, WEAPONS_V[lc]);
  mods.forEach((m) => {
    const byInt = (m.weapons && m.weapons.byInternal) || {};
    for (const lc in out) {
      const w = out[lc], d = w.internal && byInt[w.internal];
      if (d) { Object.assign(w, d); affected.weapons.set(w.internal, m.meta.id); }
    }
  });
  return out;
}

function composeAmmo(mods) {
  if (!AMMO_V) return AMMO_V;
  const out = clone(AMMO_V);
  mods.forEach((m) => {
    const byKey = (m.ammo && m.ammo.byKey) || {};
    out.ammo.forEach((a) => { if (byKey[a.key]) { Object.assign(a, byKey[a.key]); affected.ammo.set(a.key, m.meta.id); } });
  });
  out.byKey = {}; out.ammo.forEach((a) => (out.byKey[a.key] = a));
  return out;
}

function composeParts(mods) {
  if (!PARTS_V) return PARTS_V;
  const out = clone(PARTS_V);
  const bw = out.byWeapon || (out.byWeapon = {});
  mods.forEach((m) => {
    ((m.parts && m.parts.override) || []).forEach((o) => {
      const arr = bw[o.weapon] && bw[o.weapon][o.slot];
      const p = arr && arr.find((x) => x.name === o.name);
      if (p) p.effects = Object.assign({}, p.effects || {}, o.effects);
    });
    ((m.parts && m.parts.add) || []).forEach((o) => {
      const slots = bw[o.weapon] || (bw[o.weapon] = {});
      const arr = slots[o.slot] || (slots[o.slot] = []);
      if (!arr.some((x) => x.name === o.name)) arr.push({ name: o.name, short: o.short, level: o.level, effects: o.effects, buy: o.buy, mod: m.meta.id });
      if (out.slotOrder && !out.slotOrder.includes(o.slot)) out.slotOrder.push(o.slot);
    });
  });
  out.byWeaponLC = {};
  for (const nm in bw) out.byWeaponLC[nm.toLowerCase()] = bw[nm];
  return out;
}

function composeAttachments(mods) {
  if (!DATA_V) return DATA_V;
  const out = clone(DATA_V);
  const wByName = {}; out.weapons.forEach((w) => (wByName[w.name] = w));
  mods.forEach((m) => {
    ((m.attachments && m.attachments.add) || []).forEach((a) => {
      if (!out.attachments.some((x) => x.id === a.id)) out.attachments.push(a);
      affected.attAdded.set(a.id, m.meta.id);
      (a.compatible || []).forEach((wn) => {
        const w = wByName[wn]; if (!w) return;
        w.byCategory = w.byCategory || {};
        const cat = (w.byCategory[a.category] = w.byCategory[a.category] || []);
        if (!cat.includes(a.name)) { cat.push(a.name); w.total = (w.total || 0) + 1; }
      });
    });
  });
  return out;
}

function composeCrafting(mods) {
  if (!CRAFT_V) return CRAFT_V;
  const out = clone(CRAFT_V);
  mods.forEach((m) => ((m.crafting && m.crafting.addGroups) || []).forEach((g) => out.groups.push(Object.assign({}, g, { mod: m.meta.id }))));
  return out;
}

function composeEnemies(mods) {
  if (!ENEMY_V) return ENEMY_V;
  const out = clone(ENEMY_V);
  out._modNotes = [];
  const byId = {}; out.units.forEach((u) => (byId[u.id] = u));
  mods.forEach((m) => {
    const ov = (m.enemies && m.enemies.byId) || {};
    for (const id in ov) { const u = byId[id]; if (u) { deepMerge(u, ov[id]); affected.enemies.set(id, m.meta.id); } }
    if (m.enemies && m.enemies.note) out._modNotes.push({ mod: m.meta.id, note: m.enemies.note });
  });
  return out;
}

// recursive merge for nested overlay objects (e.g. codexKill{}, stagger{}, grab{})
function deepMerge(dst, src) {
  for (const k in src) {
    const v = src[k];
    if (v && typeof v === "object" && !Array.isArray(v) && dst[k] && typeof dst[k] === "object") deepMerge(dst[k], v);
    else dst[k] = v;
  }
}

function setMod(id, on) {
  on = !!on;
  if (!modById(id) || !!state.mods[id] === on) return;
  state.mods[id] = on;
  try { localStorage.setItem("fw:mods", JSON.stringify(state.mods)); } catch (e) {}
  composeActive();
  render();
}

// per-page control: a Vanilla | <mod> switch for every mod whose meta.pages includes this tab
function datasetBar() {
  const rel = MODS.filter((m) => (m.meta.pages || []).includes(state.tab));
  if (!rel.length) return "";
  return rel.map((m) => {
    const on = !!state.mods[m.meta.id], mt = m.meta;
    const nexus = (url, id) => `<a href="${esc(url)}" target="_blank" rel="noopener">Nexus&nbsp;#${esc(id || "")}</a>`;
    const note = on
      ? `Showing <b>${esc(mt.name)}</b>`
        + (mt.nexusUrl ? ` &middot; ${nexus(mt.nexusUrl, mt.nexus)}` : "")
        // a community fix links its own page first, and still credits the mod it repairs
        + (mt.originalNexusUrl ? ` &middot; original mod ${nexus(mt.originalNexusUrl, mt.originalNexus)}${mt.author ? ` by ${esc(mt.author)}` : ""}` : "")
        + (mt.status ? ` &middot; <span class="ds-status">${esc(mt.status)}</span>` : "")
      : `Vanilla, datamined. Toggle to overlay <b>${esc(mt.short)}</b>.`;
    return `<div class="ds-bar${on ? " on" : ""}">
      <div class="ds-modes" role="group" aria-label="${esc(mt.name)} dataset">
        <button data-mod="${esc(mt.id)}" data-on="0" class="${on ? "" : "on"}">Vanilla</button>
        <button data-mod="${esc(mt.id)}" data-on="1" class="${on ? "on" : ""}">${esc(mt.short)}</button>
      </div>
      <span class="ds-note${on ? "" : " ds-dim"}">${note}</span>
    </div>`;
  }).join("");
}

// which mod (meta) changed this weapon / ammo / enemy, if any
function weaponMod(name) { const ws = WEAPONS && WEAPONS[name.toLowerCase()]; return ws && affected.weapons.has(ws.internal) ? modById(affected.weapons.get(ws.internal)) : null; }
function ammoMod(key) { return affected.ammo.has(key) ? modById(affected.ammo.get(key)) : null; }
function enemyMod(id) { return affected.enemies.has(id) ? modById(affected.enemies.get(id)) : null; }
const modBadge = (m) => m ? (m.meta.badge || m.meta.short || "Mod") : "";

/* ---------- chrome / events ---------- */
function wireChrome() {
  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      view.classList.remove("detail-open");
      syncTabs();
      if (state.tab === "maps") activateMaps();
      else { deactivateMaps(); render(); writeHash({ push: true }); }
      window.scrollTo({ top: 0 });
    })
  );
  const s = $("#search"), clr = $("#searchClear");
  s.addEventListener("input", () => {
    state.q = s.value.trim().toLowerCase();
    clr.hidden = !s.value;
    view.classList.remove("detail-open");
    render();
    writeHash();
  });
  clr.addEventListener("click", () => { s.value = ""; state.q = ""; clr.hidden = true; s.focus(); render(); writeHash(); });

  view.addEventListener("click", (e) => {
    // per-section link icon: copy a deep link to this sub-section (must run first,
    // and swallow the event so it doesn't toggle a <details> or trigger a row).
    const al = e.target.closest(".anchor-link");
    if (al) { e.preventDefault(); e.stopPropagation(); copySectionLink(al.dataset.copy); return; }
    const gear = e.target.closest("[data-gear]");
    if (gear) { e.stopPropagation(); gear.closest(".layoutpick").classList.toggle("open"); return; }
    const lay = e.target.closest("[data-layout]");
    if (lay) { setLayout(lay.dataset.layout); return; }
    const ds = e.target.closest("[data-mod]");
    if (ds) { setMod(ds.dataset.mod, ds.dataset.on === "1"); return; }
    const em = e.target.closest("[data-ecomode]");
    if (em) { setEcoMode(em.dataset.ecomode); writeHash(); return; }
    const ec = e.target.closest("[data-ecocat]");
    if (ec) { state.ecoCat = ec.dataset.ecocat; render(); writeHash(); return; }
    const et = e.target.closest("[data-ecotier]");
    if (et) {
      if (state.ecoMode !== "tiers") setEcoMode("tiers");
      const sec = document.getElementById("eco-tier-" + et.dataset.ecotier);
      if (sec) { sec.open = true; sec.scrollIntoView({ behavior: "smooth", block: "start" }); }
      writeHash({ sub: "tier-" + et.dataset.ecotier });
      return;
    }
    const enc = e.target.closest("[data-enemycat]");
    if (enc) { state.enemyCat = enc.dataset.enemycat; render(); writeHash(); window.scrollTo({ top: 0 }); return; }
    const goAI = e.target.closest("[data-goai]");
    if (goAI) {
      state.tab = "detection"; syncTabs(); deactivateMaps(); view.classList.remove("detail-open");
      window.scrollTo({ top: 0 });
      renderDetection().then(() => { const s = document.getElementById("det-priority"); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); });
      writeHash({ sub: "priority", push: true });
      return;
    }
    const goDet = e.target.closest("[data-godetect]");
    if (goDet) {
      state.tab = "detection"; syncTabs(); deactivateMaps(); view.classList.remove("detail-open");
      window.scrollTo({ top: 0 });
      renderDetection().then(() => { const s = view.querySelector('[data-anchor="enemies"]'); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); });
      writeHash({ sub: "enemies", push: true });
      return;
    }
    const goHS = e.target.closest("[data-gohs]");
    if (goHS) {
      state.tab = "ammo"; syncTabs(); deactivateMaps(); view.classList.remove("detail-open");
      const sb = $("#search"), clr = $("#searchClear");
      if (sb) sb.value = ""; if (clr) clr.hidden = true; state.q = ""; // "all calibers" => clear any filter
      render();
      requestAnimationFrame(() => { const s = document.getElementById("ammo-headshots"); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); });
      writeHash({ sub: "headshots", push: true });
      return;
    }
    const lk = e.target.closest("[data-lootkind]");
    if (lk) { state.lootKind = lk.dataset.lootkind; render(); writeHash(); return; }
    // Drops "How drops work" panel: jump to a crate type's source card…
    const gsrc = e.target.closest("[data-gosrc]");
    if (gsrc) {
      const key = gsrc.dataset.gosrc;
      const go = () => { const d = document.getElementById("loot-src-" + key); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); } };
      if (state.lootKind !== "all") { state.lootKind = "all"; Promise.resolve(render()).then(go); } else go();
      writeHash({ sub: key });
      return;
    }
    // Economy row -> the Drops tab, searched for that item: every source that can give it.
    const gdrop = e.target.closest("[data-godrops]");
    if (gdrop) {
      state.tab = "loot"; state.lootKind = "all"; syncTabs(); deactivateMaps(); view.classList.remove("detail-open");
      const sb = $("#search"), clr = $("#searchClear");
      state.q = gdrop.dataset.godrops; if (sb) sb.value = state.q; if (clr) clr.hidden = false;
      Promise.resolve(render()).then(() => window.scrollTo({ top: 0 })); writeHash({ push: true });
      return;
    }
    // …or hop to another tab (e.g. Armaments Bin -> Ammo, boss codex -> Enemies).
    const gtab = e.target.closest("[data-gotab]");
    if (gtab) {
      state.tab = gtab.dataset.gotab; syncTabs(); deactivateMaps(); view.classList.remove("detail-open");
      const sb = $("#search"), clr = $("#searchClear"); if (sb) sb.value = ""; if (clr) clr.hidden = true; state.q = "";
      render(); window.scrollTo({ top: 0 }); writeHash({ push: true });
      return;
    }
    // a container card's "How tiers work" link -> back up to the model (revealing it if a search hid it).
    const gsm = e.target.closest("[data-gosrc-model]");
    if (gsm) {
      const go = () => { const p = view.querySelector('.dropmodel [data-anchor="tier-budget"]') || view.querySelector(".dropmodel"); if (p) p.scrollIntoView({ behavior: "smooth", block: "start" }); };
      if (state.q) { state.q = ""; const sb = $("#search"), clr = $("#searchClear"); if (sb) sb.value = ""; if (clr) clr.hidden = true; Promise.resolve(render()).then(go); }
      else go();
      writeHash({ sub: "how-it-works" });
      return;
    }
    const ge = e.target.closest("[data-goeco]");
    if (ge) {
      state.tab = "economy"; state.ecoCat = "all"; syncTabs(); deactivateMaps(); view.classList.remove("detail-open");
      const sb = $("#search"), clr = $("#searchClear");
      if (sb) { sb.value = ge.dataset.goeco; } if (clr) clr.hidden = false;
      state.q = ge.dataset.goeco.toLowerCase();
      render(); window.scrollTo({ top: 0 });
      writeHash({ push: true });
      return;
    }
    const el = e.target.closest("[data-weapon],[data-att],[data-goatt],[data-goweapon],[data-back]");
    if (!el) return;
    if (el.dataset.back !== undefined) { view.classList.remove("detail-open"); render(); writeHash(); return; }
    if (el.dataset.weapon) { state.weapon = el.dataset.weapon; openDetail(); }
    else if (el.dataset.att) { state.att = el.dataset.att; openDetail(); }
    else if (el.dataset.goatt) { state.tab = "attachments"; state.att = el.dataset.goatt; syncTabs(); openDetail(); }
    else if (el.dataset.goweapon) { state.tab = "weapons"; state.weapon = el.dataset.goweapon; syncTabs(); openDetail(); }
  });

  // close the layout menu on any click outside it
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".layoutpick")) document.querySelectorAll(".layoutpick.open").forEach((p) => p.classList.remove("open"));
  });
}
function syncTabs() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  // Where the strip scrolls, bring the active tab into it (a deep link to Changelog on a phone
  // would otherwise open with its tab off the edge). scrollLeft, not scrollIntoView, so the page
  // itself never moves.
  const bar = $(".tabs"), a = bar && bar.querySelector(".tab.active");
  if (!a || bar.scrollWidth <= bar.clientWidth) return;
  if (a.offsetLeft < bar.scrollLeft) bar.scrollLeft = a.offsetLeft - 16;
  else if (a.offsetLeft + a.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = a.offsetLeft + a.offsetWidth - bar.clientWidth + 16;
}
function openDetail() { view.classList.add("detail-open"); render(); window.scrollTo({ top: 0 }); writeHash({ push: true }); }

/* ---------- maps tab: lazy Leaflet + hand off to the FWMaps module ---------- */
let mapsBooted = false, leafletPromise = null, mapsWriterSet = false;

function ensureLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "assets/vendor/leaflet.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "assets/vendor/leaflet.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Leaflet failed to load"));
    document.head.appendChild(s);
  });
  return leafletPromise;
}

function positionMaps() {
  // Pin the full-bleed atlas just below the top bar + tab strip. The weapon
  // searchwrap is hidden in maps mode, so the tab strip's bottom is the top edge.
  window.scrollTo(0, 0);
  const tabs = document.querySelector(".tabs");
  document.documentElement.style.setProperty("--maps-top", Math.round(tabs.getBoundingClientRect().bottom) + "px");
}

async function activateMaps(route) {
  document.body.classList.add("maps-active");
  positionMaps();
  try {
    await ensureLeaflet();
    // hand the atlas a writer so map/layer/bg changes flow back into the URL
    if (window.FWMaps && !mapsWriterSet) { window.FWMaps.setRouteWriter((rs) => writeHashRaw("#/" + rs)); mapsWriterSet = true; }
    if (!mapsBooted) { await window.FWMaps.init(route || null); mapsBooted = true; } // guard AFTER success so a failed first boot stays retryable
    else if (route && (route.map || (route.layers && route.layers.length) || route.bg != null)) { await window.FWMaps.openRoute(route); }
    window.FWMaps.invalidateSize();
    if (window.FWMaps.syncRoute) window.FWMaps.syncRoute(); // keep the URL == the atlas
  } catch (e) {
    const lt = document.getElementById("loading-text"), l = document.getElementById("loading");
    if (lt) lt.textContent = "Map failed to load: " + e.message;
    if (l) l.classList.add("show");
  }
}

function deactivateMaps() { document.body.classList.remove("maps-active"); }

window.addEventListener("resize", () => { if (document.body.classList.contains("maps-active")) positionMaps(); });

/* ---------- list layout (List / Grid / Split), chosen from the gear menu ---------- */
function applyLayout() {
  document.body.classList.remove("wl-list", "wl-grid", "wl-split");
  document.body.classList.add("wl-" + state.layout);
}
function setLayout(mode) {
  if (!["list", "grid", "split"].includes(mode)) return;
  state.layout = mode;
  try { localStorage.setItem("fw:wlayout", mode); } catch (e) {}
  applyLayout();
  render();
}
function layoutBar(count, noun) {
  const opt = (m, ico, label) =>
    `<button type="button" data-layout="${m}" class="${state.layout === m ? "active" : ""}"><span class="ico">${ico}</span>${label}</button>`;
  return `<div class="viewbar"><span class="viewbar-title">${count} ${esc(noun)}</span>
    <div class="layoutpick">
      <button type="button" class="gear" data-gear title="Change layout" aria-label="Change layout">&#9881;</button>
      <div class="layoutmenu" role="menu">
        ${opt("split", "&#9707;", "Split view")}
        ${opt("grid", "&#9638;", "Compact grid")}
        ${opt("list", "&#9776;", "Vertical list")}
      </div>
    </div></div>`;
}

function setEcoMode(mode) {
  if (!["tiers", "density"].includes(mode)) return;
  state.ecoMode = mode;
  try { localStorage.setItem("fw:ecomode", mode); } catch (e) {}
  render();
}

/* ---------- render dispatch ---------- */
// render() dispatches to the active tab, then decorates the fresh DOM with the
// per-section link icons. It returns a promise that resolves after decoration so
// the router can scroll to a deep-link anchor once the (possibly async) tab is up.
function render() {
  const p = dispatch();
  return Promise.resolve(p).then(() => { if (state.tab !== "maps") decorateAnchors(); });
}
function dispatch() {
  if (state.tab === "maps") return; // the Maps tab is driven by activateMaps(), not #view
  if (state.tab === "weapons") return renderWeapons();
  else if (state.tab === "attachments") return renderAttachments();
  else if (state.tab === "muzzles") return renderMuzzles();
  else if (state.tab === "ammo") return renderAmmo();
  else if (state.tab === "stats") return renderStats();
  else if (state.tab === "detection") return renderDetection();
  else if (state.tab === "enemies") return renderEnemies();
  else if (state.tab === "factions") return renderFactions();
  else if (state.tab === "economy") return renderEconomy();
  else if (state.tab === "crafting") return renderCrafting();
  else if (state.tab === "changelog") return renderChangelog();
  else return renderLoot();
}
// Search ignores spacing and punctuation, so the game's own naming can't hide an item:
// "toolset" has to find "Octogirl's Tool Set", "octogirls" has to find "Octogirl's".
// Plain substring first (cheap, and the common case), loose compare only as a fallback.
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const match = (name) => {
  if (!state.q) return true;
  const n = String(name == null ? "" : name).toLowerCase();
  if (n.includes(state.q)) return true;
  const sq = squash(state.q);
  return !!sq && squash(n).includes(sq);
};

/* ---------- weapons tab ---------- */
function renderWeapons() {
  const groups = {};
  DATA.weapons.filter((w) => match(w.name)).forEach((w) => (groups[w.class] = groups[w.class] || []).push(w));
  let list = "";
  const order = DATA.classOrder.concat(Object.keys(groups).filter((c) => !DATA.classOrder.includes(c)));
  order.forEach((cls) => {
    const ws = groups[cls]; if (!ws) return;
    list += `<div class="grp">${esc(cls)}</div>`;
    ws.sort((a, b) => a.name.localeCompare(b.name)).forEach((w) => {
      const wm = weaponMod(w.name);
      const dot = wm ? `<span class="ds-dot" title="Changed by ${esc(wm.meta.name)}"></span>` : "";
      list += `<button class="row ${state.weapon === w.name ? "sel" : ""}" data-weapon="${esc(w.name)}">
        <span class="rname">${esc(w.name)}${dot}</span>
        <span class="rmeta"><span class="count">${w.total}</span></span></button>`;
    });
  });
  if (!list) list = `<p class="empty">No weapons match &ldquo;${esc(state.q)}&rdquo;.</p>`;

  const detail = state.weapon && idx.weaponByName[state.weapon]
    ? weaponDetail(idx.weaponByName[state.weapon])
    : `<div class="placeholder">Pick a weapon to see everything that fits it.</div>`;
  view.innerHTML = datasetBar() + layoutBar(DATA.weapons.length, "weapons") + `<div class="panes"><div class="list">${list}</div><div class="detail">${detail}</div></div>`;
}

// map a weapon's (wiki) ammo string to an ammo.json key, then look it up in the
// catalogue. .50 PST maps to a real round with a value but no headshot entry;
// Nitro Express has no catalogued ammo item at all (-> null).
function ammoToCal(ammo) {
  ammo = (ammo || "").toLowerCase();
  if (ammo.includes("20x105")) return "20mm";
  if (ammo.includes(".50 bmg")) return "50cal";
  if (ammo.includes(".50 pst")) return "50PST";
  if (ammo.includes("nitro")) return null; // Nitro Express has no catalogued ammo item
  if (ammo.includes("12.7x55")) return "127";
  if (ammo.includes(".45 acp")) return "45acp";
  if (ammo.includes(".357")) return "357";
  if (ammo.includes(".308")) return "308";
  if (ammo.includes("12-gauge") || ammo.includes("buckshot")) return "12g";
  if (ammo.includes("40mm")) return "40mmHE";
  if (ammo.includes("5.56")) return "556";
  if (ammo.includes("5.45")) return "545";
  if (ammo.includes("7.62x39")) return "762";
  if (ammo.includes("7.62x54")) return "54R";
  if (ammo.includes("5.7x28")) return "57x28";
  if (ammo.includes("9x19") || ammo.includes("9mm")) return "919";
  return null;
}
// Band against the baseline, from the multiplier actually on screen. A mod overlay can move it
// (Heavy Rifles sets 12.7 subsonic to x5) while ammo.json's `band` still describes vanilla, which
// is how the table labelled a x5 round "baseline".
const hsBand = (m) => { const b = (AMMO && AMMO.headshotBaseline) || 1.5; return m > b ? "high" : m < b ? "low" : "base"; };
function headshotFor(ammo) {
  const key = ammoToCal(ammo);
  const a = key && AMMO && AMMO.byKey[key];
  if (a && a.headshot != null) return { label: a.name, multi: a.headshot, band: hsBand(a.headshot), fallback: !!a.headshotFallback };
  // Nitro Express has no ammo item, and no headshot row either, so the game scores it at the
  // same no-row fallback as .50 PST (ammo.json headshotModel.noRowMulti).
  const m = AMMO && AMMO.headshotModel;
  if (!key && /nitro/i.test(ammo || "") && m) return { label: "Nitro Express", multi: m.noRowMulti, band: hsBand(m.noRowMulti), fallback: true };
  return null;
}
// Share of a standard infantry health bar one head hit removes. The game tops a head hit up to
// damage x caliber x type x (max health / hpDivisor), so health cancels out and the share is
// damage x caliber / hpDivisor (ammo.json headshotModel, read from the enemy blueprint). Null for
// shotguns: pellets are scored one at a time and only gain on high-health targets.
function headshotShare(damage, pellets, multi) {
  const div = AMMO && AMMO.headshotModel && AMMO.headshotModel.hpDivisor;
  if (!div || !damage || multi == null || (pellets || 1) !== 1) return null;
  return (damage * multi) / div;
}
const hsPct = (f) => `${Math.round(f * 100)}%`;
const hsHits = (f) => Math.ceil(1 / f - 1e-9);

function partEffects(e) {
  if (!e) return "";
  const out = [];
  if (e.mag != null) out.push(e.mag + "-round magazine");
  if (e.acc) out.push("Accuracy +" + (e.acc * 100).toFixed(1) + "%");
  if (e.stab) out.push("Stability +" + (e.stab * 100).toFixed(1) + "%");
  if (e.recoil) out.push("Recoil " + (e.recoil * 100).toFixed(1) + "%");
  if (e.rof) out.push("RoF " + (e.rof > 0 ? "+" : "") + e.rof);
  if (e.dmg) out.push("Damage " + (e.dmg > 0 ? "+" : "") + e.dmg);
  if (e.fov) out.push("FOV " + e.fov);
  return out.join(" · ");
}

function weaponDetail(w) {
  const st = idx.weaponSubtype[w.name];
  const needs = w.needsPart || {};
  let anyReq = false;
  let html = `<button class="backbtn" data-back>&larr; all weapons</button><div class="card" data-anchor="${esc(idx.slugByWeapon[w.name] || slugify(w.name))}">
    <div class="dhead"><h2>${esc(w.name)}</h2><span class="badge gold">${esc(w.class)}</span>
      <span class="badge">${w.total} attachments</span>${(() => { const m = weaponMod(w.name); return m ? `<span class="badge rust" title="Stats reflect ${esc(m.meta.name)}">${esc(modBadge(m))}</span>` : ""; })()}</div>`;
  const ws = WEAPONS && WEAPONS[w.name.toLowerCase()];
  if (ws) {
    const rows = WSTAT_ROWS.filter(([k]) => ws[k] != null).map(([k, label, fmt]) => {
      const note = WSTAT_NOTES[k];
      const mark = note ? ` <span class="statnote" tabindex="0" role="note" aria-label="${esc(label + ": " + note)}">*<span class="tip">${esc(note)}</span></span>` : "";
      return `<div class="stat${k === "accuracy" || k === "magazine" ? " key" : ""}"><div class="k">${esc(label)}${mark}</div><div class="v">${esc(String(fmt(ws[k], ws)))}</div></div>`;
    }).join("");
    if (rows) html += `<div class="statgrid">${rows}</div>`;
    if (ws.ammo) html += `<p class="legend"><b>Ammo:</b> ${esc(ws.ammo)}</p>`;
    const hs = ws.ammo ? headshotFor(ws.ammo) : null;
    if (hs) {
      const f = headshotShare(ws.damage, ws.pellets, hs.multi);
      html += `<p class="legend"><b>Headshot:</b> <b class="hs-${hs.band}">×${hs.multi}</b> <span style="color:var(--dim)">per-caliber (${esc(hs.label)})${hs.fallback ? ` &mdash; this round has no headshot bonus of its own, so it counts as ×${hs.multi}` : ""}${f ? ` &mdash; a head hit takes <b>${hsPct(f)}</b> of a standard infantry health bar${hsHits(f) === 1 ? ", so one drops it" : ` (${hsHits(f)} to drop one)`}` : ""}.</span> <button class="linklike" data-gohs>how headshots work &rarr;</button></p>`;
    }
    html += `<p class="legend">Stats marked <span class="req">*</span> are display aggregates the game computes &mdash; hover them for what they measure (or see the <b>Stats</b> tab).${ws.internal ? ` <span style="color:var(--dim)">&middot; id ${esc(ws.internal)}</span>` : ""}</p>`;
  }
  const wp = PARTS && PARTS.byWeaponLC && PARTS.byWeaponLC[w.name.toLowerCase()];
  if (wp) {
    html += `<div class="section"><h3>Parts <span class="c">unlock at weapon level</span></h3>`;
    (PARTS.slotOrder || []).forEach((slot) => {
      const list = wp[slot];
      if (!list || !list.length) return;
      html += `<div class="lab">${esc(slot)}</div><div class="chips">`;
      list.forEach((p) => {
        const tip = [partEffects(p.effects), p.buy ? Number(p.buy).toLocaleString() + " cr" : ""].filter(Boolean).join(" · ");
        const lvl = (p.level != null) ? `<span class="lvl">L${p.level}</span>` : "";
        const cap = (p.effects && p.effects.mag != null) ? `<span class="cap">${p.effects.mag} rnd</span>` : "";
        const label = p.short || p.name;
        const nu = p.mod ? `<span class="ds-new">new</span>` : "";
        const full = [(p.name && p.name !== label) ? p.name : "", tip].filter(Boolean).join(" — ");
        html += `<span class="chip part${p.mod ? " mod" : ""}"${full ? ` tabindex="0" role="note" aria-label="${esc(label + ": " + full)}"` : ""}>${esc(label)}${lvl}${cap}${nu}${full ? `<span class="tip">${esc(full)}</span>` : ""}</span>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
  }
  if (st) {
    html += `<div class="callout"><b>Muzzle mount: ${st} &mdash; ${esc(SUBTYPE_LABEL[st] || "")}.</b>
      Only accepts muzzle devices from this family.</div>`;
  }
  CAT_ORDER.forEach((code) => {
    const items = w.byCategory[code]; if (!items || !items.length) return;
    html += `<div class="section"><h3>${esc(CATLABEL[code])} <span class="c">&times;${items.length}</span></h3><div class="chips">`;
    items.forEach((nm) => {
      const req = needs[nm];
      if (req) anyReq = true;
      html += `<button class="chip" data-goatt="${esc(code + ":" + nm)}"${req ? ` title="Needs first: ${esc(req)}"` : ""}>${esc(nm)}${req ? '<sup class="req">*</sup>' : ""}</button>`;
    });
    html += `</div></div>`;
  });
  if (anyReq) html += `<p class="legend"><span class="req">*</span> the slot must be unlocked first by fitting a specific barrel / handguard / upper (hover, or open the part, for which one).</p>`;
  if (w.total === 0) html += `<p class="empty">No attachments listed for this weapon.</p>`;
  html += `</div>`;
  return html;
}

/* ---------- attachments tab ---------- */
function renderAttachments() {
  let list = "";
  CAT_ORDER.forEach((code) => {
    const items = DATA.attachments.filter((a) => a.category === code && match(a.name));
    if (!items.length) return;
    list += `<div class="grp">${esc(CATLABEL[code])}</div>`;
    items.forEach((a) => {
      const nu = affected.attAdded.has(a.id) ? `<span class="ds-new">new</span>` : "";
      list += `<button class="row ${state.att === a.id ? "sel" : ""}" data-att="${esc(a.id)}">
        <span class="rname">${esc(a.name)}${nu}</span>
        <span class="rmeta"><span class="count">${a.compatible.length}</span></span></button>`;
    });
  });
  if (!list) list = `<p class="empty">No attachments match &ldquo;${esc(state.q)}&rdquo;.</p>`;
  const detail = state.att && idx.attById[state.att]
    ? attDetail(idx.attById[state.att])
    : `<div class="placeholder">Pick an attachment to see which weapons it fits.</div>`;
  view.innerHTML = datasetBar() + layoutBar(DATA.attachments.length, "attachments") + `<div class="panes"><div class="list list-att">${list}</div><div class="detail">${detail}</div></div>`;
}

function attDetail(a) {
  let html = `<button class="backbtn" data-back>&larr; all attachments</button><div class="card" data-anchor="${esc(idx.slugByAtt[a.id] || slugify(a.id))}">
    <div class="dhead"><h2>${esc(a.name)}</h2><span class="badge olive">${esc(CATLABEL[a.category])}</span>
      ${a.subtype ? `<span class="badge gold">${esc(a.subtype)} · ${esc(SUBTYPE_LABEL[a.subtype] || "")}</span>` : ""}</div>`;
  // stats
  const stats = [];
  if (a.buy) stats.push(["Base value", (+a.buy).toLocaleString() + " cr"]);
  if (a.level && a.level !== "0") stats.push(["Weapon level", a.level]);
  if (a.accuracy && a.accuracy !== "0.0") stats.push(["Accuracy", a.accuracy]);
  if (a.stability && a.stability !== "0.0") stats.push(["Stability", a.stability]);
  if (a.weight) stats.push(["Weight", a.weight + " kg"]);
  if (a.volume) stats.push(["Volume", a.volume]);
  if (a.suppressed) stats.push(["Suppressed", "Yes"]);
  if (stats.length) {
    html += `<div class="statgrid">`;
    stats.forEach(([k, v]) => (html += `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`));
    html += `</div>`;
  }
  // compatible weapons grouped by class
  const groups = {};
  a.compatible.forEach((wn) => {
    const w = idx.weaponByName[wn];
    const cls = w ? w.class : "Other";
    (groups[cls] = groups[cls] || []).push(wn);
  });
  html += `<div class="section"><h3>Fits ${a.compatible.length} weapon${a.compatible.length === 1 ? "" : "s"}</h3>`;
  const order = DATA.classOrder.concat(Object.keys(groups).filter((c) => !DATA.classOrder.includes(c)));
  order.forEach((cls) => {
    if (!groups[cls]) return;
    html += `<div class="lab" style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin:8px 0 5px">${esc(cls)}</div><div class="chips">`;
    groups[cls].sort().forEach((wn) => {
      const req = a.reqParts && a.reqParts[wn];
      html += `<button class="chip" data-goweapon="${esc(wn)}"${req ? ` title="On ${esc(wn)}: needs ${esc(req)}"` : ""}>${esc(wn)}${req ? '<sup class="req">*</sup>' : ""}</button>`;
    });
    html += `</div>`;
  });
  if (a.reqParts && Object.keys(a.reqParts).length)
    html += `<p class="legend"><span class="req">*</span> on that weapon, this slot must be unlocked by fitting a specific barrel / handguard / upper first.</p>`;
  if (!a.compatible.length) html += `<p class="empty">No compatible weapons listed.</p>`;
  html += `</div></div>`;
  return html;
}

/* ---------- muzzle guide tab ---------- */
function renderMuzzles() {
  let html = `<div class="mz-intro callout">In-game, muzzle devices are just labelled <b>A&ndash;Q</b> (and suppressors <b>A&ndash;F</b>)
    with no hint of what fits where. They actually come in <b>5 mount families</b>. A device only fits weapons in its family;
    the letter doesn't say which family.</div><div class="mzgrid">`;
  SUBTYPE_ORDER.forEach((st) => {
    const s = idx.subtypes[st]; if (!s) return;
    if (state.q) {
      const hit = [...s.weapons].some((w) => match(w)) || s.mzd.concat(s.smzd).some((m) => match(m));
      if (!hit) return;
    }
    const weapons = [...s.weapons].sort();
    html += `<div class="mzcard" data-anchor="${st.toLowerCase()}"><h3>${st}</h3><div class="fam">${esc(SUBTYPE_LABEL[st] || "")}</div>
      <div class="lab">Muzzle devices</div><div class="chips">
      ${s.mzd.map((m) => `<button class="chip" data-goatt="${esc("MZD:" + m)}">${esc(m)}</button>`).join("")}</div>`;
    if (s.smzd.length) html += `<div class="lab">Suppressed</div><div class="chips">
      ${s.smzd.map((m) => `<button class="chip" data-goatt="${esc("SMZD:" + m)}">${esc(m)}</button>`).join("")}</div>`;
    html += `<div class="lab">Fits these weapons</div><div class="chips">
      ${weapons.map((w) => `<button class="chip" data-goweapon="${esc(w)}">${esc(w)}</button>`).join("")}</div></div>`;
  });
  html += `</div>`;
  view.innerHTML = html;
}

/* ---------- stats guide tab ---------- */
function renderStats() {
  view.classList.remove("detail-open");
  view.innerHTML = `
  <div class="guide">
    <div class="callout" style="margin-top:16px">
      <b>The weapon card shows aggregated display numbers.</b> Several of them don't
      change what they look like they change. Here's what each stat <em>actually</em> does.
    </div>

    <div class="card" data-anchor="basics">
      <div class="section" style="margin-top:0"><h3>The two stats with a visible effect</h3></div>
      <div class="gdef"><span class="term">Accuracy</span><span>How tightly your shots land. At ~90 accuracy a gun puts rounds dead-centre (hip-fire <em>or</em> aimed); lower accuracy widens a random spread cone.</span></div>
      <div class="gdef"><span class="term">Magazine capacity</span><span>Rounds per reload. Obvious, and real. Note: mag size is changed by <b>weapon parts</b> (different magazines), <b>not</b> by attachments.</span></div>
    </div>

    <div class="card" data-anchor="display-only">
      <div class="section" style="margin-top:0"><h3>Stats that are display-only, buggy, or disputed</h3></div>
      <div class="gdef"><span class="term">Recoil</span><span>Shown as a single number but it's a <b>compound</b> of hidden values ("wrist" + "arm" recoil). It's theorised to drive <em>camera shake</em> only — it does <b>not</b> move your point of aim under fire. The wild numbers you see when swapping parts are aggregation errors, not real changes.</span></div>
      <div class="gdef"><span class="term">Stability</span><span><b>Currently unprovable.</b> Attachments still carry a Stability number and the game still shows it, but the per-weapon curves that turned it into bullet spread were <b>removed from the build</b>. We previously published what those curves did; that analysis no longer describes the shipping game. Full detail in <a href="#/stats/underhood">Under the hood</a>, just below.</span></div>
      <div class="gdef"><span class="term">The stat card as a whole</span><span>It aggregates several parameters into display values and is frequently wrong when a weapon is modified.</span></div>
    </div>

    <div class="card" id="underhood" data-anchor="underhood">
      <div class="section" style="margin-top:0"><h3>Under the hood: handling, and what happened to Stability <span class="badge gold">from the game files</span></h3></div>
      <p>Read straight out of the shipping game's weapon code (the compiled <code>FWWeapon</code> module), "handling" is actually <b>three separate systems</b> — which is exactly why the card confuses everyone:</p>
      <div class="gdef"><span class="term">1 · Recoil — the kick</span><span>The visual muzzle climb: <code>RecoilWristYaw/Pitch</code>, <code>RecoilArmAngle</code>, <code>RecoilWristRecoveryBlend</code>, <code>ScaleRecoilADS</code> — a wrist + arm model, which is why the displayed "Recoil" is a compound. Parts tune it through <code>RecoilWristRelBuff</code> / <code>RecoilArmRelBuff</code>. <b>Stability is not an input here</b>, so "stability doesn't change recoil" is literally correct.</span></div>
      <div class="gdef"><span class="term">2 · Dispersion — the spread</span><span>Your real accuracy under fire: a spread cone that grows at <code>MaxDispersionRate</code> while you hold the trigger and shrinks via <code>DispersionCoolDownStart/Rate</code> once you stop. These are still on every weapon — but they are now <b>fixed constants per gun</b> (the AK sits at 3.0 / 0.33 s / 0.175, the S12 at 1.0). Until build 24479102 each weapon also shipped three curves that converted the <b>Stability</b> stat into these numbers. Those curves are gone — see below.</span></div>
      <div class="gdef"><span class="term">3 · Aim-lag — the sway/settle</span><span>A spring system (<code>AimLagSpringStiffness/Damping/Mass</code>, <code>MaxAimLagYaw/Pitch</code>) with <code>StabilizeFireTime</code> and the <code>StabilizeTimeRelBuff</code> / <code>StabilizeScalarRelBuff</code> buffs — how fast the reticle re-settles after firing or moving. This is what item cards call "stabilization speed / length".</span></div>
      <p class="gnote"><b>The kick/spread split still holds:</b> testers who watched the <em>recoil kick</em> and saw no change were looking at the wrong system. <b>Recoil = kick, Dispersion = spread, Stabilize = sway.</b> What has changed is whether Stability still drives the middle one.</p>

      <div class="section"><h3>The Stability curves were deleted <span class="c">build 24479102, still absent at ${STATS_BUILD()}</span></h3></div>
      <p class="gnote">This page used to publish a table of what Stability did to dispersion, decoded from each weapon's <code>Stability…DispersionCurve</code> assets. <b>Those assets are no longer in the game.</b> Checked against a full mount of the shipping paks at build ${STATS_BUILD()}:</p>
      <div class="gtable-wrap"><table class="gtable">
        <thead><tr><th>What we look for</th><th>Found at ${STATS_BUILD()}</th><th>Was</th></tr></thead>
        <tbody>
          <tr><td>Files matching <code>*Stability*</code></td><td><b>0</b> of 76,321 packaged files</td><td>three curve assets per weapon</td></tr>
          <tr><td><code>UpgradeTuning</code> paths</td><td><b>0</b></td><td>the per-weapon tuning tree</td></tr>
          <tr><td>Player <code>DA_WPN_PLAYER_*_v2</code> tuning assets</td><td><b>0</b></td><td>one per gun</td></tr>
          <tr><td>Surviving <code>FC_*</code> curves</td><td><b>20</b>, all global (sway, ADS kick, stamina, shotgun falloff)</td><td>several hundred, mostly per-weapon</td></tr>
        </tbody>
      </table></div>
      <p class="gnote">Meanwhile the stat itself is <b>still there</b>: <code>WeaponPartStatsData</code> lists 633 attachment rows, <b>324</b> of them with a non-zero <code>Stability</code>, and that table is byte-for-byte identical to the previous build. So attachments still grant Stability, the card still displays it — but nothing we can find in the shipped data reads it any more.</p>
      <div class="callout" style="border-left-color:var(--rust)"><b>Verdict: we no longer know what Stability does.</b> The input survives and the transfer function is gone, so the old "higher Stability = tighter sustained fire" conclusion can't be re-derived from the current build — we've retired it rather than restate it. <b>The honest caveat:</b> this proves the <em>data-driven</em> path was removed, not that the stat is inert. The logic could have moved into compiled C++, which doesn't live in the asset tree and which we can't read this way. Until something in the build consumes it again, what Stability does is unproven.</div>
      <p class="legend">Method: property names from the shipping binary; asset inventory from a full CUE4Parse mount of the live paks (76,321 files) with a UE4SS-dumped type mapping. Weapon numbers on this site are read from the same mount — see the <b>Weapons</b> tab.</p>
    </div>

    <div class="card" data-anchor="damage">
      <div class="section" style="margin-top:0"><h3>Damage (the hidden part)</h3></div>
      <div class="gdef"><span class="term">Base damage</span><span>Tied to the weapon (balanced around caliber/type), <b>not</b> to which ammo you load. Every damage number on this site is now read from the weapon's own game asset, so it matches the live build rather than the wiki.</span></div>
      <div class="gdef"><span class="term">Shotguns: the number is <em>per pellet</em></span><span>This is the one stat that means something different from what you'd assume, and it's why community shotgun figures look ~200× off. The game stores <code>WeaponDamage</code> per <b>pellet</b> and fires <code>NumberOfBuckshots</code> = <b>20</b> of them — on all six shotguns; every other gun in the game fires 1. So the S12's 15 is <b>15 × 20 = 300</b> into a target that catches the whole spread, and the CLAW's 6.6 is <b>132</b>. Weapon cards here show all three numbers. Range matters too: <code>FC_ShotgunDamage_Falloff_All</code> is one of the few surviving global curves, so pellets lose damage with distance.</span></div>
      <div class="gdef"><span class="term">Critical / headshot damage</span><span>A per-<b>caliber</b> multiplier that lives on your <b>ammo</b>, not the gun &mdash; most rounds sit at the <b>1.5×</b> baseline, a few big single-shot calibers <b>triple</b> it and <b>shotguns are penalised</b>. It isn't applied to your damage directly: the game tops a head hit up in proportion to the target's <b>max health</b>, so a headshot removes a fixed share of the health bar &mdash; <b>damage &times; caliber &divide; ${(AMMO && AMMO.headshotModel && AMMO.headshotModel.hpDivisor) || 450}</b> &mdash; however tough the target is. Cyborg-types halve that, and Stalkers take no headshot bonus at all. <button class="linklike" data-gohs>See the per-caliber table on the <b>Ammo</b> tab &rarr;</button></span></div>
    </div>
    </div>

    <div class="card" data-anchor="attachment-effects">
      <div class="section" style="margin-top:0"><h3>What each attachment type really changes</h3></div>
      <p class="gnote">Within a category every item gives the <b>same</b> bonus — only the look differs (the displayed % also scales per weapon). Relative effect:</p>
      <div class="gtable-wrap"><table class="gtable">
        <thead><tr><th>Attachment</th><th>Accuracy</th><th>Handling*</th><th>Works?</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td>Optic (red dot)</td><td>—</td><td>—</td><td class="ok">yes</td><td><b>No stat change</b> — only the sight picture differs.</td></tr>
          <tr><td>Foregrip</td><td>+++</td><td>+++</td><td class="ok">yes</td><td>The <b>largest</b> accuracy and handling bonus of the common attachments.</td></tr>
          <tr><td>Muzzle device</td><td>+</td><td>+</td><td class="ok">yes</td><td>A small bonus, the same for every device in the category.</td></tr>
          <tr><td>Suppressor</td><td>+</td><td>+</td><td class="ok">yes</td><td>Quieter shots and a small bonus. A suppressed shot that misses an unaware enemy who isn't looking at you doesn't make it suspicious.</td></tr>
          <tr><td>Scope (magnified)</td><td>+++</td><td>+++</td><td class="bad">no</td><td>A large listed bonus and zoom; currently <b>non-functional</b>.</td></tr>
          <tr><td>Laser sight</td><td>+</td><td>+</td><td class="bad">no</td><td>A small listed bonus; currently <b>non-functional</b>.</td></tr>
          <tr><td>Flashlight</td><td>~</td><td>~</td><td class="bad">buggy</td><td>A negligible bonus; causes glare in fog.</td></tr>
        </tbody>
      </table></div>
      <p class="gnote">*Handling = the recoil and stabilisation numbers. Like accuracy, they're values the game computes for display rather than stored stats — see <a href="#/stats/underhood">Under the hood</a>.</p>
    </div>

    <div class="card" data-anchor="glossary">
      <div class="section" style="margin-top:0"><h3>Attachment stat glossary</h3></div>
      <div class="gdef"><span class="term">Accuracy</span><span>Tighter shot grouping.</span></div>
      <div class="gdef"><span class="term">Recoil (1st / 3rd person)</span><span>Camera kick you see while aiming / that others see. It doesn't shift your aim.</span></div>
      <div class="gdef"><span class="term">Stabilization speed / length</span><span>How fast, and for how long, the sight re-settles after a shot.</span></div>
      <div class="gdef"><span class="term">ADS speed</span><span>How quickly you aim down sights.</span></div>
      <div class="gdef"><span class="term">Reload speed</span><span>Reload time. (Attachments here don't change it — it's 0 across the board.)</span></div>
      <div class="gdef"><span class="term">FOV</span><span>Zoom, on scopes only.</span></div>
      <div class="gdef"><span class="term">Damage / Mag capacity</span><span>Not touched by attachments — those come from the weapon and its parts.</span></div>
    </div>

    <div class="callout">
      <b>Currently not working:</b> scopes, laser sights, bipods and bayonets. Flashlights work but cause
      glare in fog.
    </div>
    <p class="legend">Sources: weapon damage, rate of fire, magazine, weight, value, XP and calibre are decoded from the shipping game files (build ${STATS_BUILD()}). Accuracy, recoil and stability are not stored fields — those come from the <a href="https://theforeverwinter.wiki.gg/wiki/Weapons" target="_blank" rel="noopener">Weapons</a> &amp; <a href="https://theforeverwinter.wiki.gg/wiki/Weapon_Attachments" target="_blank" rel="noopener">Weapon Attachments</a> wiki pages plus community testing, and the devs flag them as WIP.</p>
  </div>`;
}

/* ---------- ammo tab ---------- */
async function renderAmmo() {
  view.classList.remove("detail-open");
  if (!AMMO) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading ammunition&hellip;</div>`;
    try {
      AMMO = await (await fetch("data/ammo.json", { cache: "no-cache" })).json();
      AMMO.byKey = {}; AMMO.ammo.forEach((a) => (AMMO.byKey[a.key] = a));
    } catch (e) { view.innerHTML = `<p class="empty">Could not load ammo data.<br><small>${esc(e.message)}</small></p>`; return; }
  }
  drawAmmo();
}

// which weapons fire each caliber — inverted live from the weapon list so it
// always tracks the Weapons tab (variants share their parent caliber's guns).
function ammoUsedBy() {
  const by = {};
  ((DATA && DATA.weapons) || []).forEach((w) => {
    const ws = WEAPONS && WEAPONS[w.name.toLowerCase()];
    const key = ws && ws.ammo ? ammoToCal(ws.ammo) : null;
    if (key) (by[key] = by[key] || []).push(w.name);
  });
  return by;
}

const ammoUnit = (u) => ` <small style="font-size:11px;color:var(--dim)">${u}</small>`;
function ammoCard(a, usedBy) {
  const cell = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const grid = [
    a.headshot != null ? `<div class="stat"><div class="k">Headshot</div><div class="v hs-${hsBand(a.headshot)}">&times;${a.headshot}</div></div>` : "",
    a.value != null ? cell("Sell value", bNum(a.value) + ammoUnit("cr")) : "",
    a.xp != null ? cell("Extract XP", a.xp) : "",
    a.weight != null ? cell("Weight", a.weight + ammoUnit("kg")) : "",
    a.volume != null ? cell("Volume", a.volume) : "",
  ].filter(Boolean).join("");
  const guns = usedBy[a.weaponKey] || [];
  const chips = guns.length
    ? `<div class="ammo-usedby"><div class="lab">Used by</div><div class="chips">${guns.map((g) => `<button class="chip" data-goweapon="${esc(g)}">${esc(g)}</button>`).join("")}</div></div>`
    : "";
  return `<div class="ammo-card" data-anchor="${esc(a.key)}">
    <div class="ammo-head"><span class="ammo-name">${esc(a.name)}</span>
      ${a.faction ? `<span class="badge">${esc(a.faction)}</span>` : ""}${(() => { const m = ammoMod(a.key); return m ? `<span class="badge rust" title="Changed by ${esc(m.meta.name)}">${esc(modBadge(m))}</span>` : ""; })()}</div>
    ${grid ? `<div class="statgrid ammo-stats">${grid}</div>` : ""}
    ${a.desc ? `<p class="ammo-desc">${esc(a.desc)}</p>` : ""}
    ${chips}
  </div>`;
}

function drawAmmo() {
  const D = AMMO;
  const usedBy = ammoUsedBy();
  const matchAmmo = (a) => match(a.name) || match(a.desc || "") || match(a.key);
  const base = D.headshotBaseline;

  let html = `<div class="guide">` + datasetBar() +
    `<div class="callout" style="margin-top:16px"><b>Every round in the game.</b> ${esc(D.note)}</div>`;

  // headshot-at-a-glance table (the datamined per-caliber multipliers, moved here
  // from Stats). It's a reference chart, so it's shown only when not searching.
  if (!state.q) {
    const hm = D.headshotModel || {};
    const gunShare = (a) => {   // head-hit share across the guns that fire this round, e.g. "50–67%"
      if (a.category === "explosive" || a.category === "grenade") return "";
      const fs = (usedBy[a.weaponKey] || []).map((g) => {
        const ws = WEAPONS && WEAPONS[g.toLowerCase()];
        return ws ? headshotShare(ws.damage, ws.pellets, a.headshot) : null;
      }).filter((f) => f != null).sort((x, y) => x - y);
      if (!fs.length) return "";
      const lo = hsPct(fs[0]), hi = hsPct(fs[fs.length - 1]);
      return lo === hi ? lo : `${lo}–${hi}`;
    };
    const hsRows = D.ammo.filter((a) => a.headshot != null).slice()
      .sort((x, y) => y.headshot - x.headshot || x.name.localeCompare(y.name));
    const ex = hm.exceptions || [];
    const half = ex.filter((e) => e.multi > 0 && e.multi < 1), none = ex.filter((e) => e.multi === 0);
    const shot = D.ammo.find((a) => a.key === "12g");
    const list = (xs) => xs.map((e) => esc(e.enemy)).join(", ").replace(/, ([^,]*)$/, " and $1");
    html += `<div class="card" id="ammo-headshots" data-anchor="headshots"><div class="section" style="margin-top:0"><h3>Headshot multipliers <span class="c">per caliber &middot; ${base}&times; baseline</span></h3></div>
      <p class="gnote">The multiplier lives on the <b>ammo</b>, not the gun &mdash; but it isn't simply applied to your damage. On a head hit the game tops the hit up to <b>damage &times; this &times; the target's type factor &times; its max health &divide; ${hm.hpDivisor || "450"}</b>. The health cancels out: a head hit takes <b>damage &times; multiplier &divide; ${hm.hpDivisor || "450"}</b> of a standard infantry health bar however much health it has, which is why one high-caliber head hit drops even a heavy.</p>
      <div class="gtable-wrap"><table class="gtable"><thead><tr><th>Caliber</th><th class="num">Headshot</th><th class="num">A head hit takes</th><th>vs ${base}&times; baseline</th></tr></thead><tbody>${
        hsRows.map((a) => { const band = hsBand(a.headshot); return `<tr><td>${esc(a.name)}</td><td class="num ${band === "high" ? "ok" : band === "low" ? "bad" : ""}"${a.headshotFallback ? ` title="This round has no headshot bonus of its own, so it counts as ×${a.headshot}"` : ""}>&times;${a.headshot}</td><td class="num">${gunShare(a) || `<span style="color:var(--dim)">&mdash;</span>`}</td><td>${band === "high" ? "higher" : band === "low" ? "lower" : "baseline"}</td></tr>`; }).join("")
      }</tbody></table></div>
      <p class="gnote"><b>A head hit takes</b> is the share of a standard infantry health bar one hit removes, across the guns that fire the round (100% or more = one shot drops it).${half.length ? ` ${list(half)} take ${half.every((e) => e.multi === half[0].multi) ? `&times;${half[0].multi} of it` : "less"}${none.length ? `, and ${list(none)} takes no headshot bonus at all` : ""}.` : ""} Gunhead's head-mounted guns never score one.${shot && shot.headshot ? ` Shotgun pellets are scored one at a time at &times;${shot.headshot}, so they only gain on targets with more than ${bNum(Math.round((hm.hpDivisor || 450) / shot.headshot))} health.` : ""}</p></div>`;
  }

  // one card per category, each holding its ammo rows
  let sections = "";
  D.categories.forEach((c) => {
    const list = D.ammo.filter((a) => a.category === c.key && matchAmmo(a));
    if (!list.length) return;
    sections += `<div class="card" data-anchor="${esc(c.key)}"><div class="section" style="margin-top:0"><h3>${esc(c.label)} <span class="c">&times;${list.length}</span></h3></div>
      <p class="gnote">${esc(c.note)}</p>
      ${list.map((a) => ammoCard(a, usedBy)).join("")}</div>`;
  });
  if (!sections && state.q) html += `<p class="empty">No ammo matches &ldquo;${esc(state.q)}&rdquo;.</p>`;
  else html += sections;

  html += `<p class="legend">Method: merged from <code>ItemDetailsData</code> (names, blurbs, weight/volume), <code>ValueV2_AMMO</code> (sell value + extraction XP) and <code>DT_CaliberToHeadshotMulti</code> via CUE4Parse (build ${D.build}). Which weapons fire each round is cross-referenced live against the Weapons list; the &ldquo;used by&rdquo; chips open the weapon.</p></div>`;
  view.innerHTML = html;
}

/* ---------- crafting / manufacturing tab ---------- */
async function renderCrafting() {
  view.classList.remove("detail-open");
  if (!CRAFT_V) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading crafting recipes&hellip;</div>`;
    try { CRAFT_V = await (await fetch("data/crafting.json", { cache: "no-cache" })).json(); }
    catch (e) { view.innerHTML = `<p class="empty">Could not load crafting data.<br><small>${esc(e.message)}</small></p>`; return; }
    CRAFT = composeCrafting(activeMods());
  }
  drawCrafting();
}

function recipeCard(r) {
  const io = (x) => `${x.qty > 1 ? `<span class="rq">${x.qty}&times;</span> ` : ""}${esc(x.name)}`;
  const ins = (r.inputs || []).map(io).join(`<span class="rplus">+</span>`) || "&mdash;";
  const outs = (r.outputs || []).map(io).join(`<span class="rplus">+</span>`) || "&mdash;";
  const req = (r.required && r.required.length) ? `<span class="craft-req" title="Requires ${esc(r.required.join(", "))}">&#128274; gated</span>` : "";
  const t = (r.time && r.time !== "Instant") ? `&#9201; ${esc(r.time)}` : "Instant";
  return `<div class="recipe">
    <div class="recipe-out">${outs}</div>
    <div class="recipe-in"><span class="rlab">from</span> ${ins}</div>
    <div class="recipe-meta"><span class="craft-time">${t}</span>${req}</div>
  </div>`;
}

function drawCrafting() {
  const D = CRAFT, q = state.q;
  const craftMods = activeMods().filter((m) => m.crafting && m.crafting.addGroups);
  const rb = craftMods.length > 0;
  const recMatch = (r) => !q || match(r.name)
    || (r.inputs || []).some((i) => match(i.name))
    || (r.outputs || []).some((o) => match(o.name));
  const cats = D.categoryOrder || [];
  const byCat = {};
  D.groups.forEach((g) => (byCat[g.category] = byCat[g.category] || []).push(g));
  const order = cats.map((c) => c.key).concat(Object.keys(byCat).filter((k) => !cats.some((c) => c.key === k)));

  let html = `<div class="guide craft">` + datasetBar() +
    `<div class="callout" style="margin-top:16px"><b>Manufacturing.</b> Every crafting recipe in the game, pulled straight from its data tables &mdash; what each makes, what it costs, and how long it takes.${rb ? ` Overlaid with ${craftMods.map((m) => `<b>${esc(m.meta.name)}</b>`).join(", ")}&rsquo;s added recipes.` : ""}</div>`;

  let any = false;
  order.forEach((ck) => {
    const gs = byCat[ck]; if (!gs) return;
    const label = (cats.find((c) => c.key === ck) || {}).label || ck;
    let inner = "";
    gs.forEach((g) => {
      const recs = (g.recipes || []).filter(recMatch);
      if (!recs.length) return;
      any = true;
      inner += `<div class="craft-group" data-anchor="craft-${esc(g.key)}"><div class="section" style="margin-top:0"><h3>${esc(g.name)}${g.mod ? ` <span class="ds-badge">${esc(modBadge(modById(g.mod)))}</span>` : ""} <span class="c">&times;${recs.length}</span></h3></div>${g.subtext ? `<p class="gnote">${esc(g.subtext)}</p>` : ""}<div class="craft-recipes">${recs.map(recipeCard).join("")}</div></div>`;
    });
    if (inner) html += `<div class="grp craft-cat">${esc(label)}</div>${inner}`;
  });
  if (!any) html += `<p class="empty">No recipes match &ldquo;${esc(q)}&rdquo;.</p>`;
  html += `<p class="legend">Source: datamined <code>DT_ManufactoringRecipies</code> + <code>DT_ManufactoringGroups</code>; ingredient names resolved via <code>ItemDetailsData</code> / <code>DanglyDetailsData</code>. Craft times are the game&rsquo;s real-world timers.</p></div>`;
  view.innerHTML = html;
}

/* ---------- detection / stealth tab ---------- */
let DET = null;
async function renderDetection() {
  view.classList.remove("detail-open");
  if (!DET) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading detection data…</div>`;
    try { DET = await (await fetch("data/detection.json", { cache: "no-cache" })).json(); }
    catch (e) { view.innerHTML = `<p class="empty">Could not load detection data.<br><small>${esc(e.message)}</small></p>`; return; }
  }
  const D = DET;
  const gm = D.globalModel;
  const num = (v) => (v === null || v === undefined) ? "—" : v;
  const mrow = (m) => {
    const good = m.acc >= 1 && m.decay <= 1;
    const bad = m.acc < 1 || m.decay > 1;
    const cls = good ? "ok" : (bad ? "bad" : "");
    const tag = good ? "stealthier" : (bad ? "easier to spot" : "mixed");
    return `<tr><td>${esc(m.factor)}</td><td class="${cls}">${tag}</td><td>${esc(m.effect)}</td></tr>`;
  };
  const erow = (e) => `<tr title="${esc(e.notes)}">
      <td>${esc(e.name)}<div class="esub">${esc(e.class)}</div></td>
      <td>${e.visionFar ? `${num(e.visionNear)} → ${num(e.visionFar)} m` : "—"}${e.visionPointBlank ? `<div class="esub">point-blank ${e.visionPointBlank} m</div>` : ""}</td>
      <td>${e.coneH ? e.coneH + "°" : "—"}</td>
      <td>${e.hearing ? e.hearing + " m" : "—"}${e.hearingViolent ? `<div class="esub">${e.hearingViolent} m violent</div>` : ""}</td>
      <td>${e.esp ? esc(e.esp) : "—"}</td></tr>`;
  // The noise card's summary line reads the rows it summarises, so a re-tune can't strand it
  // (the hardcoded "~3× louder" went stale when 25071553 moved walk 2.5→6 m and sprint 7.5→15 m).
  const nr = (a) => (D.noise.find((n) => n.action === a) || {}).radius;
  const walkR = nr("Walk"), sprintR = nr("Sprint"), gunLo = nr("Gunfire (rifle)"), gunHi = nr("Gunfire (LMG/shotgun)");
  const noiseSummary = [
    walkR && sprintR ? `A sprint carries ${Math.round((sprintR / walkR) * 10) / 10}× as far as a walk (${sprintR} m vs ${walkR} m)` : "",
    gunLo && gunHi ? `a single gunshot is heard ${gunLo === gunHi ? gunLo : `${gunLo}–${gunHi}`} m away` : "",
  ].filter(Boolean).join("; ");
  const nmax = Math.max(...D.noise.map((n) => n.radius || 0.1));
  const nrow = (n) => {
    const pct = Math.max(2, Math.round((Math.log10((n.radius || 0.5) + 1) / Math.log10(nmax + 1)) * 100));
    return `<div class="noise-row"><span class="noise-name">${esc(n.action)}</span>
      <span class="noise-bar"><span style="width:${pct}%"></span></span>
      <span class="noise-val">${n.radius === 0 ? esc(n.label || "silent") : (n.label ? esc(n.label) : n.radius + " m")}</span></div>`;
  };

  view.innerHTML = `<div class="guide">
    <div class="callout" style="margin-top:16px"><b>How enemies detect you:</b> sight, sound, and the through-wall ESP sense.
      Ranges are in metres.</div>

    <div class="card" data-anchor="senses">
      <div class="section" style="margin-top:0"><h3>The six ways they sense you</h3></div>
      ${D.senses.map((s) => `<div class="gdef"><span class="term">${esc(s.name)}</span><span>${esc(s.desc)}</span></div>`).join("")}
    </div>

    <div class="card" data-anchor="enemies">
      <div class="section" style="margin-top:0"><h3>Per-enemy senses <span class="c">hover a row for a summary</span></h3></div>
      <div class="gtable-wrap"><table class="gtable">
        <thead><tr><th>Enemy</th><th>Vision (near→far)</th><th>Cone</th><th>Hearing</th><th>ESP</th></tr></thead>
        <tbody>${D.enemies.map(erow).join("")}</tbody>
      </table></div>
      <p class="gnote">Vision is a line-of-sight cone; you build detection faster up close (near range) than at the edge (far range). ESP ignores walls. "∞" = effectively omniscient at range (turrets, Hunter-Killers).</p>
      <p class="gnote">Every figure is the one the enemy uses <b>against a player</b> &mdash; some carry longer ranges that only apply to rival-faction targets. Under Hearing, the second line is while you're flagged <b>violent</b>, the game's state for a player who's been shooting. <b>Point-blank</b> is a close-range band most ground units gained in 0.9.5; the files carry the distance, not exactly what it does.</p>
    </div>

    ${D.hunterKillers ? `<div class="card" id="hunterkillers" data-anchor="hunter-killers">
      <div class="section" style="margin-top:0"><h3>Hunter-Killers: what triggers them <span class="badge gold">datamined</span></h3></div>
      <p class="gnote">${esc(D.hunterKillers.intro)}</p>
      <div class="section"><h3 style="color:var(--rust)">Any one of these trips it</h3></div>
      ${D.hunterKillers.triggers.map((t) => `<div class="gdef"><span class="term">${esc(t.label)}</span><span>${esc(t.detail)}</span></div>`).join("")}
      <div class="section"><h3>What happens when it trips</h3></div>
      ${D.hunterKillers.behavior.map((b) => `<div class="gdef"><span class="term">${esc(b.k)}</span><span>${esc(b.v)}</span></div>`).join("")}
      <div class="callout" style="border-left-color:var(--rust)"><b>Quest link.</b> ${esc(D.hunterKillers.questNote)}</div>
      <p class="gnote">${esc(D.hunterKillers.escalation)}</p>
    </div>` : ""}

    <div class="card" data-anchor="visibility">
      <div class="section" style="margin-top:0"><h3>What makes <em>you</em> visible</h3></div>
      <div class="gtable-wrap"><table class="gtable">
        <thead><tr><th>Factor</th><th>Effect</th><th>What it does</th></tr></thead>
        <tbody>${D.modifiers.map(mrow).join("")}</tbody>
      </table></div>
      <p class="gnote">${esc(D.note)}</p>
    </div>

    <div class="card" data-anchor="noise">
      <div class="section" style="margin-top:0"><h3>Noise you make (audible radius)</h3></div>
      <div class="noise-list">${D.noise.map(nrow).join("")}</div>
      <p class="gnote">Crouch-moving emits <b>no</b> noise event at all.${noiseSummary ? ` ${noiseSummary}.` : ""}</p>
    </div>

    <div class="card" data-anchor="timing">
      <div class="section" style="margin-top:0"><h3>Timing &amp; memory</h3></div>
      <div class="statgrid">
        <div class="stat"><div class="k">Confirm a target</div><div class="v">${esc(gm.identifyTime)}</div></div>
        <div class="stat"><div class="k">Lose you — Rookies</div><div class="v">${esc(gm.lostTarget["Rookies"])}</div></div>
        <div class="stat"><div class="k">Lose you — Career</div><div class="v">${esc(gm.lostTarget["Career Soldiers"])}</div></div>
        <div class="stat"><div class="k">Lose you — Special Forces</div><div class="v">${esc(gm.lostTarget["Special Forces"])}</div></div>
        <div class="stat"><div class="k">Search last-known</div><div class="v">${esc(gm.hiddenSearch)}</div></div>
        <div class="stat"><div class="k">Area stays hot</div><div class="v">${esc(gm.alertnessCooldown)}</div></div>
      </div>
      <p class="gnote">${esc(gm.alertnessNote)}</p>
      <div class="callout"><b>Squad transference.</b> ${esc(D.transference.desc)}</div>
    </div>

    ${D.targetPriority ? `<div class="card" id="det-priority" data-anchor="priority">
      <div class="section" style="margin-top:0"><h3>How enemies choose a target <span class="badge gold">datamined</span></h3></div>
      <p class="gnote">${esc(D.targetPriority.intro)}</p>
      <div class="gtable-wrap"><table class="gtable">
        <thead><tr><th>What it weighs</th><th class="num">Weight</th><th>Meaning</th></tr></thead>
        <tbody>${D.targetPriority.weights.map((w) => `<tr><td>${esc(w.factor)}</td><td class="num gold">${w.weight}</td><td>${esc(w.desc)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="gnote">${esc(D.targetPriority.note)}</p>
      <div class="callout">${esc(D.targetPriority.badgeNote)}</div>
    </div>` : ""}

    <p class="legend">Method: decoded from the shipping game's <code>FWAI</code> awareness assets (vision/hearing/ESP sensor definitions, noise events, transference) via a UE4SS type mapping + CUE4Parse (build ${D.build}). Ranges: Unreal units ÷100 = metres. Modifier directions verified against in-game roles (crouch stealthier, shooting louder).</p>
  </div>`;
}

/* ---------- enemies tab ---------- */
const bNum = (n) => Number(n).toLocaleString();
const mdb = (s) => esc(s == null ? "" : String(s)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*([^*\n]+?)\*/g, "<i>$1</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
const CAL_LABEL = { "545": "5.45mm", "556": "5.56mm", "762": "7.62mm", "919": "9mm", "308": ".308", "40m": "40mm", "12G": "12ga" };

async function renderEnemies() {
  view.classList.remove("detail-open");
  if (!ENEMY_V) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading enemy intel&hellip;</div>`;
    try { ENEMY_V = await (await fetch("data/enemies.json", { cache: "no-cache" })).json(); }
    catch (e) { view.innerHTML = `<p class="empty">Could not load enemy data.<br><small>${esc(e.message)}</small></p>`; return; }
    ENEMYDATA = composeEnemies(activeMods());
  }
  drawEnemies();
}

function bossStaggerVal(s) {
  if (!s || s.damage == null) return "&mdash;";
  if (s.damage >= 999999) return `<span class="dim">Immune</span>`;
  if (s.damage >= 99999) return `${bNum(s.damage)} <span class="dim">&middot; ≈immune</span>`;
  return `${bNum(s.damage)}${s.window ? ` <span class="dim">in ${s.window}s</span>` : ""}`;
}
function bossGrabVal(g) {
  if (!g || !g.vsPlayer) return null;
  if (g.hpAlways) return `<b>Any</b> health &middot; ${g.rangeM} m`;
  return `&le; ${bNum(g.hpThreshold)} HP &middot; ${g.rangeM} m`;
}

function unitCard(b) {
  const isBoss = b.tier === "boss";
  let h = `<div class="card boss${isBoss ? "" : " unit"}" id="enemy-${esc(b.id)}" data-anchor="${esc(b.id)}">
    <div class="dhead"><h2>${esc(b.name)}</h2>
      <span class="badge gold">${esc(b.faction)}</span>
      <span class="badge olive">${esc(b.type)}</span>
      ${b.aka ? `<span class="badge">${esc(b.aka)}</span>` : ""}
      ${(() => { const m = enemyMod(b.id); return m ? `<span class="badge rust" title="Changed by ${esc(m.meta.name)}">${esc(modBadge(m))}</span>` : ""; })()}
      ${b.threat ? `<button class="badge boss-threat" data-goai title="The enemy AI's internal target-priority tier for this unit — an input to how squads pick who to shoot, not a danger rating. Click for how it works.">AI priority: ${esc(b.threat)} <small>(internal)</small></button>` : ""}</div>`;
  if (b.desc) h += `<p class="boss-desc">${mdb(b.desc)}</p>`;
  if (!isBoss) {
    const meta = [];
    if (b.variants) meta.push(`<b>Variants:</b> ${esc(b.variants)}`);
    if (b.location) meta.push(`<b>Found:</b> ${esc(b.location)}`);
    if (meta.length) h += `<p class="unit-meta">${meta.join(" &middot; ")}</p>`;
  }

  const grab = bossGrabVal(b.grab);
  // durability slot — every card gets one: armour sum, real HP, ∞ for the
  // sentinel-HP bosses (defeated by mechanics/evasion, not damage), or "Heavy" for tanks.
  let durLabel = "Health", durVal = null;
  const dpKill = b.codexKill && (b.codexKill.method === "detpack" || b.codexKill.method === "uncertain");
  if (b.codexKill && b.codexKill.method === "gunfire" && b.bodyHp) {
    // a mod (e.g. Unkillables) de-invincibled this boss: finite, gunfire-killable body pool
    durLabel = "Body HP"; durVal = `${bNum(b.bodyHp)} <small class="dim">killable</small>`;
  }
  else if (dpKill) {
    durLabel = "Body HP";
    const hp = b.realHp ? bNum(b.realHp) : "1,000,000,000";
    durVal = `<span class="help" title="Body HP ${hp}: gunfire can't bring it down. It dies to a scripted kill after three Special Units DetPacks are planted while it's stunned.">&infin; <small class="dim">DetPack kill</small></span>`;
  }
  else if (b.health && b.health.total) { durLabel = "Armour"; durVal = bNum(b.health.total); }
  else if (b.hp) { durVal = bNum(b.hp); }
  else if (b.hpNote === "invincible") { durVal = `<span class="help" title="Max HP 1,000,000,000: gunfire can't bring it down.">&infin; <small class="dim">invincible</small></span>`; }
  h += `<div class="statgrid">`;
  if (durVal) h += `<div class="stat"><div class="k">${durLabel}</div><div class="v">${durVal}</div></div>`;
  h += `<div class="stat key"><div class="k">Stagger &middot; stun</div><div class="v">${bossStaggerVal(b.stagger)}</div></div>`;
  if (grab) h += `<div class="stat"><div class="k">Instakill grab</div><div class="v">${grab}</div></div>`;
  h += `<div class="stat"><div class="k">Kill XP</div><div class="v">${b.killXp ? bNum(b.killXp) : "&mdash;"}</div></div>`;
  h += `</div>`;

  if (b.health && b.health.components) {
    h += `<div class="section"><h3>Armour zones <span class="c">${bNum(b.health.total)} total</span></h3><div class="chips">`;
    b.health.components.forEach((c) => {
      h += `<span class="chip static boss-zone${c.critical ? " crit" : ""}">${esc(c.tag)} <b>${bNum(c.hp)}</b>${c.impact != null ? ` <small>&times;${c.impact}</small>` : ""}</span>`;
    });
    h += `</div><p class="gnote">Each zone is its own hit-box; <b>&times;</b> is the fraction of damage it takes &mdash; the <span style="color:var(--rust)">vulnerable</span> zone takes full damage, the heavy plate soaks 90%.</p></div>`;
  }

  const rows = [];
  if (b.melee) rows.push(["Melee", `${b.melee.hits > 1 ? b.melee.hits + "-hit combo &middot; " : ""}${bNum(b.melee.min)}${b.melee.max !== b.melee.min ? "&ndash;" + bNum(b.melee.max) : ""} dmg`]);
  if (b.dash) rows.push(["Dash / lunge", `${bNum(b.dash.damage)} dmg &middot; ${b.dash.minM}&ndash;${b.dash.maxM} m reach &middot; ${b.dash.cooldown}s cd`]);
  (b.weapons || []).forEach((w) => rows.push([esc(w.name),
    w.builtin ? `<span class="dim">built-in mount</span>` :
    [w.damage != null ? bNum(w.damage) + " dmg" : "", w.rps ? `${w.rps}/s` : "", w.caliber ? (CAL_LABEL[w.caliber] || w.caliber) : "", w.knockdown ? "knockdown" : ""].filter(Boolean).join(" &middot; ")]));
  if (rows.length) {
    h += `<div class="section"><h3>Attacks</h3><div class="gtable-wrap"><table class="gtable"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  if (b.senses) {
    const s = b.senses, bits = [];
    // A cone without figures is one the data holds back on purpose (visionHidden says why), never
    // a blind unit: no card's senses come from a unit built without a vision sensor.
    bits.push(s.visionFar ? `<b>Vision</b> ${s.visionNear}&rarr;${s.visionFar} m${s.coneH ? ` <span class="dim">${s.coneH}&deg;</span>` : ""}`
                          : `<b>Vision</b> <span class="dim">${s.visionHidden ? `cone not shown — ${esc(s.visionHidden)}` : "—"}</span>`);
    if (s.hearing || s.hearingViolent) bits.push(`<b>Hearing</b> ${s.hearing ? s.hearing + " m" : "—"}${s.hearingViolent ? ` <span class="dim">(${s.hearingViolent} m violent)</span>` : ""}`);
    if (s.esp) bits.push(`<b>ESP</b> ${esc(s.esp)}`);
    h += `<div class="section"><h3>Senses <button class="linklike" data-godetect>full detection model &rarr;</button></h3>
      <div class="unit-senses">${bits.join(` <span class="dim">&middot;</span> `)}</div>
      ${s.notes ? `<p class="gnote">${mdb(s.notes)}</p>` : ""}</div>`;
  }

  if (b.weakpoint) h += `<div class="callout" style="border-left-color:var(--olive)"><b>Weak point.</b> ${mdb(b.weakpoint)}</div>`;

  if (b.weaknesses && b.weaknesses.length) {
    h += `<div class="section"><h3>Weaknesses</h3><ul class="boss-weak">${b.weaknesses.map((w) => `<li>${mdb(w)}</li>`).join("")}</ul></div>`;
  }

  if (b.codexKill) {
    const ck = b.codexKill;
    let how;
    if (ck.method === "gunfire") how = "Finite HP — sustained anti-tank / heavy fire kills it.";
    else if (ck.method === "detpack") how = `Gunfire can't kill it. **${ck.plants} Special Units DetPacks** planted while it's stunned (**${bNum(ck.stunThreshold)}**${ck.stunWindow ? ` in ${ck.stunWindow}s` : ""}, your damage only) trigger a scripted kill.`;
    else how = "Kill method unconfirmed in the datamine.";
    const codexBit = !ck.hasCodex ? " Drops no Codex of its own."
      : ck.codexDelivery === "placed" ? " Its Codex spawns as a lootable item nearby, not a corpse drill."
      : " Its Codex is drilled out of the corpse.";
    h += `<div class="callout" style="border-left-color:var(--gold)"><b>How to kill.</b> ${mdb(how + codexBit)}${ck.note ? ` <span class="dim">${mdb(ck.note)}</span>` : ""}</div>`;
  }

  if (b.codexReward) {
    const cr = b.codexReward;
    const bits = [];
    if (cr.upgrade) bits.push(`unlocks ${esc(cr.upgrade)}`);
    if (cr.xp != null) bits.push(`${bNum(cr.xp)} XP`);
    if (cr.cr != null) bits.push(`${bNum(cr.cr)} cr`);
    h += `<p class="boss-codex"><b>${esc(cr.name)}</b>${bits.length ? ` &middot; ${bits.join(" &middot; ")}` : ""}</p>`;
  }
  h += `</div>`;
  return h;
}

function enemyMatches(u) {
  return match(u.name) || match(u.type) || (u.aka && match(u.aka)) || match(u.faction)
    || (u.desc && match(u.desc)) || (u.variants && match(u.variants));
}

function drawEnemies() {
  const D = ENEMYDATA;
  const cat = state.enemyCat || "all";
  const shown = D.units.filter((u) => (cat === "all" || u.category === cat) && enemyMatches(u));

  let html = `<div class="guide">` + datasetBar() + `
    <div class="callout" style="margin-top:16px;border-left-color:var(--olive)"><b>Stagger and the grab.</b>
      <b>Stagger</b> &mdash; a unit that takes that much damage within the window is stunned (only <em>your</em> damage counts &mdash; one railgun shot can stun what a magazine can't); the big machines are effectively <em>immune</em>. <b>The grab</b> &mdash; a sync-kill that ends the raid on the spot; most only trigger when your health is at or below the listed threshold.</div>`;
  (D._modNotes || []).forEach((mn) => { const m = modById(mn.mod); html += `<div class="callout" style="border-left-color:var(--rust)"><b>${esc(m ? m.meta.name : "Mod")}.</b> ${mdb(mn.note)}</div>`; });

  const chip = (id, label, n) => `<button class="chip ${cat === id ? "on" : ""}" data-enemycat="${esc(id)}">${esc(label)}${n != null ? ` <small>${n}</small>` : ""}</button>`;
  html += `<div class="chips enemy-cats">` + chip("all", "All", D.units.length)
    + D.categories.map((c) => chip(c.id, c.name, D.units.filter((u) => u.category === c.id).length)).join("") + `</div>`;

  if (!shown.length) {
    html += `<p class="empty">No enemies match &ldquo;${esc(state.q)}&rdquo;.</p>`;
  } else {
    D.categories.forEach((c) => {
      if (cat !== "all" && cat !== c.id) return;
      const us = shown.filter((u) => u.category === c.id);
      if (!us.length) return;
      html += `<section class="enemy-cat-sec" id="enemy-cat-${esc(c.id)}" data-anchor="cat-${esc(c.id)}">
        <div class="enemy-cat-head"><h2>${esc(c.name)} <span class="c">${us.length}</span></h2>
        <span class="enemy-cat-blurb">${esc(c.blurb)}</span></div>`;
      html += us.map(unitCard).join("");
      html += `</section>`;
    });
  }

  html += `<p class="legend">Method: decoded from the shipping game's <code>FW/AI/Characters/&hellip;/AIDEF_*</code> pawn definitions, <code>BP_AI_*</code> health components and <code>DA_WPN_*</code> weapon defs via a UE4SS type mapping + CUE4Parse (build ${D.build}). Ranges: Unreal units &divide; 100 = metres. Values cross-checked against the wiki and community testing.</p></div>`;
  view.innerHTML = html;
}

/* ---------- factions / tug-of-war tab ---------- */
let FACTIONDATA = null;
const FCOLOR = { Eurasia: "var(--rust)", Europa: "var(--blue)", Euruska: "var(--olive)", Scavenger: "var(--gold)", "Scav NPC": "var(--gold)", "Water Thieves": "var(--muted)" };

async function renderFactions() {
  view.classList.remove("detail-open");
  if (!FACTIONDATA) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading faction control&hellip;</div>`;
    try { FACTIONDATA = await (await fetch("data/factions.json", { cache: "no-cache" })).json(); }
    catch (e) { view.innerHTML = `<p class="empty">Could not load faction data.<br><small>${esc(e.message)}</small></p>`; return; }
  }
  drawFactions();
}

function facBar(control) {
  return `<div class="fac-bar">${control.map((c) => `<span class="fac-seg" style="width:${c.pct}%;background:${FCOLOR[c.faction] || "var(--dim)"}" title="${esc(c.faction)} ${c.pct}%">${c.pct >= 12 ? Math.round(c.pct) : ""}</span>`).join("")}</div>`;
}

function facActionCard(a) {
  const groups = {};
  (a.effects || []).forEach((e) => {
    const key = e.faction + "|" + e.pct;
    (groups[key] = groups[key] || { faction: e.faction, pct: e.pct, maps: [] }).maps.push(e.map);
  });
  const gArr = Object.values(groups).sort((x, y) => y.pct - x.pct);
  let h = `<div class="fac-action" data-anchor="action-${esc(slugify(a.id || a.name))}"><div class="fac-action-head">
      <span class="fac-action-name">${esc(a.name)}</span>
      <span class="badge">${esc(a.where)}</span>
      ${a.durationHours ? `<span class="badge gold">${a.durationHours} h</span>` : ""}</div>`;
  if (a.desc) h += `<p class="fac-action-desc">&ldquo;${esc(a.desc)}&rdquo;</p>`;
  if (gArr.length) {
    h += `<div class="fac-effects">${gArr.map((g) => {
      const up = g.pct >= 0;
      return `<span class="fac-eff ${up ? "up" : "down"}"><span class="fac-dot" style="background:${FCOLOR[g.faction] || "var(--dim)"}"></span>${esc(g.faction)} ${up ? "+" : "−"}${Math.abs(g.pct)}%<small> in ${g.maps.map(esc).join(", ")}</small></span>`;
    }).join("")}</div>`;
  } else {
    h += `<p class="gnote">Local effect &mdash; no cross-map control shift in the data.</p>`;
  }
  return h + `</div>`;
}

function drawFactions() {
  const D = FACTIONDATA;
  let html = `<div class="guide">
    <div class="callout" style="margin-top:16px"><b>Datamined from the game's Tug-of-War system.</b> ${esc(D.note)}</div>
    <div class="callout" style="border-left-color:var(--olive)"><b>Two different faction systems.</b> <b>Map control</b> (below) is a shared, server-wide tug-of-war over each map, shifted by sabotage and lasting hours. <b>Standing</b> (bottom) is your <em>personal</em> reputation with each army &mdash; how hostile they are to <em>you</em>.</div>
    <div class="fac-legend">${D.factions.map((f) => `<span class="fac-key"><span class="fac-dot" style="background:${FCOLOR[f.name] || "var(--dim)"}"></span>${esc(f.name)}</span>`).join("")}</div>`;

  html += `<div class="card" data-anchor="control"><div class="section" style="margin-top:0"><h3>Who controls each map <span class="c">starting split</span></h3></div>`;
  const maps = D.maps.filter((m) => match(m.name));
  if (!maps.length) html += `<p class="empty">No maps match &ldquo;${esc(state.q)}&rdquo;.</p>`;
  else maps.forEach((m) => { html += `<div class="fac-map" data-anchor="map-${esc(slugify(m.id || m.name))}"><div class="fac-map-name">${esc(m.name)}</div>${facBar(m.control)}</div>`; });
  html += `<p class="gnote">Each army starts with a share of every surface map; whoever holds more fields more units there. These are the <b>default</b> weights &mdash; live control drifts as the war (and players) push it. Hubs (${(D.hubs || []).map((h) => esc(h.name)).join(", ")}) are Scavenger-held.</p></div>`;

  html += `<div class="card" data-anchor="sabotage"><div class="section" style="margin-top:0"><h3>Sabotage objectives <span class="c">and their cross-map effects</span></h3></div>
    <p class="gnote">Each is a droppable objective on its map. Completing one shifts control on <em>other</em> maps &mdash; server-wide, for the listed real-world hours &mdash; which changes which army fields more units there.</p>`;
  D.actions.filter((a) => match(a.name) || match(a.where) || (a.desc && match(a.desc))).forEach((a) => { html += facActionCard(a); });
  html += `</div>`;

  const rep = D.reputation;
  html += `<div class="card" data-anchor="standing"><div class="section" style="margin-top:0"><h3>Faction standing <span class="c">your personal rep</span></h3></div>
    <p class="gnote">${esc(rep.note)}</p>
    <div class="gtable-wrap"><table class="gtable"><thead><tr><th>Damage dealt to&hellip;</th><th class="num">Standing shift / HP</th></tr></thead>
      <tbody>${rep.perDamage.map((p) => `<tr><td>${esc(p.faction)}</td><td class="num">${p.perHp}</td></tr>`).join("")}</tbody></table></div>
    <div class="callout" style="border-left-color:var(--rust)"><b>Destroying a heavy: ${bNum(rep.bossKill)}.</b> ${esc(rep.bossKillNote)}</div></div>`;

  html += `<p class="legend">Method: decoded from <code>FW/TugOfWar/DT_*</code> (per-map faction splits, level actions + their percentage shifts) and <code>FactionAdjustmentsViaBattle</code> via CUE4Parse (build ${D.build}). Effect durations are the game's own real-world marker timers.</p></div>`;
  view.innerHTML = html;
}

/* ---------- economy / loot tab ---------- */
let ECO = null;
const TIER_COLOR = {
  junk: "var(--dim)", cheap: "var(--muted)", worth: "var(--blue)", good: "var(--olive)",
  valuable: "var(--olive)", prime: "var(--gold)", jackpot: "var(--rust)",
};
const ecoCr = (n) => Number(n).toLocaleString();
const ecoCompact = (n) => (n >= 1e6 ? +(n / 1e6).toFixed(2) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : "" + n);
const ecoRange = (t) => {
  const c = (n) => (n >= 1000 ? n / 1000 + "k" : "" + n);
  return t.hi == null ? c(t.lo) + "+" : c(t.lo) + "–" + c(t.hi);
};

async function renderEconomy() {
  view.classList.remove("detail-open");
  if (!ECO) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading loot economy&hellip;</div>`;
    try { ECO = await (await fetch("data/economy.json", { cache: "no-cache" })).json(); }
    catch (e) { view.innerHTML = `<p class="empty">Could not load economy data.<br><small>${esc(e.message)}</small></p>`; return; }
    ECO.byKey = {}; ECO.tiers.forEach((t) => (ECO.byKey[t.key] = t));
  }
  drawEconomy();
}

function drawEconomy() {
  const D = ECO;
  const tiersDesc = D.tiers.slice().reverse(); // lead with the best loot (Jackpot → Junk)
  const items = D.items.filter((it) => (state.ecoCat === "all" || it.cat === state.ecoCat) && match(it.name));
  const dens = (v) => (v == null ? '<span class="dim">&mdash;</span>' : ecoCr(v));
  const catCell = (it) => `<button class="eco-cat" data-ecocat="${esc(it.cat)}">${esc(it.catLabel)}</button>`;

  let html = `<div class="guide eco">
    <div class="callout" style="margin-top:16px"><b>What your scavenging is worth.</b>
      Every lootable item you can sell, pulled <b>straight from the game's own data</b> and bucketed by
      credit value. Values are the game's Rep&nbsp;2 / 100%-efficiency reference, so they show
      <em>relative</em> worth &mdash; the real payout shifts with vendor, reputation and faction. Tap
      <b>drops</b> on a row for every crate, corpse and wreck that can give it.</div>`;

  // distribution strip
  const maxC = Math.max(...D.tiers.map((t) => t.count));
  html += `<div class="card" data-anchor="overview"><div class="section" style="margin-top:0"><h3>The loot economy at a glance <span class="c">${D.count} sellable items</span></h3></div>
    <div class="eco-strip">`;
  tiersDesc.forEach((t) => {
    const w = Math.max(3, Math.round((t.count / maxC) * 100));
    html += `<button class="eco-tierbar" data-ecotier="${t.key}" title="Jump to ${esc(t.label)}">
      <span class="eco-tname">${esc(t.label)} <small>${ecoRange(t)}</small></span>
      <span class="eco-tbarwrap"><span class="eco-tbar" style="width:${w}%;background:${TIER_COLOR[t.key]}"></span></span>
      <span class="eco-tmeta">${t.count} <small>&middot; ${ecoCompact(t.sumCr)} cr</small></span></button>`;
  });
  html += `</div>
    <p class="gnote">How many sellable items land in each value band. Tap one to jump to it.</p></div>`;

  // controls: mode toggle + category filter
  html += `<div class="eco-controls"><div class="eco-modes">
      <button data-ecomode="tiers" class="${state.ecoMode === "tiers" ? "on" : ""}">Value tiers</button>
      <button data-ecomode="density" class="${state.ecoMode === "density" ? "on" : ""}">Space-efficiency</button>
    </div></div>
    <div class="chips eco-cats">
      <button class="chip ${state.ecoCat === "all" ? "on" : ""}" data-ecocat="all">All <small>${D.count}</small></button>`;
  D.categories.forEach((c) => {
    html += `<button class="chip ${state.ecoCat === c.key ? "on" : ""}" data-ecocat="${esc(c.key)}">${esc(c.label)} <small>${c.count}</small></button>`;
  });
  html += `</div>`;

  if (!items.length) {
    html += `<p class="empty">No loot matches ${state.q ? `&ldquo;${esc(state.q)}&rdquo;` : "this filter"}.</p></div>`;
    view.innerHTML = html; return;
  }

  html += state.ecoMode === "density" ? ecoDensityTable(items, catCell, dens) : ecoTierSections(items, tiersDesc, catCell, dens);

  html += `<p class="legend">Source: read straight from the game's <b>current</b> item &amp; value tables (its in-game &ldquo;EconV2&rdquo; economy)${D.build ? `, decoded from build ${D.build}` : ""}.
    Credits = raw value &divide; ${D.divisor.toFixed(2)} (the game's Rep&nbsp;2 / 100% cost-efficiency reference). Accurate to this build &mdash; values shift with patches.</p></div>`;
  view.innerHTML = html;
}

function ecoRow(it, catCell, dens, withTier) {
  const tierBadge = withTier ? `<td><span class="eco-tier" style="--tc:${TIER_COLOR[it.tier]}">${esc(ECO.byKey[it.tier].label)}</span></td>` : "";
  const q = it.quest ? ` <span class="eco-q" title="Quest item">&#10022;</span>` : "";
  // Where it actually drops, not a map-type badge: the old Tunnels/Regions mark came from item
  // tags the game's loot scatter never reads (see parse_loot.RARE_LISTS in the datamine).
  const drops = ` <button class="eco-loc" data-godrops="${esc(it.name)}" title="Every source that drops ${esc(it.name)}">drops</button>`;
  return `<tr><td>${esc(it.name)}${q}${drops}</td>${tierBadge}<td>${catCell(it)}</td>
    <td class="num gold">${ecoCr(it.cr)}</td><td class="num">${dens(it.perVol)}</td><td class="num">${dens(it.perWgt)}</td></tr>`;
}

function ecoTierSections(items, tiers, catCell, dens) {
  // Collapsed by default (the strip is the summary); filtering/searching expands
  // every matching tier since the result set is then small. Jackpot always leads open.
  const expandAll = state.ecoCat !== "all" || !!state.q;
  let html = "";
  tiers.forEach((t) => {
    const grp = items.filter((it) => it.tier === t.key);
    if (!grp.length) return;
    const sum = grp.reduce((a, it) => a + it.cr, 0);
    const open = expandAll || t.key === "jackpot";
    html += `<details class="eco-det" id="eco-tier-${t.key}" data-anchor="tier-${t.key}"${open ? " open" : ""}>
      <summary class="eco-sum"><span class="eco-dot" style="background:${TIER_COLOR[t.key]}"></span>
        <span class="eco-sum-name">${esc(t.label)}</span>
        <span class="c">${ecoRange(t)} cr &middot; ${grp.length} item${grp.length === 1 ? "" : "s"} &middot; ${ecoCompact(sum)} cr total</span></summary>
      <div class="gtable-wrap"><table class="gtable eco-table">
        <thead><tr><th>Item</th><th>Category</th><th class="num">Value</th><th class="num">cr / cu</th><th class="num">cr / kg</th></tr></thead>
        <tbody>${grp.map((it) => ecoRow(it, catCell, dens, false)).join("")}</tbody>
      </table></div></details>`;
  });
  return html;
}

function ecoDensityTable(items, catCell, dens) {
  const ranked = items.slice().sort((a, b) => {
    if ((a.perVol == null) !== (b.perVol == null)) return a.perVol == null ? 1 : -1;
    return (b.perVol || 0) - (a.perVol || 0);
  });
  return `<div class="section eco-sec" data-anchor="density"><h3>By space-efficiency <span class="c">${ranked.length} items &middot; credits per unit of bin volume</span></h3></div>
    <p class="gnote">Ranked by credits per cubic unit of small-item bin volume, highest first. Destroyed weapons and Large items use
    dedicated bins (no small-item volume), so they sit at the bottom.</p>
    <div class="gtable-wrap"><table class="gtable eco-table">
      <thead><tr><th>Item</th><th>Tier</th><th>Category</th><th class="num">Value</th><th class="num">cr / cu</th><th class="num">cr / kg</th></tr></thead>
      <tbody>${ranked.map((it) => ecoRow(it, catCell, dens, true)).join("")}</tbody>
    </table></div>`;
}

/* ---------- drops / loot-source tab ---------- */
let LOOT = null;
let DROPMODEL = null;
const RAR_COLOR = { 5: "var(--muted)", 4: "var(--blue)", 3: "var(--olive)", 2: "var(--gold)", 1: "var(--rust)" };

async function renderLoot() {
  view.classList.remove("detail-open");
  if (!LOOT) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading loot sources&hellip;</div>`;
    try { LOOT = await (await fetch("data/loot.json", { cache: "no-cache" })).json(); }
    catch (e) { view.innerHTML = `<p class="empty">Could not load loot data.<br><small>${esc(e.message)}</small></p>`; return; }
    LOOT.kindLabel = {}; LOOT.kinds.forEach((k) => (LOOT.kindLabel[k.key] = k.label));
  }
  if (!DROPMODEL) {
    // the "How drops work" panel is a nicety — if it can't load, the source index still renders.
    try { DROPMODEL = await (await fetch("data/drops-model.json", { cache: "no-cache" })).json(); }
    catch (e) { DROPMODEL = { _err: true }; }
  }
  drawLoot();
}

// Context-first "How drops work" panel (Drops tab): the placement/tier/contents model,
// the crate-type taxonomy, quest spawn rates and the other drop sources. Curated from
// data/drops-model.json (regen: forever-winter-datamine/tools/parse_drops.py).
function dropModelPanel() {
  const D = DROPMODEL;
  if (!D || D._err) return "";
  const b = D.tierBudget || {};
  const kcr = (n) => (n >= 1000 ? n / 1000 + "k" : String(n));

  const layers = (D.model || []).map((m, i) => `
    <div class="dm-layer">
      <div class="dm-num">${i + 1}</div>
      <div class="dm-layer-body"><h4>${esc(m.title)}</h4>
        <p class="dm-lead">${mdb(m.lead)}</p>
        <p class="dm-detail">${mdb(m.body)}</p></div>
    </div>`).join("");

  const tiers = ["T1", "T2", "T3", "T4"].filter((t) => b[t] != null);
  const budgetStrip = `<div class="dm-budget" data-anchor="tier-budget">
    <span class="dm-budget-label">Tier&nbsp;=&nbsp;credit budget</span>
    <span class="dm-budget-scale">${tiers.map((t) => `<span class="dm-b"><b>${t}</b> ${kcr(b[t])}</span>`).join('<span class="dm-arrow">&rarr;</span>')}</span>
  </div>`;

  // cap/pool are a single number, or a range when the type's tiers differ (the Armaments Bin
  // draws from 17 items at one tier and 18 at the others)
  const span = (v) => (Array.isArray(v) ? `${v[0]}&ndash;${v[v.length - 1]}` : v);
  const typeRow = (c) => {
    const name = c.file === "gear"
      ? `<button class="dm-type" data-gotab="${esc(c.tab)}">${esc(c.type)}</button> <button class="dm-gear" data-gotab="${esc(c.tab)}">${esc(c.tab)} tab &rarr;</button>`
      : `<button class="dm-type" data-gosrc="${esc(c.source)}">${esc(c.type)}</button>`;
    return `<tr><td>${name}</td><td class="num">${span(c.cap)}</td><td class="num">${span(c.pool)}</td>
      <td class="dm-inside">${mdb(c.inside)}</td></tr>`;
  };
  const typeTable = `<details class="loot-src dm-det" data-anchor="crate-types" open>
    <summary class="loot-sum"><span class="loot-src-name">Crate types &mdash; what each is &amp; holds</span>
      <span class="c">${(D.crateTypes || []).length} types</span></summary>
    <div class="gtable-wrap"><table class="gtable dm-type-table">
      <thead><tr><th>Type</th><th class="num">Cap</th><th class="num">Pool</th><th>What&rsquo;s inside</th></tr></thead>
      <tbody>${(D.crateTypes || []).map(typeRow).join("")}</tbody></table></div>
    <p class="gnote">Every tier of a type shares one pool; the tier only sets the budget it fills toward. <b>Cap</b> = most items it can hold &middot; <b>Pool</b> = distinct items it can draw.</p></details>`;

  // what a killed unit leaves behind — the debris container, not the enemy's name
  const entRow = (e) => `<tr>
    <td><button class="dm-type" data-gosrc="${esc(e.source)}">${esc(e.name)}</button></td>
    <td class="num">${e.cap}</td><td class="num">${e.pool}</td>
    <td class="num">${e.minValue ? Number(e.minValue).toLocaleString() : "&mdash;"}</td>
    <td class="dm-inside">${mdb(e.note || "")}</td></tr>`;
  const entTable = (D.entityDrops || []).length ? `<details class="loot-src dm-det" data-anchor="entity-drops">
    <summary class="loot-sum"><span class="loot-src-name">What a kill leaves behind</span>
      <span class="c">${D.entityDrops.length} debris types</span></summary>
    <p class="gnote dm-gnote">${mdb(D.entityNote || "")}</p>
    <div class="gtable-wrap"><table class="gtable dm-type-table">
      <thead><tr><th>Container</th><th class="num">Cap</th><th class="num">Pool</th><th class="num" title="Guaranteed minimum credit value — a dash means the wreck can come up empty">Floor</th><th>Notes</th></tr></thead>
      <tbody>${D.entityDrops.map(entRow).join("")}</tbody></table></div></details>` : "";

  const pctVar = (c) => (c >= 1 ? "--olive" : c >= 0.6 ? "--gold" : "--rust");
  const spawnRow = (q) => `<tr><td>${esc(q.spawner)}</td>
    <td class="num"><b class="dm-pct" style="color:var(${pctVar(q.chance)})">${Math.round(q.chance * 100)}%</b></td>
    <td class="dm-inside">${esc(q.note || "")}</td></tr>`;
  const spawnTable = `<details class="loot-src dm-det" data-anchor="spawn-rates">
    <summary class="loot-sum"><span class="loot-src-name">Quest-crate spawn rates</span>
      <span class="c">the only real spawn roll</span></summary>
    <p class="gnote dm-gnote">${mdb(D.questSpawnNote || "")}</p>
    <div class="gtable-wrap"><table class="gtable">
      <thead><tr><th>Spawner</th><th class="num">Chance</th><th>Notes</th></tr></thead>
      <tbody>${(D.questSpawn || []).map(spawnRow).join("")}</tbody></table></div></details>`;

  const specialList = `<details class="loot-src dm-det" data-anchor="other-drops">
    <summary class="loot-sum"><span class="loot-src-name">Other drop sources</span>
      <span class="c">${(D.special || []).length}</span></summary>
    <div class="dm-special">${(D.special || []).map((s) =>
      `<div class="dm-sp"><b>${esc(s.name)}.</b> ${mdb(s.body)}${s.goto ? ` <button class="dm-type" data-gotab="${esc(s.goto)}">${esc(s.goto)} tab &rarr;</button>` : ""}</div>`).join("")}</div></details>`;

  return `<section class="dropmodel" data-anchor="how-it-works">
    <div class="section dm-head"><h3>How drops work</h3></div>
    <p class="dm-tldr">${mdb(D.tldr || "")}</p>
    <div class="dm-layers">${layers}</div>
    ${budgetStrip}${typeTable}${entTable}${spawnTable}${specialList}
  </section>`;
}

const lootVal = (it) => (it.cr != null ? `<span class="gold">${ecoCr(it.cr)}</span>` : `<span class="dim">&mdash;</span>`);
const lootItemCell = (it) => `<td><button class="loot-item" data-goeco="${esc(it.name)}" title="See value &amp; details on the Economy tab">${esc(it.name)}</button></td>`;

// single-rarity row (non-tiered sources)
function lootRow(it) {
  return `<tr>${lootItemCell(it)}
    <td><span class="loot-rar" style="--rc:${RAR_COLOR[it.rarity]}"><span class="loot-dot"></span>${esc(it.rarityLabel)}</span></td>
    <td class="num">${it.share}%</td>
    <td class="num">${lootVal(it)}</td></tr>`;
}

// one tier's dot: filled + coloured if present, hollow if the item can't spawn in that tier
function lootDot(it, t) {
  const b = it.byTier && it.byTier[t];
  if (!b) return `<span class="loot-tdot gap" title="${t}: not in this tier"></span>`;
  return `<span class="loot-tdot" style="--rc:${RAR_COLOR[b.r]}" title="${t}: ${esc(LOOT.rarityLabels[b.r] || "")} · ${b.s}% of pool"></span>`;
}
// tiered row (crate categories): a rarity dot per tier, showing the T1→T4 progression
function lootRowTiered(it, tiers) {
  return `<tr>${lootItemCell(it)}${tiers.map((t) => `<td class="tc">${lootDot(it, t)}</td>`).join("")}
    <td class="num">${lootVal(it)}</td></tr>`;
}

// If this source is one of the datamined crate types, pull its budget/cap from the
// drops-model so the "tier = credit budget" mechanic shows right where you read contents.
function crateTypeFor(key) {
  return DROPMODEL && !DROPMODEL._err && (DROPMODEL.crateTypes || []).find((c) => c.source === key);
}
const fmtK = (n) => (n >= 1000 ? n / 1000 + "k" : String(n));

function lootCard(s, items, open) {
  const tierBadge = s.tiers && s.tiers.length ? ` <span class="badge">${s.tiers.join(" · ")}</span>` : "";
  let head, rows;
  if (s.tiered && s.tiers.length) {
    head = `<tr><th>Item</th>${s.tiers.map((t) => `<th class="tc">${t}</th>`).join("")}<th class="num">Value</th></tr>`;
    rows = items.map((it) => lootRowTiered(it, s.tiers)).join("");
  } else {
    head = `<tr><th>Item</th><th>Rarity</th><th class="num">Pool share</th><th class="num">Value</th></tr>`;
    rows = items.map(lootRow).join("");
  }
  const ct = crateTypeFor(s.key), tb = DROPMODEL && DROPMODEL.tierBudget;
  const budgetNote = ct && tb ? `<p class="gnote loot-budgetnote">Fills toward a credit budget &mdash; <b>T1 ${fmtK(tb.T1)} &rarr; T4 ${fmtK(tb.T4)}</b> &mdash; and holds at most <b>${ct.cap} items</b> per open. <button class="linklike" data-gosrc-model>How tiers work &rarr;</button></p>` : "";
  return `<details class="loot-src" id="loot-src-${esc(s.key)}" data-anchor="${esc(s.key)}"${open ? " open" : ""}>
    <summary class="loot-sum"><span class="loot-src-name">${esc(s.label)}</span>${tierBadge}
      <span class="c">${items.length} item${items.length === 1 ? "" : "s"}</span></summary>
    ${budgetNote}<div class="gtable-wrap"><table class="gtable loot-table${s.tiered ? " loot-tiered" : ""}">
      <thead>${head}</thead><tbody>${rows}</tbody></table></div></details>`;
}

function drawLoot() {
  const D = LOOT;
  const q = state.q;
  let html = `<div class="guide">`;
  // The "How drops work" model leads the tab; hidden during a search so results stay focused.
  if (!q) html += dropModelPanel() +
    `<div class="section dm-sources-head" data-anchor="sources"><h3>Loot sources <span class="c">what drops from where, ranked by how common</span></h3></div>`;
  html += `<p class="gnote">Rarity is <b>per pool</b>: cheap filler like Drywall can read <span style="color:var(--rust)">Ultra&nbsp;Rare</span> just because it's an unlikely pull, not because it's valuable. Search an item to see <b>every</b> source that drops it.</p>
    <div class="loot-legend"><span class="c">Rarity</span>${[5, 4, 3, 2, 1].map((r) => `<span class="loot-key"><span class="loot-dot" style="--rc:${RAR_COLOR[r]}"></span>${esc(D.rarityLabels[r])}</span>`).join("")}<span class="loot-key"><span class="loot-tdot gap"></span>not in tier</span></div>`;

  // kind filter chips
  const kinds = D.kinds.filter((k) => D.sources.some((s) => s.kind === k.key));
  html += `<div class="chips loot-kinds">
    <button class="chip ${state.lootKind === "all" ? "on" : ""}" data-lootkind="all">All <small>${D.sources.length}</small></button>`;
  kinds.forEach((k) => {
    const n = D.sources.filter((s) => s.kind === k.key).length;
    html += `<button class="chip ${state.lootKind === k.key ? "on" : ""}" data-lootkind="${esc(k.key)}">${esc(k.label)} <small>${n}</small></button>`;
  });
  html += `</div>`;

  // sources, grouped by kind (D.sources is pre-sorted by kind order)
  const pool = D.sources.filter((s) => state.lootKind === "all" || s.kind === state.lootKind);
  let body = "", curKind = null, shown = 0;
  pool.forEach((s) => {
    const labelHit = match(s.label);
    const items = q && !labelHit ? s.items.filter((it) => match(it.name)) : s.items;
    if (q && !labelHit && !items.length) return;
    shown++;
    if (s.kind !== curKind) {
      curKind = s.kind;
      const n = pool.filter((x) => x.kind === s.kind).length;
      body += `<div class="section loot-kindhead" data-anchor="kind-${esc(s.kind)}"><h3>${esc(D.kindLabel[s.kind])}${q ? "" : ` <span class="c">${n} source${n === 1 ? "" : "s"}</span>`}</h3></div>`;
    }
    body += lootCard(s, items, !!q);
  });

  if (!shown) html += `<p class="empty">No sources match ${q ? `&ldquo;${esc(state.q)}&rdquo;` : "this filter"}.</p>`;
  else html += body;

  html += `<p class="legend">Source: <code>RandomContainerLootData</code> + <code>DT_GachaLootTable</code> + <code>BP_RareLootManager</code>, decoded from build ${D.build}.
    Pool share = the item's weight in that source's loot table; real per-raid odds also depend on how many items a source rolls. ${D.count} sources.</p></div>`;
  view.innerHTML = html;
}

/* ---------- changelog tab ---------- */
// The one dataset nothing generates: data/changelog.json is written by hand (see its note).
let CHANGELOG = null;
const CL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "2026-09-22" -> "22 September 2026", by hand: new Date("2026-09-22") is UTC midnight, which
// prints as the day before anywhere west of Greenwich.
const clDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? `${+m[3]} ${CL_MONTHS[+m[2] - 1]} ${m[1]}` : String(s || ""); };

async function renderChangelog() {
  view.classList.remove("detail-open");
  if (!CHANGELOG) {
    view.innerHTML = `<div class="placeholder" style="margin-top:16px">Loading changelog&hellip;</div>`;
    try { CHANGELOG = await (await fetch("data/changelog.json", { cache: "no-cache" })).json(); }
    catch (e) { view.innerHTML = `<p class="empty">Could not load the changelog.<br><small>${esc(e.message)}</small></p>`; return; }
    if (state.tab !== "changelog") return; // switched tabs while it loaded
  }
  drawChangelog();
}

function drawChangelog() {
  // search narrows to the matching items; a date with none left drops out
  const entries = (CHANGELOG.entries || [])
    .map((e) => ({ date: e.date, items: (e.items || []).filter((it) => match(it)) }))
    .filter((e) => e.items.length);
  let html = `<div class="guide">`;
  if (!entries.length) html += `<p class="empty">${state.q ? `No changes match &ldquo;${esc(state.q)}&rdquo;.` : "No changes recorded yet."}</p>`;
  // the first card takes the 16px top margin the other tabs' opening callouts have
  entries.forEach((e, i) => {
    html += `<div class="card"${i ? "" : ' style="margin-top:16px"'} data-anchor="${esc(e.date)}"><div class="section" style="margin-top:0"><h3>${esc(clDate(e.date))}</h3></div>
      <ul class="cl-items">${e.items.map((it) => `<li>${mdb(it)}</li>`).join("")}</ul></div>`;
  });
  view.innerHTML = html + `</div>`;
}

/* ---------- deep-link router (hash-based; static-host & offline safe) ----------
   URL shape:  #/<tab>[/<sub>][?q=&mode=&cat=&kind=&layers=&bg=]
   The "#/" prefix keeps us clear of the browser's native "scroll to #id" behaviour.
   The URL is the source of truth on load / hashchange (applyRoute); every in-app
   navigation mirrors state back into it (writeHash). Maps owns its own sub-route. */
const TAB_SLUG = { loot: "drops" };   // internal tab key -> pretty URL slug
const TAB_KEY = { drops: "loot", bosses: "enemies" };  // pretty URL slug -> internal tab key (bosses = legacy alias)
const VALID_TABS = ["weapons", "attachments", "muzzles", "ammo", "crafting", "stats", "detection", "enemies", "factions", "economy", "loot", "maps", "changelog"];
const tabToSlug = (t) => TAB_SLUG[t] || t;
const slugToTab = (s) => TAB_KEY[s] || s;
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function uniqueSlug(base, taken) { let s = base || "x", i = 2; while (Object.prototype.hasOwnProperty.call(taken, s)) s = (base || "x") + "-" + i++; return s; }

let routing = false; // true only while we programmatically write the hash (suppresses the echo)
const ANCHOR_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4v-2H7a5.1 5.1 0 1 0 0 10.2h4v-2H7A3.1 3.1 0 0 1 3.9 12Zm5.1 1h6v-2H9v2Zm8-6h-4v2h4a3.1 3.1 0 1 1 0 6.2h-4v2h4a5.1 5.1 0 0 0 0-10.2Z"/></svg>';

function parseHash() {
  let h = (location.hash || "").replace(/^#/, "").replace(/^\//, "");
  let qs = ""; const qi = h.indexOf("?");
  if (qi >= 0) { qs = h.slice(qi + 1); h = h.slice(0, qi); }
  const parts = h.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  const query = {};
  qs.split("&").filter(Boolean).forEach((kv) => {
    const i = kv.indexOf("="); const k = i < 0 ? kv : kv.slice(0, i); const v = i < 0 ? "" : kv.slice(i + 1);
    try { query[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { query[k] = v; }
  });
  return { tab: slugToTab(parts[0] || ""), sub: parts.slice(1).join("/"), query };
}

function writeHashRaw(hash, push) {
  if (location.hash === hash) return;
  routing = true;
  try { push ? history.pushState(null, "", hash) : history.replaceState(null, "", hash); }
  catch (e) { location.hash = hash; }
  routing = false;
}

// Serialise the current state into the hash. `opts.sub` sets an explicit
// sub-anchor; `opts.push` adds a history entry (used for tab / detail nav).
function writeHash(opts) {
  opts = opts || {};
  const t = state.tab;
  if (t === "maps") return; // the atlas writes its own #/maps/... route via FWMaps
  let path = "/" + tabToSlug(t);
  const detOpen = view.classList.contains("detail-open");
  if (t === "weapons" && state.weapon && detOpen && idx.slugByWeapon[state.weapon]) path += "/" + idx.slugByWeapon[state.weapon];
  else if (t === "attachments" && state.att && detOpen && idx.slugByAtt[state.att]) path += "/" + idx.slugByAtt[state.att];
  else if (opts.sub) path += "/" + opts.sub;
  const q = [];
  if (state.q) q.push("q=" + encodeURIComponent(state.q));
  if (t === "economy") { if (state.ecoMode === "density") q.push("mode=density"); if (state.ecoCat && state.ecoCat !== "all") q.push("cat=" + encodeURIComponent(state.ecoCat)); }
  if (t === "loot" && state.lootKind && state.lootKind !== "all") q.push("kind=" + encodeURIComponent(state.lootKind));
  if (t === "enemies" && state.enemyCat && state.enemyCat !== "all") q.push("cat=" + encodeURIComponent(state.enemyCat));
  writeHashRaw("#" + path + (q.length ? "?" + q.join("&") : ""), opts.push);
}

// The single reader: hash -> state -> render -> scroll. Runs on load & hashchange.
function applyRoute() {
  const r = parseHash();
  const tab = VALID_TABS.includes(r.tab) ? r.tab : "weapons";
  state.tab = tab;
  state.q = (r.query.q || "").trim().toLowerCase();
  if (r.query.mode) state.ecoMode = r.query.mode === "density" ? "density" : "tiers";
  if (r.query.cat) state.ecoCat = r.query.cat;
  if (r.query.kind) state.lootKind = r.query.kind;
  state.enemyCat = (tab === "enemies" && r.query.cat) ? r.query.cat : "all";
  state.weapon = null; state.att = null;
  let sub = r.sub || "";
  if (tab === "weapons" && sub && idx.weaponSlug[sub]) { state.weapon = idx.weaponSlug[sub]; sub = ""; }
  else if (tab === "attachments" && sub && idx.attSlug[sub]) { state.att = idx.attSlug[sub]; sub = ""; }
  if (tab === "economy") { if (sub === "density") state.ecoMode = "density"; else if (sub.indexOf("tier-") === 0) state.ecoMode = "tiers"; }
  syncTabs();
  const sb = $("#search"), clr = $("#searchClear");
  if (sb) { sb.value = state.q; if (clr) clr.hidden = !state.q; }

  if (tab === "maps") {
    activateMaps({ map: sub || null, layers: r.query.layers ? r.query.layers.split(",").filter(Boolean) : null, bg: (r.query.bg != null && r.query.bg !== "") ? +r.query.bg : null });
    return;
  }
  deactivateMaps();
  view.classList.toggle("detail-open", !!(state.weapon || state.att));
  // setTimeout (not rAF) so the scroll still runs if the tab is backgrounded
  // when a deep-link lands (rAF is paused in non-visible tabs).
  Promise.resolve(render()).then(() => { if (sub) setTimeout(() => scrollToAnchor(sub), 0); });
}

function scrollToAnchor(sub) {
  if (!sub) return;
  let el;
  try { el = view.querySelector('[data-anchor="' + ((window.CSS && CSS.escape) ? CSS.escape(sub) : sub) + '"]'); } catch (e) { el = null; }
  if (!el) return;
  const det = el.closest("details"); if (det) det.open = true;
  if (el.tagName === "DETAILS") el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// After each render, inject a copy-link icon into every [data-anchor] section head.
function decorateAnchors() {
  view.querySelectorAll("[data-anchor]").forEach((box) => {
    const head = box.matches("summary") ? box : box.querySelector("summary, .dhead, .ammo-head, .fac-map-name, .fac-action-head, h2, h3");
    if (!head || head.querySelector(":scope > .anchor-link")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "anchor-link"; b.dataset.copy = box.getAttribute("data-anchor");
    b.title = "Copy link to this section"; b.setAttribute("aria-label", "Copy link to this section");
    b.innerHTML = ANCHOR_ICON;
    head.appendChild(b);
  });
}

function copySectionLink(sub) {
  const hash = "#/" + tabToSlug(state.tab) + (sub ? "/" + sub : "");
  const url = location.origin + location.pathname + hash;
  copyText(url).then((ok) => { writeHashRaw(hash); toast(ok ? "Link copied" : "Copy this link: " + url); });
}

// clipboard with a legacy fallback (navigator.clipboard is undefined on http/file://)
async function copyText(t) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); return true; } } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch (e) { return false; }
}

let toastTimer = null;
function toast(msg) {
  let t = document.getElementById("fw-toast");
  if (!t) { t = document.createElement("div"); t.id = "fw-toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1900);
}

/* ---------- PWA plumbing ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredPrompt = e;
  const b = $("#installBtn"); b.hidden = false;
  b.onclick = async () => { b.hidden = true; deferredPrompt.prompt(); deferredPrompt = null; };
});
window.addEventListener("appinstalled", () => ($("#installBtn").hidden = true));
function registerSW() {
  // Skip on localhost so cache-first serving doesn't shadow live dev edits.
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && !local) navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Defer boot until maps.js has defined window.FWMaps (it loads after app.js), so a
// cold #/maps/<id> deep-link can hand off to the atlas immediately.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
