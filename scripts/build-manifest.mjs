#!/usr/bin/env node
/**
 * scripts/build-manifest.mjs
 * Scans LDraw directory and generates:
 *  - manifests/library-manifest.json (exact file-to-path mapping for zero-404 O(1) routing)
 *  - manifests/version.json (version, stats, generation timestamp)
 *
 * Usage:
 *   node scripts/build-manifest.mjs [--source <dir>] [--dest <dir>]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    source: null,
    dest: path.join(REPO_ROOT, 'manifests'),
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      options.source = path.resolve(process.cwd(), args[i + 1])
      i++
    } else if (args[i] === '--dest' && args[i + 1]) {
      options.dest = path.resolve(process.cwd(), args[i + 1])
      i++
    }
  }

  if (!options.source) {
    const candidates = [
      path.join(REPO_ROOT, 'raw'),
      path.resolve(REPO_ROOT, '../viewer-app/public/ldraw'),
      '/workspace/brick-frame/viewer-app/public/ldraw',
    ]
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'parts'))) {
        options.source = cand
        break
      }
    }
  }

  return options
}

function normalizeName(name) {
  return name.toLowerCase().replace(/\\/g, '/').trim().replace(/^\.\//, '')
}

function scanDirectoryFiles(dir, baseDir) {
  const results = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...scanDirectoryFiles(full, baseDir))
    } else if (entry.isFile() && (entry.name.endsWith('.dat') || entry.name.endsWith('.ldr'))) {
      results.push({
        fullPath: full,
        relativePath: path.relative(baseDir, full).replace(/\\/g, '/'),
        name: normalizeName(entry.name),
      })
    }
  }
  return results
}

export function buildManifest(sourceDir, destDir) {
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    throw new Error(`Source LDraw directory does not exist: ${sourceDir}`)
  }

  console.log(`[build-manifest] Scanning LDraw library in: ${sourceDir}`)
  console.log(`[build-manifest] Target output: ${destDir}`)

  const manifest = {}
  let partsCount = 0
  let subpartsCount = 0
  let primitivesCount = 0

  // 1. Scan parts/
  const partsDir = path.join(sourceDir, 'parts')
  if (fs.existsSync(partsDir)) {
    const partsEntries = fs.readdirSync(partsDir, { withFileTypes: true })
    for (const entry of partsEntries) {
      if (entry.isFile() && entry.name.endsWith('.dat')) {
        const norm = normalizeName(entry.name)
        manifest[norm] = `parts/${entry.name}`
        partsCount++
      }
    }
  }

  // 2. Scan parts/s/ (subparts)
  const subpartsDir = path.join(sourceDir, 'parts', 's')
  if (fs.existsSync(subpartsDir)) {
    const subEntries = fs.readdirSync(subpartsDir, { withFileTypes: true })
    for (const entry of subEntries) {
      if (entry.isFile() && entry.name.endsWith('.dat')) {
        const norm = normalizeName(entry.name)
        manifest[`s/${norm}`] = `parts/s/${entry.name}`
        if (!manifest[norm]) {
          manifest[norm] = `parts/s/${entry.name}`
        }
        subpartsCount++
      }
    }
  }

  // 3. Scan p/ (primitives)
  const pDir = path.join(sourceDir, 'p')
  if (fs.existsSync(pDir)) {
    const pEntries = fs.readdirSync(pDir, { withFileTypes: true })
    for (const entry of pEntries) {
      if (entry.isFile() && entry.name.endsWith('.dat')) {
        const norm = normalizeName(entry.name)
        // If not already a part or subpart, record primitive
        if (!manifest[norm]) {
          manifest[norm] = `p/${entry.name}`
        }
        manifest[`p/${norm}`] = `p/${entry.name}`
        primitivesCount++
      }
    }
  }

  // 4. Scan p/48/ (high-res primitives)
  const p48Dir = path.join(sourceDir, 'p', '48')
  if (fs.existsSync(p48Dir)) {
    const p48Entries = fs.readdirSync(p48Dir, { withFileTypes: true })
    for (const entry of p48Entries) {
      if (entry.isFile() && entry.name.endsWith('.dat')) {
        const norm = normalizeName(entry.name)
        manifest[`48/${norm}`] = `p/48/${entry.name}`
        primitivesCount++
      }
    }
  }

  // 5. Scan p/8/ (low-res primitives)
  const p8Dir = path.join(sourceDir, 'p', '8')
  if (fs.existsSync(p8Dir)) {
    const p8Entries = fs.readdirSync(p8Dir, { withFileTypes: true })
    for (const entry of p8Entries) {
      if (entry.isFile() && entry.name.endsWith('.dat')) {
        const norm = normalizeName(entry.name)
        manifest[`8/${norm}`] = `p/8/${entry.name}`
        primitivesCount++
      }
    }
  }

  // 6. Include LDConfig.ldr if present
  if (fs.existsSync(path.join(sourceDir, 'LDConfig.ldr'))) {
    manifest['ldconfig.ldr'] = 'LDConfig.ldr'
  }

  fs.mkdirSync(destDir, { recursive: true })

  const manifestPath = path.join(destDir, 'library-manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')

  const totalEntries = Object.keys(manifest).length
  const versionData = {
    version: '1.0.0',
    ldrawRelease: '2023-01',
    generatedAt: new Date().toISOString(),
    stats: {
      totalManifestEntries: totalEntries,
      partsCount,
      subpartsCount,
      primitivesCount,
    },
  }

  const versionPath = path.join(destDir, 'version.json')
  fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2), 'utf8')

  console.log(`[build-manifest] Generated ${totalEntries} manifest entries:`)
  console.log(` - Parts: ${partsCount}`)
  console.log(` - Subparts: ${subpartsCount}`)
  console.log(` - Primitives: ${primitivesCount}`)
  console.log(`[build-manifest] Saved to ${manifestPath} and ${versionPath}`)

  return { manifest, versionData }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs()
  try {
    buildManifest(options.source, options.dest)
  } catch (err) {
    console.error(`[build-manifest] Error: ${err.message}`)
    process.exit(1)
  }
}
