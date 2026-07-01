# The Forever Winter — Gunsmith

A fast, installable, **offline** cross-reference for **which attachments fit which
weapons** in *The Forever Winter*.

The game is genuinely unhelpful here: at the vendor, every muzzle is just labelled
**“Muzzle Device A–Q”** (and suppressors **A–F**), with **no** indication of what
goes on what — you're expected to cross-check the wiki by hand every time. This app
turns that into three quick lookups.

Data comes from the [official wiki's attachment list](https://theforeverwinter.wiki.gg/wiki/Weapon_Attachments)
and is cross-checked against the game's own files.

**35 weapons · 68 attachments · 5 muzzle mount families.**

## Three ways to look it up

- **Weapons** — pick a gun, see *everything* that fits it, grouped by slot
  (muzzle, suppressor, foregrip, flashlight, laser, optic, scope). It names the
  gun's **muzzle mount family** up front, so you know which muzzle letters are valid.
- **Attachments** — pick an attachment (e.g. *Muzzle Dev. D*), see every weapon it
  fits, its price, loyalty-level, and accuracy/stability numbers.
- **Muzzle guide** — the whole muzzle system on one screen: the **5 mount families**
  (ATTMD1–5), which letters belong to each, and which weapons they fit. This is the
  bit the game hides worst.

## Features

- 🔎 Search weapons or attachments instantly
- 🔗 Tap any chip to jump between a weapon and its attachments (and back)
- 🎯 Muzzle **mount-family** grouping — match the family, not the letter
- 📱 **Installable PWA** — add it to a phone/second monitor home screen
- ✈️ **Works offline** — everything is cached after first load

## Use it

Open the published page (GitHub Pages) and, optionally, install it:

- **Desktop (Chrome/Edge):** click the install icon in the address bar.
- **Android (Chrome):** menu → *Add to Home screen*.
- **iOS (Safari):** Share → *Add to Home Screen*.

## How the compatibility works

- **Structural parts** (barrels, handguards, magazines, stocks, grips) are
  *weapon-specific* and unlocked by weapon level — not covered here.
- **Rail attachments** (optics, scopes, sights, foregrips, lights, lasers) mount on
  any weapon that exposes the matching Picatinny/upper slot.
- **Muzzle devices** come in **5 mount families**. A device only fits weapons in its
  family — this is the ATTMD1–5 grouping the *Muzzle guide* tab makes explicit.
- Some slots must be *unlocked* first by fitting the right structural part (e.g. the
  PP-19 needs its B barrel before it takes a suppressor; the SVD needs an upper
  assembly before it takes an optic).

> Stats are flagged **WIP** on the wiki — Accuracy and Magazine Capacity are the only
> stats that visibly change how a weapon performs. Values are community data and may
> lag game patches.

## Updating the data

If the wiki changes, re-pull and rebuild (needs Python 3, no dependencies):

```bash
python tools/fetch_attachments.py     # refetches the wiki list, rebuilds data/attachments.json
```

Icons are regenerated with Pillow:

```bash
python tools/generate_icons.py
```

## Credits

- Compatibility & stats: [The Forever Winter Wiki](https://theforeverwinter.wiki.gg/wiki/Weapon_Attachments) (CC BY-NC-SA), cross-checked against game data.
- Companion to the [Forever Winter Map Atlas](https://github.com/dataterminals/forever-winter-maps).
- Not affiliated with Fun Dog Studios.
