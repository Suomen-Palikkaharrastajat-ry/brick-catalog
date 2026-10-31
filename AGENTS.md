# AGENTS.md — Brick Catalog

Standalone CDN-optimized LDraw parts catalog and MPD bundle repository published at `https://catalog.palikkaharrastajat.fi/` for Brick Frame applications (Viewer, Studio, Brick Play).

## Architecture & Responsibilities

`brick-catalog` provides pre-indexed manifests and transitively closed Multi-Part Documents (MPDs) to eliminate serialized HTTP round-trips and false-positive 404 trial requests on clients:

1. **Deterministic Zero-404 Routing (`manifests/library-manifest.json`):** Exact O(1) file-to-path lookup table mapping part names to their actual paths (`parts/`, `p/`, `parts/s/`, `p/48/`).
2. **Pre-Bundled MPD Closure (`bundles/{part}.mpd`):** Self-contained packages with 100% of subparts and primitives inlined using `0 FILE` headers. Allows loading a complete complex model or part in a single HTTP request.
3. **Curated Index (`indices/parts-curated.json`):** Palette index strictly kept < 25 KB payload for instant decoding without UI thread lockup on mobile devices.
4. **Partitioned Categories (`indices/categories/{cat}.json`):** On-demand indices for `brick`, `plate`, `slope`, `tile`, `bracket`, and `technic`.
5. **Dashboard & Inspector (`index.html`):** Interactive status dashboard, category filter, part search, and transitive DAG closure inspector.

## Scripts & Pipeline

- `scripts/sync-ldraw.mjs` — Copies the LDraw library (or, with `--curated-only`, the curated parts' dependency closure plus `LDConfig.ldr`, `CAreadme.txt`, `CAlicense.txt` and `CAlicense4.txt`) into the gitignored `raw/`, and writes `raw/.ldraw-source` (source, commit, date). Remote source: `library.ldraw.org` `complete.zip`, falling back to the `kulits/ldraw-parts` GitHub mirror (`codeload.github.com/kulits/ldraw-parts/zip/refs/heads/master`, files under `ldraw-parts-master/ldraw/`). CI deploys always sync the current library, so visible curated part numbers must be real parts (not `~Moved to` stubs) in the current LDraw release.
- `scripts/build-manifest.mjs` — Scans raw LDraw files and generates `library-manifest.json` and `version.json` (`ldrawRelease` comes from `LDRAW_RELEASE`, else `raw/.ldraw-source`, else `"current"`).
- `scripts/build-indices.mjs` — Validates `data/curated-parts.json` against `raw/` and builds `parts-curated.json`, `parts-index.json`, and partitioned category files from the visible (non-hidden) entries; copies `data/elements-index.json` unfiltered.
- `scripts/build-bundles.mjs` — Parses LDraw dependency graphs, prevents cycles, and inlines subfiles into self-contained `.mpd` packages.
- `scripts/build-all.mjs` — Master build pipeline preparing `dist/` for GitHub Pages deployment. Empties `dist/` first and fails when `raw/` has not been synced (there is no pre-built fallback).
- `scripts/test-catalog.mjs` — Comprehensive validation suite testing manifest integrity, curated index schema, category partitions, 100% MPD DAG closure, and dashboard integrity.

## Curated List: Hidden, Moved and Legacy Parts

Each entry of `data/curated-parts.json` is `{file, name, category, description, keywords}` plus two optional flags:

- `"hidden": true` — the file stays in the sync closure, gets `bundles/<n>.mpd` and is routed by the manifest (old models keep loading), but it is left out of `parts-curated.json`, `parts-index.json` and `categories/*.json`. `elements-index.json` is never filtered.
- `"movedTo": "<target>.dat"` — required on hidden entries whose LDraw file is a `0 ~Moved to <target>` stub; it must equal the stub's target, and the chain of `movedTo` entries must end at a visible curated entry. Put the old number in the target's `keywords`.

Hidden entries without `movedTo` are legacy parts kept for old models (e.g. `3794b.dat`). `build-indices` fails the build when a visible entry is a `~Moved to` stub, when a hidden `movedTo` no longer matches upstream or the file is no longer a stub (un-hide it), when a chain ends at a missing or hidden entry, or when a curated file is missing from `raw/parts/`. When a weekly CI run fails this way, fix the curated list rather than the scripts.

## Generated Files

`raw/`, `dist/`, `manifests/`, `indices/` and `bundles/` are build output and gitignored; never commit them. Only sources (`data/`, `scripts/`, `index.html`, `CNAME`, docs) are tracked. Local workflow: `npm run sync -- --curated-only && npm run build && npm test`. Brick Play's Vite dev server serves `../brick-catalog/dist`.

## Licensing & Compliance

- **Attribution**: Explicit attribution to **The LDraw Parts Library** (LDraw.org) in all derivative outputs.
- **Licenses**: Creative Commons Attribution (CC BY 4.0 / CC BY 2.0) affirmed in [CAreadme.txt](raw/CAreadme.txt).
- **Trademarks**:
  - LEGO® is a registered trademark of the LEGO Group of companies, which does not sponsor, authorize, or endorse this project.
  - LDraw™ is a trademark owned and licensed by the Estate of James Jessiman.
- Refer to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full notices.

## Verification Commands

```bash
# Run complete catalog test suite (about 60 fixed checks plus one per MPD bundle)
npm test

# Sync the curated closure from the current LDraw library into raw/
npm run sync -- --curated-only

# Rebuild catalog and dist/ directory
npm run build

# Preview dashboard locally
npm run preview
```
