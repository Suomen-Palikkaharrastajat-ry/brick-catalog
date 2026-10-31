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

- `scripts/build-manifest.mjs` — Scans raw LDraw files and generates `library-manifest.json` and `version.json`.
- `scripts/build-indices.mjs` — Builds `parts-curated.json`, `parts-index.json`, and partitioned category files.
- `scripts/build-bundles.mjs` — Parses LDraw dependency graphs, prevents cycles, and inlines subfiles into self-contained `.mpd` packages.
- `scripts/build-all.mjs` — Master build pipeline preparing `dist/` for GitHub Pages deployment.
- `scripts/test-catalog.mjs` — Comprehensive validation suite testing manifest integrity, curated index schema, category partitions, 100% MPD DAG closure, and dashboard integrity.

## Licensing & Compliance

- **Attribution**: Explicit attribution to **The LDraw Parts Library** (LDraw.org) in all derivative outputs.
- **Licenses**: Creative Commons Attribution (CC BY 4.0 / CC BY 2.0) affirmed in [CAreadme.txt](raw/CAreadme.txt).
- **Trademarks**:
  - LEGO® is a registered trademark of the LEGO Group of companies, which does not sponsor, authorize, or endorse this project.
  - LDraw™ is a trademark owned and licensed by the Estate of James Jessiman.
- Refer to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full notices.

## Verification Commands

```bash
# Run complete catalog test suite (119 checks)
npm test

# Rebuild catalog and dist/ directory
npm run build

# Preview dashboard locally
npm run preview
```
