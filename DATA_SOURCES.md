---
title: TailWag Filament Data Sources
tags:
  - tailwag
  - data
  - licensing
---

# Filament data sources and policy

This file records where every bundled filament value comes from, and the rules for adding more. Update it whenever bundled data changes.

> [!important] Policy
> 1. Ship only data that is public, self-measured, or permission-cleared.
> 2. Every bundled entry records a `source` and, where known, a `sourceUrl`. A test enforces this.
> 3. Third-party lists (for example HueForge exports) are **import-only**. They are loaded by the user at runtime and never committed or bundled unless their terms are checked and recorded here.
> 4. Colors are approximate. TD is an estimate until the user's own calibration replaces it. Never present either as a measurement.

## Bundled datasets

| Dataset | File | Entries | Provenance | Status |
|---|---|---|---|---|
| Original verified catalog | `src/data/filamentCatalog.ts` (`VERIFIED_FILAMENT_CATALOG`) | ~50 | Hand-entered earlier in the project. The origin of the individual TD values was **not recorded**. | Needs a source pass. Treat TD as `catalog` (nominal). |
| Manufacturer catalog | `src/data/manufacturerCatalog.ts` (`ROWS`) | ~85 | Approximate colors compiled from public manufacturer color charts. TD from the hue/lightness prior in `src/engine/tdPrior.ts`. | All entries `confidence: 'approx'`, TD `estimate`. |
| Default personal library | `src/data/userDefaultFilaments.json` | 36 | The project owner's own HueForge `filaments.json` export, used as the default seed. | Owner's own data. Repo is currently private. Revisit before any public release. |

## Brand source pages

Defined in `BRAND_SOURCES` in `src/data/manufacturerCatalog.ts`: Bambu Lab, Polymaker, eSun, Elegoo, Sunlu, Hatchbox, Overture, Prusament, Creality. These are the public pages a reviewer should check an entry against. They are links for verification, not a statement that the data was copied from them.

## Adding or correcting an entry

1. Preferred: open a **Filament data** issue (the app's per-entry link prefills it). Include brand, product line, color name, hex, and how the color or TD was obtained.
2. Maintainer adds the row, keeps `confidence: 'approx'` unless the value was measured, and sets the brand in `BRAND_SOURCES` if new.
3. A user who measured their own spool should use the in-app calibration, which stores TD as `measured` locally. Measured values are personal and are not added to the bundle.

## Third-party lists

- HueForge and similar exports can be imported by the user (`Import filaments.json`). They stay on the user's machine.
- Before bundling any third-party list: record the license or written permission here, the date, and the entries affected. If there is no clear permission, do not bundle.

## Open items

- Record the origin of the original ~50 TD values, or downgrade them to `estimate`.
- Decide whether `userDefaultFilaments.json` should stay in the repo if it becomes public.
- Replace approximate colors with values checked against each manufacturer's page, brand by brand.
