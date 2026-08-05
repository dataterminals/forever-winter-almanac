# The Forever Winter — Almanac

A fast, installable, **offline** field companion for *The Forever Winter*: the
interactive **maps**, a **gunsmith** cross-reference for what fits what, and the
**datamined systems** the game keeps to itself — all in one installable PWA.

It began as two separate apps (a map atlas and an attachment gunsmith) and is now
a single tabbed companion. Data comes from the
[official wiki](https://theforeverwinter.wiki.gg) (CC BY-NC-SA / CC BY-SA), and,
for the parts the wiki doesn't cover, straight from the shipping game files.

**39 maps · 46 weapons · 268 parts · 68 attachments · 5 muzzle mount families · 26 ammo types · 361 sellable loot items · the full detection model.**

## The tabs

- **Weapons** — pick a gun, see its **stat card** (damage, accuracy, magazine, RoF,
  fire modes, …), its **structural parts** (barrels / handguards / magazines / stocks /
  grips / uppers, with the weapon level each unlocks at), and *everything* that fits it,
  grouped by slot, with its **muzzle mount family** named up front.
- **Attachments** — pick an attachment (e.g. *Muzzle Dev. D*), see every weapon it
  fits, its price, loyalty level, and accuracy/stability numbers.
- **Muzzles** — the whole muzzle system on one screen: the **5 mount families**
  (ATTMD1–5), which letters belong to each, and which weapons they fit. The bit the
  game hides worst.
- **Ammo** — every round in the game, grouped by role (pistol → anti-materiel, plus
  grenades), each with its **datamined headshot multiplier** (it lives on the caliber,
  not the gun), sell value + extraction XP, weight/volume, faction, and the weapons that
  fire it. The full per-caliber headshot table lives here.
- **Stats** — what each weapon/attachment stat *actually* does, including why shotgun
  damage reads ~200× low everywhere else (it's stored per pellet), and the evidence that
  the **Stability system was removed from the build** — attachments still grant the stat,
  but the per-weapon curves that consumed it are gone.
- **Detection** — the datamined **FWAI awareness system**: per-enemy vision / hearing
  / ESP ranges, what makes you visible, noise radii, and how you summon Hunter-Killers.
- **Economy** — every lootable item you can *sell*, bucketed into **value tiers** (Junk →
  Jackpot) with a distribution overview, plus a **space-efficiency** view that ranks loot by
  **credits-per-volume** — what to grab when your bins are nearly full. Excludes the gear that
  already has its own tab (weapons, parts, attachments, ammo); keeps enemy-drop destroyed weapons.
- **Maps** — the full interactive atlas (Leaflet): 10 surface regions, 16 tunnels and
  12 aerial references, with toggleable marker layers, per-map search, background
  switches, popups with screenshots + wiki links, and a distance-measure tool.

## Features

- 🔎 Search weapons/attachments, or markers on the current map
- 🔗 Tap any chip to jump between a weapon and its attachments (and back)
- 🎯 Muzzle **mount-family** grouping — match the family, not the letter
- 🗺️ Zoom/pan interactive maps with layer toggles, measure tool and marker popups
- 📱 **Installable PWA** — add it to a phone / second monitor home screen
- ✈️ **Works offline** — the app shell and all data are cached on first load; map
  imagery caches as you view it, or tap **⤓ Save all maps offline** to grab it all

## Use it

Open the published page (GitHub Pages) and, optionally, install it:

- **Desktop (Chrome/Edge):** click the install icon in the address bar.
- **Android (Chrome):** menu → *Add to Home screen*.
- **iOS (Safari):** Share → *Add to Home Screen*.

On the **Maps** tab, hit **⤓ Save all maps offline** once so every tile is cached —
handy on a second screen with no connection.

### Maps keyboard shortcuts

| Key | Action |
|-----|--------|
| `M` | toggle the Maps panel |
| `L` | toggle the Layers panel |
| `/` | focus marker search |
| `Esc` | clear search / measure |

## How the compatibility works

- **Structural parts** (barrels, handguards, magazines, stocks, grips) are
  *weapon-specific* and unlocked by weapon level — not covered here.
- **Rail attachments** (optics, scopes, sights, foregrips, lights, lasers) mount on
  any weapon that exposes the matching Picatinny/upper slot.
- **Muzzle devices** come in **5 mount families**. A device only fits weapons in its
  family — the ATTMD1–5 grouping the *Muzzles* tab makes explicit.
- Some slots must be *unlocked* first by fitting the right structural part (e.g. the
  PP-19 needs its B barrel before it takes a suppressor; the SVD needs an upper
  assembly before it takes an optic).

> Stats are flagged **WIP** on the wiki — Accuracy and Magazine Capacity are the only
> stats that visibly change how a weapon performs. Values are community data and may
> lag game patches.

## Where the data comes from

Two sources, and the split matters. Anything with a **build number** is decoded from the
shipping game files by the private
[forever-winter-datamine](https://github.com/dataterminals/forever-winter-datamine) repo
(CUE4Parse + a UE4SS-dumped `.usmap`) and is authoritative. Anything marked **wiki** is
scraped from [theforeverwinter.wiki.gg](https://theforeverwinter.wiki.gg) and can drift.

| Dataset | Source | Generated by |
| --- | --- | --- |
| `ammo` `economy` `enemies` `factions` `loot` | game files, build-stamped | datamine `tools/parse_*.py` |
| `crafting` `rebalance` `unkillables` | game files | datamine `tools/parse_crafting.py`, `parse_unkillables.py` |
| `weapons` | game files, **plus wiki** for name/class/accuracy/recoil/stability | `tools/fetch_weapons.py` |
| `detection` | game files, build-stamped | datamine `tools/parse_detection.py` |
| `drops-model` | game files, build-stamped | datamine `tools/parse_drops.py` |
| `attachments` `parts` | **wiki** | `tools/fetch_attachments.py`, `fetch_parts.py` |
| `maps` + per-map JSON | **wiki** (DataMaps) | `tools/fetch_maps.py` |

The wiki-sourced sets are wiki-sourced on purpose: the maps are a straight port of the
community atlas, and attachment/part stats are the in-game display aggregates rather than
stored fields. **`weapons.json` used to be in that group and no longer is** — see below.

```bash
python tools/fetch_weapons.py       # data/weapons.json — game files + wiki trimmings
python tools/fetch_attachments.py   # data/attachments.json (wiki)
python tools/fetch_parts.py         # data/parts.json (wiki)
python tools/fetch_maps.py          # data/maps.json + per-map JSON, downloads tiles/icons
python tools/compress_maps.py       # recompress bundled map imagery in place
```

`fetch_weapons.py` needs the datamine repo as a sibling checkout (or `FWDATA_ROOT` set).
Without it, it **refuses to write** rather than quietly emitting wiki-only numbers.

`fetch_maps.py` pulls every page in the wiki's `Map:` namespace, saves source JSON to
`data/`, downloads referenced tiles/icons/photos to `assets/img/`, and regenerates
`data/maps.json` (the map index) and `assets/img-list.json` (the offline cache list).
It skips images already on disk and backs off politely on rate limits.

`tools/fetch_items.py` is **superseded and refuses to run** — it rebuilt `economy.json`
from the wiki, which the datamine now owns.

PWA icons: `python tools/generate_icons.py` (Pillow) or `node tools/make_icons.mjs`.

### Why weapon stats are datamined now

`weapons.json` was a pure wiki scrape until the 24501089 cycle, and it had drifted badly.
Against the live weapon assets, **17 of 51 damage values were wrong and 44 of 51 XP values
were wrong**, along with 3 magazines, 3 rates of fire and 2 sell values. Two distinct
causes:

- **Staleness.** The LMG/HMG rows still held pre-24479102 numbers, so the site was two
  patches behind on those guns.
- **A units mismatch that no amount of restamping would fix.** Shotguns looked ~200×
  wrong because the game stores `WeaponDamage` **per pellet** and fires
  `NumberOfBuckshots` = 20 of them (all six shotguns; every other weapon fires 1). The
  wiki quotes a whole-spread total. `weapons.json` now carries `damage` (per pellet),
  `pellets`, and the derived `damagePerShot`.

Damage, rate of fire, magazine, weight, value, XP and calibre now come from the game
files. Accuracy, recoil and stability stay wiki-sourced because they are **not stored
fields** — they're the in-game display aggregates, which the devs flag as WIP.

### The Stability curve system was removed from the build

This site used to publish a decoded table of what the Stability stat did to bullet
dispersion, taken from each weapon's `Stability…DispersionCurve` assets. **Those assets
are no longer shipped.** Re-measured against a full mount of the live paks at build 24536482
(the finding first landed at 24501089 and every row below still holds):

- **0** of 76,310 packaged files match `*Stability*` (there were three curves per weapon)
- **0** `UpgradeTuning` paths, and **0** player `DA_WPN_PLAYER_*_v2` tuning assets
- **20** `FC_*` curve assets survive, all global (sway, ADS kick, stamina, shotgun
  damage falloff) — none is a per-weapon curve

The stat itself survives: `WeaponPartStatsData` still lists 633 attachment rows with 324
carrying a non-zero `Stability`, byte-identical to the previous build. Dispersion also
still exists, but as fixed per-weapon constants (`MaxDispersionRate`,
`DispersionCoolDownStart/Rate`) rather than curve outputs.

So the input survives and the transfer function is gone. The old conclusion ("higher
Stability = tighter sustained fire") can no longer be re-derived, and has been retired
rather than restated. **Caveat:** this shows the *data-driven* path was removed, not that
the stat is inert — the logic could have moved into compiled C++, which isn't in the asset
tree and can't be read this way.

## Layout

```
index.html                          the app shell + tab bar
app.js · app.css                    Weapons/Attachments/Muzzles/Stats/Detection tabs
maps.js · maps.css                  the Maps tab (Leaflet atlas, lazy-loaded, scoped to .maps-app)
sw.js · manifest.webmanifest        PWA / offline (shell precached, imagery runtime-cached)
data/attachments.json               weapon ↔ attachment dataset (wiki)
data/weapons.json                   per-weapon stats (datamined; wiki for the display-only stats).
                                    Shotgun `damage` is PER PELLET — see `pellets`/`damagePerShot`
data/parts.json                     structural parts per weapon, by slot + unlock level (wiki)
data/ammo.json                      every ammo type: headshot ×, value/XP, weight/volume (datamined from game files)
data/economy.json                   raiding-loot value tiers, density + spawn-location (datamined from game files)
data/loot.json                      source-first drop index — what each crate/wreck/corpse yields (datamined).
                                    Sources are keyed to the container the game actually spawns ("Turret
                                    Debris"), derived from the live loot objects — see the note below.
data/drops-model.json               how drops work: kills leave a searchable container, crate placement,
                                    tier = credit budget, quest spawn rates. Numbers derived, mechanic
                                    write-ups editorial — see its `provenance`
data/detection.json                 datamined FWAI awareness model. Ranges/modifiers/noise are derived;
                                    unit names and tactical notes are editorial — see its `provenance`
data/maps.json                      map index; data/<map>.json are the per-map sources
assets/img/*                        bundled map tiles, marker icons, popup photos
assets/vendor/                      Leaflet (vendored for offline use)
tools/                              data fetchers + icon generators
```

No build step, no framework — just static files, rendered with Leaflet (`CRS.Simple`)
on the Maps tab.

### A note on drop data: only live loot rows

`RandomContainerLootData` keeps loot rows forever, including ones the game stopped using.
The devs migrated enemy/wreck loot onto `EconV2_*` rows and left the whole pre-EconV2
generation (`RookLoot_*`, `CorpseRandomLoot<X>`, `MedMechDebrisRandomLoot`, …) in the
table — fully populated, referenced by nothing. Reading the table alone is how this app
once claimed a Europan Turret drops Turret Components at **48.85%** when the row the
engine actually rolls (`EconV2_Turret`) pays **7.94%**, and that Water Thief turrets drop
none when every turret in the game shares one pool.

So `loot.json` is generated by walking the **loot objects** (`BP_RandomLoot_*`) first: a
row is real only if some loot object's `RandomLoot.RowName` points at it, and each source
is named after that object's `ContainerDetails.ContainerName` — the string the player
reads on the thing they open. An orphaned row is now structurally unpublishable.
Regenerate with `tools/parse_loot.py` in the (private) datamine repo; `--audit` prints the
live/orphan split.

## Credits & licence

- Compatibility, stats, map data, tiles and icons: **The Forever Winter Wiki**
  (theforeverwinter.wiki.gg) and its contributors — attachment/weapon data under
  **CC BY-NC-SA**, map data/tiles under **CC BY-SA 3.0** — cross-checked against, and
  in places datamined from, the game's own files.
- An unofficial, fan-made convenience app. Not affiliated with Fun Dog Studios or
  wiki.gg. *The Forever Winter* is a trademark of its respective owner.
