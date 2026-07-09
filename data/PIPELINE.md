# Enemies bestiary pipeline (`data/enemies.json`)

`data/enemies.json` powers the **Enemies** tab (33 units: 10 bosses + 23 lesser
units across 6 categories). It superseded the old `data/bosses.json`, which was
deleted in commit `9aa3225` ("Grow the Bosses tab into a full Enemies bestiary").

This file is a **hand-curated master built on datamined hard numbers**. It is the
source of truth for the app. The datamine repo regenerates the *numbers* so you
can diff them against this master whenever the game updates — it does **not**
overwrite this file.

## Where the numbers come from

Every stat is read out of the shipping game files (build `24045295`), decoded
with CUE4Parse in the `forever-winter-datamine` repo and dumped to JSON under
`datamine/dumps/bosses/`.

| Field(s) | Source dump | Property |
|---|---|---|
| `killXp`, `threatScore`, `threat` | `AIDEF_*` → `FWAIPawnDefinition` | `KillExperienceValue`, `ThreatScore`, `TargetTypeTag` |
| `stagger.damage` / `.window` | same | `DamageToStagger` / `SecondsToResetStagger` (player-only: `bOnlyPlayerDamageStagger`) |
| `melee`, `dash` | same | `AIAnimToDamage`, `AIData.AIDashMontage` |
| `grab.*` | same | `SyncKillPlayerSequences`, `SyncKillMaxPlayerHealth`, `SyncKillMaxDistance` |
| mech `health.total/components` | same → `FWPawnDataDefinition_Armor` | `ArmorTypes[].MaxArmorHealth` |
| mech `weapons[]` | same → `FWPawnDataDefinition_Hardpoints` + `DA_WPN_*` | `WeaponDamage`, `FireRate`, `AmmoTypeCaliber` |
| `realHp` / `defaultHealth` / `invincible` | boss `PawnClass` BP → `FWHealthComponent` | `DefaultHealth` / `DefaultMaxHealth` |
| `antiBossExplode` | `AbilitySetDefinition` → `DD_AI_AbilitySet_*` | grants `FWAIGA_AntiBossExplode` |
| `codexKill.*` | derived (see below) | — |

## The anti-boss codex mechanic (`codexKill`)

Seven bosses have a **~1,000,000,000-HP body pool** (Toothy hides a **900,000,000**
body under its 451k armour zones) — **gunfire cannot kill them**. You stun one
(burst its `stagger` threshold within the window; only your damage counts), then
plant the **Special Units DetPack** (`AntiBossC4`) while it's stunned. The planted
charge (`BP_BossC4_Planted`) needs **3 plants** ("Number of bombs needed to boom!"
= 3) to fire a scripted **"Kill Victim"** that bypasses the HP pool; drilling the
corpse then drops the Codex. Only Mother Courage additionally plays a special
`AntiBossExplode` self-destruct sequence — the kill itself is the generic
3-charge script for all of them.

`codexKill = { method, chargesNeeded, stunThreshold, stunWindow, hasCodex }` where
`method` is:
- **`detpack`** — body HP ≥ 1e6 (invincible to gunfire) + a codex → stun & plant 3 DetPacks.
- **`gunfire`** — finite armour/body + a codex → shoot it dead (DetPack optional). Medium Mech (~337k body under 451k armour) and Rat King (451k armour, no body pool).
- **`none`** — no codex (Blind Mother).

### Datamined caveats baked into the cards (do not "fix" without re-checking)
- **"LARGE"/plantable is not a per-boss tag** — it exists only as the DetPack item
  description. Which bosses accept it is *inferred* from HP + stagger, not a flag.
- **Opal** is `method: "uncertain"` in the master (parser emits `detpack`): its
  stagger is 99,999 with **no** `SecondsToResetStagger`, so it's effectively
  un-stunnable and its codex path is unconfirmed.
- **MeatMan**'s codex ("Kotleta Codex", `CodexMeatMan`) is a **placed lootable item**
  spawned by `BP_MeatManCodexNoise`, not a drill-container drop; the item data is
  internally inconsistent, so its reward `xp`/`cr` are left null.
- **Grabber / Blind Mother** `realHp` is hand-set to 1e9 because their `PawnClass`
  BP dumps aren't in `dumps/bosses/`, so the parser reads `None` for them.

## The datamined layer vs the curated layer

The parser **cannot** produce these — preserve them across regenerations:
the `category` taxonomy, `role`, `variants`, `hpNote`, the top-level
`categories[]`/`codex`/`staggerNote`/`detpackNote`, `senses{}` (cross-referenced
from `detection.json`), roster order, and all 10 hand-written boss cards
(`blurb`, `desc`, `weakpoint`, `weaknesses[]`, tactics, `codexReward.upgrade`).

## Regenerating / validating

```
# 1. (only after a game patch) refresh the dumps, in forever-winter-datamine:
dotnet run --project datamine/decoder/fwextract.csproj -c Release -- dump <substr> <sub>

# 2. regenerate the datamined boss numbers -> a diff reference (does NOT touch enemies.json):
python tools/parse_bosses.py          # writes forever-winter-datamine/bosses.reference.json

# 3. diff bosses.reference.json against the boss numbers in data/enemies.json by hand;
#    update any drifted numbers in the master, leave the editorial layer untouched.

# 4. bump sw.js VERSION so clients refetch data/enemies.json.
```

**Planned:** a `parse_enemies.py` that walks *all* AIDEF dumps (the 23 units'
dumps already exist in `dumps/bosses/`) and a `--check` diff mode, so step 3 is
automated. Until then `parse_bosses.py` covers the 10 bosses only.
