#!/usr/bin/env node
/**
 * scripts/build-all.mjs
 * Master build orchestrator:
 *  1. Scans LDraw files and generates manifests
 *  2. Generates curated, full, and partitioned category indices
 *  3. Builds self-contained MPD bundles
 *  4. Prepares dist/ directory for GitHub Pages deployment
 *  5. Copies CNAME and dashboard index.html
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

function detectSourceDir() {
  const candidates = [
    path.join(REPO_ROOT, 'raw'),
    path.resolve(REPO_ROOT, '../brick-frame/viewer-app/public/ldraw'),
    path.resolve(REPO_ROOT, '../viewer-app/public/ldraw'),
    '/workspace/brick-frame/viewer-app/public/ldraw',
  ]
  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'parts'))) {
      return cand
    }
  }
  return null
}

function hasPrebuiltArtifacts() {
  const manifestPath = path.join(REPO_ROOT, 'manifests', 'library-manifest.json')
  const curatedPath = path.join(REPO_ROOT, 'indices', 'parts-curated.json')
  const bundlesDir = path.join(REPO_ROOT, 'bundles')

  return (
    fs.existsSync(manifestPath) &&
    fs.existsSync(curatedPath) &&
    fs.existsSync(bundlesDir) &&
    fs.readdirSync(bundlesDir).some((f) => f.endsWith('.mpd'))
  )
}

function deployPrebuiltArtifacts(distDir) {
  console.log('[build-all] Notice: No raw LDraw source found, but pre-built manifests, indices, and bundles exist in repository.')
  console.log('[build-all] Deploying pre-built catalog artifacts directly to dist/...\n')

  // 1. Deploy Manifests
  console.log('[1/5] Deploying Pre-Built Manifests...')
  const distManifests = path.join(distDir, 'manifests')
  fs.mkdirSync(distManifests, { recursive: true })
  fs.cpSync(path.join(REPO_ROOT, 'manifests'), distManifests, { recursive: true })
  console.log('[build-all] Copied manifests/ to dist/manifests/')

  // 2. Deploy Indices
  console.log('\n[2/5] Deploying Pre-Built Indices...')
  const distIndices = path.join(distDir, 'indices')
  fs.mkdirSync(distIndices, { recursive: true })
  fs.cpSync(path.join(REPO_ROOT, 'indices'), distIndices, { recursive: true })
  console.log('[build-all] Copied indices/ to dist/indices/')

  // 3. Deploy Bundles
  console.log('\n[3/5] Deploying Pre-Built MPD Bundles...')
  const distBundles = path.join(distDir, 'bundles')
  fs.mkdirSync(distBundles, { recursive: true })
  fs.cpSync(path.join(REPO_ROOT, 'bundles'), distBundles, { recursive: true })
  console.log('[build-all] Copied bundles/ to dist/bundles/')

  // 4. Copy Dashboard & Assets
  console.log('\n[4/5] Packaging Dashboard & Static Assets...')
  const indexPath = path.join(REPO_ROOT, 'index.html')
  if (fs.existsSync(indexPath)) {
    fs.copyFileSync(indexPath, path.join(distDir, 'index.html'))
    console.log('[build-all] Copied index.html to dist/')
  }

  const cnamePath = path.join(REPO_ROOT, 'CNAME')
  if (fs.existsSync(cnamePath)) {
    fs.copyFileSync(cnamePath, path.join(distDir, 'CNAME'))
    console.log('[build-all] Copied CNAME to dist/')
  }

  // 5. Raw Fallback Assets (LDConfig.ldr & CAreadme.txt & compatibility indices)
  console.log('\n[5/5] Deploying Raw Fallback Configs & Compatibility Indices...')
  const distRaw = path.join(distDir, 'raw')
  fs.mkdirSync(distRaw, { recursive: true })
  const localLdConfig = path.join(REPO_ROOT, 'raw', 'LDConfig.ldr')
  if (fs.existsSync(localLdConfig)) {
    fs.copyFileSync(localLdConfig, path.join(distRaw, 'LDConfig.ldr'))
    console.log('[build-all] Copied LDConfig.ldr to dist/raw/')
  }
  const localCAreadme = path.join(REPO_ROOT, 'raw', 'CAreadme.txt')
  if (fs.existsSync(localCAreadme)) {
    fs.copyFileSync(localCAreadme, path.join(distRaw, 'CAreadme.txt'))
    console.log('[build-all] Copied CAreadme.txt to dist/raw/')
  }

  // Copy raw/parts/ and raw/p/ into dist/raw/parts/ and dist/raw/p/
  const rawParts = path.join(REPO_ROOT, 'raw', 'parts')
  if (fs.existsSync(rawParts)) {
    fs.cpSync(rawParts, path.join(distRaw, 'parts'), { recursive: true })
    console.log('[build-all] Copied raw/parts/ to dist/raw/parts/')
  }
  const rawP = path.join(REPO_ROOT, 'raw', 'p')
  if (fs.existsSync(rawP)) {
    fs.cpSync(rawP, path.join(distRaw, 'p'), { recursive: true })
    console.log('[build-all] Copied raw/p/ to dist/raw/p/')
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
  console.log('       BUILD COMPLETED SUCCESSFULLY (PRE-BUILT ARTIFACTS)')
  console.log('========================================================')
  console.log(`Artifacts deployed in: ${distDir}`)
}

async function main() {
  console.log('========================================================')
  console.log('          BRICK CATALOG — MASTER BUILD PIPELINE         ')
  console.log('========================================================')

  const distDir = path.join(REPO_ROOT, 'dist')
  fs.mkdirSync(distDir, { recursive: true })

  const sourceDir = detectSourceDir()
  if (!sourceDir) {
    if (hasPrebuiltArtifacts()) {
      deployPrebuiltArtifacts(distDir)
      return
    }

    console.error('[build-all] Error: No LDraw library found and no pre-built artifacts available in repository.')
    console.error('[build-all] Run "node scripts/sync-ldraw.mjs" to download the library first.')
    process.exit(1)
  }
  console.log(`[build-all] Using LDraw source: ${sourceDir}`)

  // 1. Build Manifests
  console.log('\n[1/5] Building Library Manifest & Version Metadata...')
  const distManifests = path.join(distDir, 'manifests')
  const localManifests = path.join(REPO_ROOT, 'manifests')
  buildManifest(sourceDir, distManifests)
  // Mirror to repo manifests/
  fs.mkdirSync(localManifests, { recursive: true })
  fs.cpSync(distManifests, localManifests, { recursive: true })

  // 2. Build Indices
  console.log('\n[2/5] Building Search & Palette Indices...')
  const distIndices = path.join(distDir, 'indices')
  const localIndices = path.join(REPO_ROOT, 'indices')
  buildIndices(sourceDir, distIndices)
  // Mirror to repo indices/
  fs.mkdirSync(localIndices, { recursive: true })
  fs.cpSync(distIndices, localIndices, { recursive: true })

  // 3. Build Bundles
  console.log('\n[3/5] Compiling Self-Contained MPD Bundles...')
  const distBundles = path.join(distDir, 'bundles')
  const localBundles = path.join(REPO_ROOT, 'bundles')
  buildBundles(sourceDir, distBundles)
  // Mirror to repo bundles/
  fs.mkdirSync(localBundles, { recursive: true })
  fs.cpSync(distBundles, localBundles, { recursive: true })

  // 4. Copy Dashboard & Assets
  console.log('\n[4/5] Packaging Dashboard & Static Assets...')
  const indexPath = path.join(REPO_ROOT, 'index.html')
  if (fs.existsSync(indexPath)) {
    fs.copyFileSync(indexPath, path.join(distDir, 'index.html'))
    console.log('[build-all] Copied index.html to dist/')
  }

  const cnamePath = path.join(REPO_ROOT, 'CNAME')
  if (fs.existsSync(cnamePath)) {
    fs.copyFileSync(cnamePath, path.join(distDir, 'CNAME'))
    console.log('[build-all] Copied CNAME to dist/')
  }

  // 5. Raw Fallback Assets (LDConfig.ldr, CAreadme.txt, and compatibility indices)
  console.log('\n[5/5] Deploying Raw Fallback Configs & Compatibility Indices...')
  const distRaw = path.join(distDir, 'raw')
  fs.mkdirSync(distRaw, { recursive: true })
  const ldConfigPath = path.join(sourceDir, 'LDConfig.ldr')
  if (fs.existsSync(ldConfigPath)) {
    fs.copyFileSync(ldConfigPath, path.join(distRaw, 'LDConfig.ldr'))
    console.log('[build-all] Copied LDConfig.ldr to dist/raw/')
  }
  const caReadmePath = path.join(sourceDir, 'CAreadme.txt')
  if (fs.existsSync(caReadmePath)) {
    fs.copyFileSync(caReadmePath, path.join(distRaw, 'CAreadme.txt'))
    console.log('[build-all] Copied CAreadme.txt to dist/raw/')
  } else if (fs.existsSync(path.join(REPO_ROOT, 'raw', 'CAreadme.txt'))) {
    fs.copyFileSync(path.join(REPO_ROOT, 'raw', 'CAreadme.txt'), path.join(distRaw, 'CAreadme.txt'))
    console.log('[build-all] Copied CAreadme.txt to dist/raw/')
  }

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
