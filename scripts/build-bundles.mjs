#!/usr/bin/env node
/**
 * scripts/build-bundles.mjs
 * Generates self-contained pre-bundled MPD files for curated and common parts.
 *
 * Each MPD bundles the primary part together with all transitive subparts and
 * geometric primitives into a single file with `0 FILE <name>` headers,
 * enabling 1-request loading in Brick Frame without network waterfalls.
 *
 * Usage:
 *   node scripts/build-bundles.mjs [--source <dir>] [--dest <dir>] [--parts <comma-separated>]
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
    dest: path.join(REPO_ROOT, 'bundles'),
    parts: null,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      options.source = path.resolve(process.cwd(), args[i + 1])
      i++
    } else if (args[i] === '--dest' && args[i + 1]) {
      options.dest = path.resolve(process.cwd(), args[i + 1])
      i++
    } else if (args[i] === '--parts' && args[i + 1]) {
      options.parts = args[i + 1].split(',').map((s) => s.trim())
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

function resolveFile(sourceDir, relativeName) {
  const norm = normalizeName(relativeName)
  const candidates = [
    path.join(sourceDir, 'parts', norm),
    path.join(sourceDir, 'p', norm),
    path.join(sourceDir, 'parts', 's', norm.replace(/^s\//, '')),
    path.join(sourceDir, 'p', '48', norm.replace(/^48\//, '')),
    path.join(sourceDir, 'p', '8', norm.replace(/^8\//, '')),
    path.join(sourceDir, norm),
  ]

  for (const c of candidates) {
    if (fs.existsSync(c) && !fs.statSync(c).isDirectory()) {
      return { path: c, name: norm }
    }
  }
  return null
}

function extractSubfileReferences(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/)
    if ((tokens[0] === '1' || tokens[0] === '11') && tokens.length >= 15) {
      const sub = normalizeName(tokens.slice(14).join(' '))
      if (sub && !refs.includes(sub)) {
        refs.push(sub)
      }
    }
  }
  return refs
}

/**
 * Builds a single self-contained MPD string for a given part.
 */
export function buildMpdForPart(partFile, sourceDir) {
  const mainNorm = normalizeName(partFile)
  const mainResolved = resolveFile(sourceDir, mainNorm)
  if (!mainResolved) {
    throw new Error(`Cannot resolve main part file: ${partFile} in ${sourceDir}`)
  }

  const inlinedFiles = new Map() // normalizedName -> content
  const visited = new Set()
  let maxDepth = 0

  function walk(fileRef, currentDepth = 0) {
    const norm = normalizeName(fileRef)
    if (currentDepth > maxDepth) maxDepth = currentDepth
    if (currentDepth > 32) {
      console.warn(`[build-bundles] Recursion depth limit reached for ${norm} in ${partFile}`)
      return
    }
    if (visited.has(norm)) return
    visited.add(norm)

    const resolved = resolveFile(sourceDir, norm)
    if (!resolved) {
      throw new Error(`Missing dependency ${norm} referenced while bundling ${partFile}`)
    }

    const content = fs.readFileSync(resolved.path, 'utf8')
    inlinedFiles.set(norm, content)

    const subs = extractSubfileReferences(content)
    for (const sub of subs) {
      walk(sub, currentDepth + 1)
    }
  }

  walk(mainNorm, 0)

  // Assemble MPD with main file first
  let mpd = `0 FILE ${mainNorm}\n${inlinedFiles.get(mainNorm).trim()}\n`

  for (const [name, content] of inlinedFiles.entries()) {
    if (name === mainNorm) continue
    mpd += `0 FILE ${name}\n${content.trim()}\n`
  }

  // Validate closure
  const mpdFiles = new Set(inlinedFiles.keys())
  for (const [name, content] of inlinedFiles.entries()) {
    const subs = extractSubfileReferences(content)
    for (const sub of subs) {
      if (!mpdFiles.has(sub)) {
        throw new Error(`Closure validation failed in ${partFile}: subfile ${sub} referenced by ${name} is missing from bundle`)
      }
    }
  }

  return {
    mpd,
    totalFiles: inlinedFiles.size,
    maxDepth,
  }
}

export function buildBundles(sourceDir, destDir, targetParts = null) {
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    throw new Error(`Source LDraw directory does not exist: ${sourceDir}`)
  }

  fs.mkdirSync(destDir, { recursive: true })
  console.log(`[build-bundles] Bundling parts from ${sourceDir} into ${destDir}...`)

  let partsToBundle = targetParts
  if (!partsToBundle || partsToBundle.length === 0) {
    const curatedJsonPath = path.join(REPO_ROOT, 'data', 'curated-parts.json')
    if (fs.existsSync(curatedJsonPath)) {
      const list = JSON.parse(fs.readFileSync(curatedJsonPath, 'utf8'))
      partsToBundle = list.map((item) => item.file)
    } else {
      partsToBundle = ['3001.dat', '3004.dat', '3005.dat', '3647.dat', '4019.dat']
    }
  }

  console.log(`[build-bundles] Total parts to bundle: ${partsToBundle.length}`)

  let successCount = 0
  let totalBytes = 0

  for (const part of partsToBundle) {
    try {
      const { mpd, totalFiles, maxDepth } = buildMpdForPart(part, sourceDir)
      const bundleName = part.replace(/\.dat$/i, '') + '.mpd'
      const outPath = path.join(destDir, bundleName)

      fs.writeFileSync(outPath, mpd, 'utf8')
      const bytes = Buffer.byteLength(mpd, 'utf8')
      totalBytes += bytes
      successCount++

      if (successCount % 10 === 0 || successCount === partsToBundle.length) {
        console.log(`[build-bundles] Bundled ${successCount}/${partsToBundle.length}: ${bundleName} (${totalFiles} subfiles, ${(bytes / 1024).toFixed(1)} KB, depth ${maxDepth})`)
      }
    } catch (err) {
      console.error(`[build-bundles] Error bundling ${part}: ${err.message}`)
      throw err
    }
  }

  console.log(`[build-bundles] Successfully generated ${successCount} bundles (${(totalBytes / 1024).toFixed(1)} KB total).`)
  return { successCount, totalBytes }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs()
  try {
    buildBundles(options.source, options.dest, options.parts)
  } catch (err) {
    console.error(`[build-bundles] Error: ${err.message}`)
    process.exit(1)
  }
}
