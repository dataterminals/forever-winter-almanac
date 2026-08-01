#!/usr/bin/env python3
"""
Rebuild data/weapons.json — datamined stats, wiki trimmings.

Every number a player can actually be wrong about (damage, rate of fire,
magazine, weight, value, XP, calibre) is read from the shipping game files via
the datamine repo. The wiki supplies only the presentation layer — the display
name we key on, the class grouping, and the three "stats" the game does not
store as fields (accuracy, recoil, stability), which the devs flag as WIP
aggregates.

Why: this file used to be pure wiki scrape, and it drifted. Measured against
build 24501089 it had 16 of 51 weapons wrong — the LMG/HMG rows still carried
pre-24479102 values, and every shotgun was ~200x off because the wiki quotes a
whole-spread total while the game stores damage PER PELLET.

Shotguns are the one place the two sources disagree about meaning rather than
value. `NumberOfBuckshots` is 20 on all six shotguns and 1 on everything else,
so we emit the per-pellet `damage` the game stores, plus `pellets` and the
derived `damagePerShot`, and let the app show all three.

Needs the (private) datamine repo as a sibling checkout, or FWDATA_ROOT set.
Without it this script REFUSES to write, rather than quietly regenerating the
wiki-only file this change exists to replace.

    python tools/fetch_weapons.py
"""
import json, re, os, sys, urllib.request, urllib.parse

API = "https://theforeverwinter.wiki.gg/api.php"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "weapons.json")
UA = {"User-Agent": "fw-almanac-weapondata/2.0 (github.com/dataterminals/forever-winter-almanac)"}

# The datamine is a separate, private repo (it holds decoded game assets). Same
# resolution order fwdata's own consumers use: env override, then sibling.
FWDATA_ROOT = os.environ.get("FWDATA_ROOT") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "forever-winter-datamine")

# Wiki pages whose `internalClass` names the weapon FAMILY rather than the variant
# the page is actually about. Keyed by page title -> the asset that matches its
# stats. Corroborated against the wiki's own rate-of-fire and magazine, which are
# variant-specific:
#   Surplus Rifle — wiki rof 7.41 / mag 10 == RFL01a (FireRate 0.135, MaxAmmo 10).
#   Plain RFL01 is the AK (FireRate 0.09 -> 11.11, no MaxAmmo of its own).
CODE_OVERRIDES = {
    "Surplus Rifle": "RFL01a",
}

# Fields we take from the game files. Anything not listed here stays wiki-sourced.
DATAMINED = ["damage", "pellets", "damagePerShot", "rof", "magazine",
             "weight", "value", "xp", "caliber"]
WIKI_ONLY = ["class", "accuracy", "recoil", "stability", "firemodes", "ammo"]


def api_get(params):
    params = dict(params); params["format"] = "json"
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return json.load(r)


def list_weapon_pages():
    out, cont = [], {}
    while True:
        d = api_get({"action": "query", "list": "categorymembers",
                     "cmtitle": "Category:Weapons", "cmtype": "page", "cmlimit": "500", **cont})
        out += [m["title"] for m in d["query"]["categorymembers"]]
        if "continue" in d: cont = d["continue"]
        else: break
    return out


def fetch_wikitext_batch(titles):
    res = {}
    for i in range(0, len(titles), 45):
        chunk = titles[i:i + 45]
        d = api_get({"action": "query", "prop": "revisions", "rvslots": "main",
                     "rvprop": "content", "titles": "|".join(chunk), "redirects": "1"})
        norm = {n["from"]: n["to"] for n in d["query"].get("normalized", [])}
        redir = {r["from"]: r["to"] for r in d["query"].get("redirects", [])}
        for p in d["query"]["pages"].values():
            if "revisions" in p:
                res[p["title"]] = p["revisions"][0]["slots"]["main"]["*"]
        for frm, to in {**norm, **redir}.items():
            if to in res: res[frm] = res[to]
    return res


def ib(wt, key):
    m = re.search(r'\n\s*\|\s*' + re.escape(key) + r'\s*=\s*([^\n]*)', wt)
    return m.group(1).strip() if m else None


def num(s):
    if s is None: return None
    m = re.search(r'-?\d+(?:\.\d+)?', s.replace(",", ""))
    return float(m.group(0)) if m else None


def as_int(s):
    v = num(s)
    return int(round(v)) if v is not None else None


def clean(s):
    if not s: return None
    # strip wiki link markup [[X|Y]] -> Y, [[X]] -> X, and templates
    s = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', s)
    s = re.sub(r"''+", "", s).strip()
    return s or None


def internal_code(wt):
    # BP_WPN_RFL01 / Inventory.Weapon.RFL01 -> RFL01 (joins to the datamine assets)
    for key in ("internalClass", "internalTag"):
        v = ib(wt, key)
        if v:
            m = re.search(r'(?:WPN[_.]|Weapon[_.])([A-Z0-9]+)', v)
            if m: return m.group(1)
            return v.split(".")[-1].split("_")[-1]
    return None


# ---------------------------------------------------------------- datamine ---

def load_datamine():
    """-> (build, {CODE: {damage, pellets, rof, magazine, weight, value, xp, caliber}}).

    Raises SystemExit if the datamine repo isn't reachable: emitting wiki numbers
    under a "datamined" banner is exactly the failure this rewrite removes.
    """
    root = os.path.abspath(FWDATA_ROOT)
    if not os.path.isdir(os.path.join(root, "fwdata")):
        raise SystemExit(
            f"no datamine repo at {root}\n"
            "  weapons.json is generated from the shipping game files; the wiki alone\n"
            "  is not accurate enough (see this script's docstring). Clone\n"
            "  forever-winter-datamine as a sibling, or set FWDATA_ROOT.")
    sys.path.insert(0, root)
    from fwdata import GAME_BUILD          # noqa: E402
    from fwdata.paths import find_dump      # noqa: E402

    def rows(stem, subdir=None):
        p = find_dump(stem, subdir)
        if not p: raise SystemExit(f"missing dump: {stem}")
        d = json.load(open(p, encoding="utf-8"))
        o = d[0] if isinstance(d, list) else d
        return o.get("Rows", {})

    values = rows("ValueV2_WEAPONS", "items")

    # The inventory table keys don't always equal the weapon-asset name: the DA is
    # DA_WPN_PLAYER_RFL01a / SHG02 while the rows are RFL01A_Surplus / SHG02_Surplus.
    # Index by the part before the first underscore, lowercased, so both forms hit.
    details = {}
    for k, v in rows("WeaponsDetailsData", "weapons").items():
        details.setdefault(k.split("_")[0].lower(), v)
        details[k.lower()] = v

    # per-weapon combat stats live one asset per gun
    dumps = os.path.join(root, "datamine", "dumps", "weapons")
    out = {}
    for fn in sorted(os.listdir(dumps)):
        if not fn.startswith("DA_WPN_PLAYER_") or not fn.endswith(".json"):
            continue
        code = fn[len("DA_WPN_PLAYER_"):-len(".json")]
        d = json.load(open(os.path.join(dumps, fn), encoding="utf-8"))
        p = (d[0] if isinstance(d, list) else d).get("Properties", {})

        rec = {}
        dmg = p.get("WeaponDamage")
        pellets = p.get("NumberOfBuckshots") or 1
        if dmg is not None:
            rec["damage"] = dmg
            if pellets > 1:
                # shotguns: the stored number is per pellet. Emit both so nobody
                # has to guess which one a wiki figure meant.
                rec["pellets"] = pellets
                rec["damagePerShot"] = round(dmg * pellets, 2)
        fr = p.get("FireRate")
        if fr:                       # stored as seconds/round; the app shows rounds/sec
            rec["rof"] = round(1.0 / fr, 2)
        if p.get("MaxAmmo"):
            rec["magazine"] = p["MaxAmmo"]
        cal = (p.get("AmmoTypeCaliber") or {}).get("TagName", "")
        if cal:
            rec["caliber"] = cal.rsplit(".", 1)[-1]

        det = details.get(code.lower()) or {}
        if det.get("Weight"):
            rec["weight"] = round(det["Weight"], 3)
        vrow = (det.get("ValueRow") or {}).get("RowName")
        val = values.get(vrow) if vrow else None
        if val:
            if val.get("Value") is not None:
                rec["value"] = val["Value"]
            if val.get("ExtractionExperienceValue") is not None:
                rec["xp"] = val["ExtractionExperienceValue"]
        out[code] = rec
    return GAME_BUILD, out


def dm_lookup(dm, code):
    """Join a wiki internal code to a datamine asset name.

    Case-insensitive: the game ships DA_WPN_PLAYER_RFL01b while the wiki writes
    RFL01B, and the variant suffix case is inconsistent in the assets themselves
    (FC_RFL01A_Damage vs FC_RFL01b_Damage).
    """
    if not code: return None
    if code in dm: return dm[code]
    lc = code.lower()
    for k, v in dm.items():
        if k.lower() == lc: return v
    return None


def main():
    build, dm = load_datamine()
    print(f"Datamine build {build} — {len(dm)} player weapon definitions")

    print("Enumerating Category:Weapons …")
    titles = list_weapon_pages()
    pages = fetch_wikitext_batch(titles)

    weapons, skipped, unmatched, matched_codes, claimed = {}, [], [], set(), {}
    for title in sorted(titles):
        wt = pages.get(title)
        # skip namespaced pages (Template:, User:, …) and non-weapon pages that
        # lack the damage/internalClass infobox fields
        if ":" in title or not wt or (ib(wt, "damage") is None and ib(wt, "internalClass") is None):
            skipped.append(title); continue
        rof = num(ib(wt, "rof"))
        w = {
            "class": clean(ib(wt, "category")) or clean(ib(wt, "type")),
            "damage": num(ib(wt, "damage")),
            "magazine": as_int(ib(wt, "magazine")),
            "accuracy": num(ib(wt, "accuracy")),
            "stability": num(ib(wt, "stability")),
            "recoil": num(ib(wt, "recoil")),
            "rof": round(rof, 2) if rof is not None else None,
            "firemodes": clean(ib(wt, "firemodes")),
            "weight": num(ib(wt, "weight")),
            "value": as_int(ib(wt, "base value")),
            "ammo": clean(ib(wt, "ammo")),
            "xp": as_int(ib(wt, "xp")),
            "internal": internal_code(wt),
        }
        w = {k: v for k, v in w.items() if v is not None}

        code = CODE_OVERRIDES.get(title, w.get("internal"))
        hit = dm_lookup(dm, code)
        if hit:
            w["internal"] = code     # record the variant we actually joined to
            w.update(hit)            # game files win on every field they define
            claimed.setdefault(code.lower(), []).append(title)
            matched_codes.add(code.lower())
        else:
            unmatched.append(f"{title} ({code or 'no internal code'})")
        weapons[title] = w

    matched = len(weapons) - len(unmatched)
    data = {
        "source": (f"The Forever Winter shipping game files (build {build}) — "
                   "DA_WPN_PLAYER_* weapon definitions + WeaponsDetailsData + ValueV2_WEAPONS, "
                   "decoded with CUE4Parse; theforeverwinter.wiki.gg infoboxes for display "
                   "name, class and the three non-stored handling stats"),
        "note": ("Damage, rate of fire, magazine, weight, value, XP and calibre come from the "
                 "game files and are authoritative. Accuracy, recoil and stability are not "
                 "stored fields — they are the wiki's transcription of the in-game aggregate, "
                 "which the devs flag as WIP. Shotgun `damage` is PER PELLET, as the game "
                 "stores it; `pellets` and `damagePerShot` give the whole-spread total."),
        "build": build,
        "provenance": {"datamined": DATAMINED, "wiki": WIKI_ONLY},
        "weapons": weapons,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)

    print(f"  {len(weapons)} weapons ({matched} joined to the datamine) -> {os.path.relpath(OUT)}")
    if unmatched:
        print(f"  !! {len(unmatched)} kept wiki-only (no datamine match): {', '.join(unmatched)}")
    # Two pages on one asset means at least one is a family code standing in for a
    # variant, and the wrong gun's stats got copied in. Add a CODE_OVERRIDES entry.
    for code, names in sorted(claimed.items()):
        if len(names) > 1:
            print(f"  !! collision: {', '.join(names)} all resolved to {code} — "
                  "one of these needs a CODE_OVERRIDES entry")
    missing = sorted(c for c in dm if c.lower() not in matched_codes)
    if missing:
        print(f"  note: {len(missing)} datamined weapons have no wiki page: {', '.join(missing)}")
    if skipped:
        print(f"  skipped {len(skipped)} non-weapon pages: {', '.join(skipped[:8])}"
              + (" …" if len(skipped) > 8 else ""))


if __name__ == "__main__":
    main()
