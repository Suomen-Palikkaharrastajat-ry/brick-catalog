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

async function main() {
  console.log('========================================================')
  console.log('       BRICK PLAY CATALOG — MASTER BUILD PIPELINE        ')
  console.log('========================================================')

  const sourceDir = detectSourceDir()
  if (!sourceDir) {
    console.error('[build-all] Error: No LDraw library found. Run "npm run sync" first.')
    process.exit(1)
  }
  console.log(`[build-all] Using LDraw source: ${sourceDir}`)

  const distDir = path.join(REPO_ROOT, 'dist')
  fs.mkdirSync(distDir, { recursive: true })

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

  // 5. Raw Fallback Assets (LDConfig.ldr)
  console.log('\n[5/5] Deploying Raw Fallback Configs...')
  const distRaw = path.join(distDir, 'raw')
  fs.mkdirSync(distRaw, { recursive: true })
  const ldConfigPath = path.join(sourceDir, 'LDConfig.ldr')
  if (fs.existsSync(ldConfigPath)) {
    fs.copyFileSync(ldConfigPath, path.join(distRaw, 'LDConfig.ldr'))
    console.log('[build-all] Copied LDConfig.ldr to dist/raw/')
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
