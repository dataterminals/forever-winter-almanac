#!/usr/bin/env python3
"""
Rebuild data/attachments.json from the Forever Winter wiki.

Pulls the "Weapon Attachments (Text Only)" page (a maintained, machine-friendly
list) via the wiki.gg MediaWiki API and parses it into the weapon<->attachment
compatibility dataset the app consumes. No dependencies beyond Python 3.

    python tools/fetch_attachments.py
"""
import json, re, os, sys, urllib.request

API = "https://theforeverwinter.wiki.gg/api.php"
PAGE = "Weapon_Attachments_(Text_Only)"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "attachments.json")

# tokens that appear as [[links]] but are NOT weapons (slot codes, vendors, etc.)
NON_WEAPON = {"Aramaki", "Grillo", "Vendors", "BRL", "HDG", "HGD", "UPP", "MZD", "MZL",
              "FGR", "FLL", "LAM", "OPT", "SCP", "STK", "PGR", "MAG", "GAS", "CHG", "TRG",
              "weapon level", "weapon part", "weapon parts", "weapon", "enemy",
              "weapon mod container", "tank", "Picatinny", "attachments"}

CATS = [
    ("Muzzle Devices - MZD", "MZD", "Muzzle Devices"),
    ("Suppressed Muzzle Devices - SMZD", "SMZD", "Suppressed Muzzle Devices"),
    ("Foregrips - FGR", "FGR", "Foregrips"),
    ("Rail Mounted Flashlights - FLL", "FLL", "Rail Flashlights"),
    ("Rail Mounted Laser Sights - LAM", "LAM", "Rail Laser Sights"),
    ("Optics - OPT", "OPT", "Optics"),
    ("Scopes - SCP", "SCP", "Scopes"),
]

# best-effort weapon -> class map (weapons that take attachments)
CLASS_MAP = {}
def _c(cls, *ws):
    for w in ws: CLASS_MAP[w] = cls
_c("Pistol", "87 Target", "C96", "G-L 19", "PM-9", "R8", "USP", "Mateo Model J", "PnP-2K")
_c("SMG", "APC9 Pro", "Kriss Vector 45", "P90", "PP-19 Vityaz", "PPSH-41", "Spectre M4", "WLT MPL", "LMG-P")
_c("Rifle", "AK", "G36", "M16", "M4A1", "SA58", "SCAR", "TKB-0146", "VH-Ambi 2", "VIK-32L", "47 TYP", "Surplus Rifle", "Viper")
_c("Marksman & Sniper", "SVD", "R11 RSASS", "VKS VYKHLOP", "VKS Vykhlop", "GM6", "NTW-20", "36M AntiTank")
_c("LMG / HMG", "M60", "RPD", "RPK", "SAW", "MG34")
_c("Shotgun", "AA12", "S12", "USAS-12", "VEPR-12", "M79 Sawed-off", "Surplus Shotgun")
_c("Special / Launcher", "Grenade Launcher", "XM25", "AT-43 MASS", "Railgun", "Painless", "CLAW", "SOG")
CLASS_ORDER = ["Pistol", "SMG", "Rifle", "Marksman & Sniper", "LMG / HMG", "Shotgun", "Special / Launcher", "Other"]


def links(s):
    out = []
    for m in re.finditer(r'\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', s):
        t = m.group(1).strip()
        if t.lower().startswith(("file:", "category:")):
            continue
        out.append(t)
    return out

def weapons_only(names):
    return [n for n in names if n not in NON_WEAPON]

def strip_wiki(s):
    s = re.sub(r'\[\[File:[^\]]*\]\]', '', s)
    s = re.sub(r'\[\[([^\]|]+)\|([^\]]*)\]\]', r'\2', s)
    s = re.sub(r'\[\[([^\]]+)\]\]', r'\1', s)
    s = re.sub(r'<[^>]+>', '', s)
    return s.replace("'''", "").replace("''", "").strip()

def subtype_from(cell):
    m = re.search(r'T ATTMD(\d)', cell)
    if m: return "ATTMD" + m.group(1)
    m = re.search(r'T PIC([A-Z]+)\d', cell)
    if m: return "PIC" + m.group(1)
    return None

def fetch_wikitext(page):
    url = f"{API}?action=parse&page={page}&prop=wikitext&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "fw-gunsmith-datafetch/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    return d["parse"]["wikitext"]["*"]

def parse(wt):
    parts = re.split(r'\n==\s*(.+?)\s*==\n', wt)
    sections = {parts[i].strip(): parts[i + 1] for i in range(1, len(parts), 2)}

    attachments, categories = [], []
    for header, code, disp in CATS:
        body = next((sections[k] for k in sections
                     if k.replace("  ", " ").startswith(header)), None)
        if body is None:
            print("  ! missing section:", header, file=sys.stderr); continue

        # section-level compat: weapon list follows the last <br> after "Compatible with"
        sec_compat, sec_note = [], ""
        pre = body.split("{|", 1)[0]
        mm = re.search(r"Compatible with", pre)
        if mm:
            block = pre[mm.start():]
            sec_note = strip_wiki(re.sub(r'\[\[[^\]]*\]\]', '', block.split("<br>")[0]))
            listpart = block.rsplit("<br>", 1)[1] if "<br>" in block else ""
            sec_compat = weapons_only(links(listpart))

        tbl = body[body.find("{|"):]
        hdr_line = next((l for l in tbl.splitlines() if l.strip().startswith("!")), "")
        cols = [re.sub(r'\s*\(WIP\)', '', c.strip(" !").strip()) for c in re.split(r'!!', hdr_line)]

        def col(*names):
            for i, c in enumerate(cols):
                if any(n.lower() in c.lower() for n in names):
                    return i
            return None
        iN, iC, iD = col("Image and title"), col("Compatible with"), col("Default")
        iS, iZ = col("Suppressed"), col("Zoom")
        iBuy, iSell, iLoy = col("Buy"), col("Sell"), col("Sold by")
        iAcc, iStab = col("Accuracy"), col("Stability")

        n = 0
        for r in tbl.split("|-"):
            rr = " ".join(l for l in r.strip().splitlines() if not l.strip().startswith("|}")).strip()
            if not rr.startswith("|") or rr.startswith("|}") or rr.startswith("!"):
                continue
            cells = [c.strip() for c in re.split(r'\|\|', rr[1:])]
            if len(cells) < 3:
                continue
            g = lambda i: cells[i] if (i is not None and i < len(cells)) else ""
            name = strip_wiki(g(iN))
            if not name or name.lower() == "removed":
                continue
            cc = g(iC)
            compat = list(sec_compat) if ('"' in cc or not weapons_only(links(cc))) else weapons_only(links(cc))
            attachments.append({
                "id": f"{code}:{name}", "name": name, "category": code,
                "subtype": subtype_from(g(iN)),
                "buy": strip_wiki(g(iBuy)) or None, "sell": strip_wiki(g(iSell)) or None,
                "loyalty": strip_wiki(g(iLoy)) or None,
                "accuracy": strip_wiki(g(iAcc)) or None, "stability": strip_wiki(g(iStab)) or None,
                "zoom": strip_wiki(g(iZ)) or None,
                "default_on": weapons_only(links(g(iD))) if iD is not None else [],
                "suppressed": ("yes" in g(iS).lower()) if iS is not None else (code == "SMZD"),
                "compatible": compat,
            })
            n += 1
        categories.append({"code": code, "name": disp, "note": sec_note,
                           "section_compatible": sec_compat, "count": n})
        print(f"  {code:5s} {disp:24s} rows={n}")

    # invert to weapon index
    wset = {}
    for a in attachments:
        for w in a["compatible"]:
            wset.setdefault(w, {}).setdefault(a["category"], []).append(a["name"])
    weapons = [{"name": w, "class": CLASS_MAP.get(w, "Other"), "byCategory": wset[w],
                "total": sum(len(v) for v in wset[w].values())} for w in sorted(wset)]
    return categories, attachments, weapons

def main():
    print("Fetching", PAGE, "…")
    wt = fetch_wikitext(PAGE)
    categories, attachments, weapons = parse(wt)
    data = {
        "source": "theforeverwinter.wiki.gg - Weapon Attachments (Text Only)",
        "generated_note": "Community wiki data. Muzzle/Suppressed compat is per mount subtype; other categories are section-wide.",
        "classOrder": CLASS_ORDER,
        "categories": categories, "attachments": attachments, "weapons": weapons,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print(f"\n  {len(weapons)} weapons, {len(attachments)} attachments -> {os.path.relpath(OUT)}")

if __name__ == "__main__":
    main()
