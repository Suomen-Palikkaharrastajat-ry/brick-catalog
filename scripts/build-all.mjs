#!/usr/bin/env node
/**
 * scripts/build-all.mjs
 * Master build orchestrator:
 *  1. Scans LDraw files and generates manifests
 *  2. Generates curated, full, and partitioned category indices
 *  3. Builds self-contained MPD bundles
 *  4. Prepares dist/ directory for GitHub Pages deployment (emptied first)
 *  5. Copies CNAME, THIRD_PARTY_NOTICES.md, dashboard index.html and the
 *     LDraw licence files (CAreadme.txt, CAlicense.txt, CAlicense4.txt)
 *
 * Requires an LDraw library in raw/ (run scripts/sync-ldraw.mjs first).
 * Everything this script writes goes to dist/, which is not tracked in git.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildManifest } from './build-manifest.mjs'
import { buildIndices } from './build-indices.mjs'
import { buildBundles } from './build-bundles.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

const LICENCE_FILES = ['CAreadme.txt', 'CAlicense.txt', 'CAlicense4.txt']

function copyLicenceFiles(dirs, distRaw) {
  for (const f of LICENCE_FILES) {
    const src = dirs.map((d) => path.join(d, f)).find((p) => fs.existsSync(p))
    if (src) {
      fs.copyFileSync(src, path.join(distRaw, f))
      console.log(`[build-all] Copied ${f} to dist/raw/`)
    } else if (!fs.existsSync(path.join(distRaw, f))) {
      console.warn(`[build-all] Warning: licence file ${f} not found; dist/raw/${f} is missing`)
    }
  }
}

function copyRootStatic(distDir) {
  for (const f of ['index.html', 'CNAME', 'THIRD_PARTY_NOTICES.md']) {
    const src = path.join(REPO_ROOT, f)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(distDir, f))
      console.log(`[build-all] Copied ${f} to dist/`)
    }
  }
}

function detectSourceDir() {
  const rawDir = path.join(REPO_ROOT, 'raw')
  if (fs.existsSync(path.join(rawDir, 'parts'))) {
    return rawDir
  }
  return null
}

async function main() {
  console.log('========================================================')
  console.log('          BRICK CATALOG — MASTER BUILD PIPELINE         ')
  console.log('========================================================')

  const distDir = path.join(REPO_ROOT, 'dist')

  const sourceDir = detectSourceDir()
  if (!sourceDir) {
    console.error('[build-all] Error: No LDraw library found in raw/ (raw/parts/ is missing).')
    console.error('[build-all] Run "npm run sync -- --curated-only" (or "node scripts/sync-ldraw.mjs") first.')
    process.exit(1)
  }
  console.log(`[build-all] Using LDraw source: ${sourceDir}`)

  // dist/ is pure build output: start from an empty directory so files that
  // are no longer part of the build (removed parts, old bundles) do not linger.
  fs.rmSync(distDir, { recursive: true, force: true })
  fs.mkdirSync(distDir, { recursive: true })

  // 1. Build Manifests
  console.log('\n[1/5] Building Library Manifest & Version Metadata...')
  const distManifests = path.join(distDir, 'manifests')
  buildManifest(sourceDir, distManifests)

  // 2. Build Indices
  console.log('\n[2/5] Building Search & Palette Indices...')
  const distIndices = path.join(distDir, 'indices')
  buildIndices(sourceDir, distIndices)

  // 3. Build Bundles
  console.log('\n[3/5] Compiling Self-Contained MPD Bundles...')
  const distBundles = path.join(distDir, 'bundles')
  buildBundles(sourceDir, distBundles)

  // 4. Copy Dashboard & Assets
  console.log('\n[4/5] Packaging Dashboard & Static Assets...')
  copyRootStatic(distDir)

  // 5. Raw Fallback Assets (LDConfig.ldr, LDraw licence files, and compatibility indices)
  console.log('\n[5/5] Deploying Raw Fallback Configs & Compatibility Indices...')
  const distRaw = path.join(distDir, 'raw')
  fs.mkdirSync(distRaw, { recursive: true })
  const ldConfigPath = path.join(sourceDir, 'LDConfig.ldr')
  if (fs.existsSync(ldConfigPath)) {
    fs.copyFileSync(ldConfigPath, path.join(distRaw, 'LDConfig.ldr'))
    console.log('[build-all] Copied LDConfig.ldr to dist/raw/')
  }
  copyLicenceFiles([sourceDir], distRaw)

  // Copy sourceDir/parts/ and sourceDir/p/ into dist/raw/parts/ and dist/raw/p/
  const srcParts = path.join(sourceDir, 'parts')
  if (fs.existsSync(srcParts)) {
    fs.cpSync(srcParts, path.join(distRaw, 'parts'), { recursive: true })
    console.log('[build-all] Copied sourceDir/parts/ to dist/raw/parts/')
  }
  const srcP = path.join(sourceDir, 'p')
  if (fs.existsSync(srcP)) {
    fs.cpSync(srcP, path.join(distRaw, 'p'), { recursive: true })
    console.log('[build-all] Copied sourceDir/p/ to dist/raw/p/')
  }

  // Mirror elements-index.json, parts-index.json, and parts-curated.json into dist/raw/
  const mirroredIndices = ['elements-index.json', 'parts-index.json', 'parts-curated.json']
  for (const file of mirroredIndices) {
    const srcFile = path.join(distIndices, file)
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(distRaw, file))
      console.log(`[build-all] Mirrored ${file} to dist/raw/`)
    }
  }

  console.log('\n========================================================')
  console.log('       BUILD COMPLETED SUCCESSFULLY — READY FOR PAGES    ')
  console.log('========================================================')
  console.log(`Artifacts generated in: ${distDir}`)
}

main().catch((err) => {
  console.error(`[build-all] Fatal Build Error: ${err.message}`)
  process.exit(1)
})
