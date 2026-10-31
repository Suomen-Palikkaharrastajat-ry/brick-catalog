# Palikkakehys LDraw Parts Catalog & CDN (`brick-catalog`)

Standalone, CDN-optimized LDraw catalog and MPD bundle repository published at **[https://catalog.palikkaharrastajat.fi/](https://catalog.palikkaharrastajat.fi/)**, designed for **Brick Frame** applications (Viewer, Studio, Brick Play).

---

## 1. Architectural Blueprint & Performance Gains

In traditional LDraw web applications, resolving a single LEGO part requires discovering dependencies layer by layer over high-latency HTTP connections. A standard 2×4 brick (`3001.dat`) requires discovering:
```text
3001.dat -> s/3001s01.dat -> box5.dat, box3u2p.dat, stud.dat -> 4-4cyli.dat, 4-4disc.dat, 4-4edge.dat...
```
On mobile cellular networks (40–120ms RTT), this 4–5 tier waterfall takes 500ms–1500ms of serialized round-trips for a single brick. Furthermore, 94.6% of parts start with a digit, which previously triggered false-positive 404 trial requests against primitive directories.

`brick-catalog` provides:
1. **1-Request Part Loading via Pre-Bundled MPDs:** Pre-compiles the entire transitive dependency graph into self-contained Multi-Part Documents (`bundles/<part>.mpd`). One single HTTP GET loads the part and 100% of its subparts and primitives.
2. **Deterministic Zero-404 Routing:** `manifests/library-manifest.json` provides an exact O(1) file-to-path lookup table, eliminating guesswork and false 404s.
3. **Lightweight Curated Index (< 25 KB):** `indices/parts-curated.json` contains essential curated building parts in an Elm-compatible schema (`{ version: 1, parts: [...] }`) with minimal payload, avoiding the 200–500ms main-thread JSON decoding freeze on mobile Safari.
4. **Partitioned Category Search:** `indices/categories/{category}.json` partitions parts on demand (bricks, plates, slopes, tiles, brackets/SNOT, technic).
5. **Zero Bloat in App Repository:** Offloads 623 MB and 37,000 files from `brick-frame`.

---

## 2. Directory Layout & CDN Endpoints

```text
brick-catalog/
├── CNAME                            # Custom domain: catalog.palikkaharrastajat.fi
├── index.html                       # Modern health status dashboard & MPD explorer
├── package.json                     # Pure Node.js ESM toolchain
├── manifests/
│   ├── library-manifest.json        # Exact file-to-path lookup table (zero-404 routing)
│   └── version.json                 # LDraw release version, file counts, build timestamp
├── indices/
│   ├── parts-curated.json           # Curated essential index (< 25 KB payload)
│   ├── parts-index.json             # Minified full index
│   └── categories/                  # Partitioned by category
│       ├── brick.json
│       ├── plate.json
│       ├── slope.json
│       ├── tile.json
│       ├── bracket.json
│       └── technic.json
├── bundles/                         # Self-contained pre-bundled MPDs (1 request = 1 part)
│   ├── 3001.mpd                     # 2x4 Brick with 100% transitive DAG closure
│   ├── 3647.mpd                     # Technic 8T Gear
│   └── ...
├── data/
│   └── curated-parts.json           # Catalog definitions for curated parts
├── scripts/
│   ├── sync-ldraw.mjs               # Syncs upstream LDraw or imports local parts
│   ├── build-manifest.mjs           # Generates library-manifest.json & version.json
│   ├── build-indices.mjs            # Generates curated, full, and category indices
│   ├── build-bundles.mjs            # Walks AST & compiles standalone MPDs with cycle check
│   ├── build-all.mjs                # Master build script preparing dist/ for Pages
│   ├── test-catalog.mjs             # Complete verification suite (manifest, closure, size)
│   └── preview.mjs                  # Lightweight local preview HTTP server
└── .github/
    └── workflows/
        ├── deploy.yml               # Automated GitHub Pages deployment
        └── sync-and-build.yml       # Weekly upstream sync & rebuild cron
```

---

## 3. Endpoints Specification

| Endpoint | Format | Description |
|---|---|---|
| `https://catalog.palikkaharrastajat.fi/` | HTML | Interactive status dashboard & MPD inspector |
| `https://catalog.palikkaharrastajat.fi/manifests/library-manifest.json` | JSON | Exact mapping: `{"3001.dat": "parts/3001.dat", ...}` |
| `https://catalog.palikkaharrastajat.fi/manifests/version.json` | JSON | Release version and catalog statistics |
| `https://catalog.palikkaharrastajat.fi/indices/parts-curated.json` | JSON | Curated palette index (< 25 KB) |
| `https://catalog.palikkaharrastajat.fi/indices/parts-index.json` | JSON | Full parts library index |
| `https://catalog.palikkaharrastajat.fi/indices/categories/{cat}.json` | JSON | Partitioned category index (`brick`, `plate`, `technic`, etc.) |
| `https://catalog.palikkaharrastajat.fi/bundles/{part}.mpd` | MPD | Self-contained pre-bundled MPD |
| `https://catalog.palikkaharrastajat.fi/raw/LDConfig.ldr` | LDR | Official LDraw color definitions |

---

## 4. Integration with `brick-frame`

Configure environment variables in `brick-frame`:

```env
VITE_LDRAW_BASE="https://catalog.palikkaharrastajat.fi/raw"
VITE_LDRAW_BUNDLES_BASE="https://catalog.palikkaharrastajat.fi/bundles"
VITE_LDRAW_INDICES_BASE="https://catalog.palikkaharrastajat.fi/indices"
VITE_LDRAW_MANIFEST_BASE="https://catalog.palikkaharrastajat.fi/manifests"
VITE_LDRAW_FALLBACK_BASE="https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw"
```

In Elm (`LDraw.Resolve`):
- Fetch bundled MPDs first via `bundles/{part}.mpd` and populate `PartCache` using `LDraw.Resolve.seedFromMpd`.
- When loading loose files, query `library-manifest.json` for deterministic O(1) URL resolution.
- Brick Play loads `indices/parts-curated.json` on startup (< 25 KB, instant parse).

---

## 5. Development & Build Commands

```bash
# Sync parts library from local directory (or download remote)
npm run sync -- --from-local ../viewer-app/public/ldraw

# Build manifest only
npm run build:manifest

# Build search indices (curated + categories)
npm run build:indices

# Build pre-bundled MPDs
npm run build:bundles

# Complete master build (manifests, indices, bundles, dashboard, CNAME -> dist/)
npm run build

# Run comprehensive test suite
npm test

# Launch local preview server (port 8182)
npm run preview
```

---

## 6. Licensing, Attribution & Trademarks

- **LEGO®** is a registered trademark of the LEGO Group of companies, which does not sponsor, authorize, or endorse this site or project.
- **LDraw™** is a trademark owned and licensed by the Estate of James Jessiman.
- **Parts Library Attribution**: Parts library data, configurations, and models are copyright © 2002–2026 **The LDraw Parts Library** (LDraw.org), redistributable under Creative Commons Attribution (**CC BY 4.0** / **CC BY 2.0**). See [CAreadme.txt](raw/CAreadme.txt) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Software License**: The catalog generation tooling, build pipeline, and dashboard interface are licensed under the **MIT License**.

