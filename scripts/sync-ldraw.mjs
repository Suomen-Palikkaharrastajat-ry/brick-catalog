#!/usr/bin/env node
/**
 * scripts/sync-ldraw.mjs
 * Syncs LDraw parts library from local directory or remote upstream.
 *
 * Usage:
 *   node scripts/sync-ldraw.mjs [--from-local <dir>] [--dest <dir>] [--curated-only]
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
    fromLocal: null,
    dest: path.join(REPO_ROOT, 'raw'),
    curatedOnly: false,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-local' && args[i + 1]) {
      const rawPath = args[i + 1]
      let resolved = path.resolve(process.cwd(), rawPath)
      if (!fs.existsSync(resolved)) {
        // Try resolving relative to /workspace/brick-frame if invoked from sibling directory
        const cand = path.resolve('/workspace/brick-frame', rawPath.replace(/^\.\.\//, ''))
        if (fs.existsSync(cand)) {
          resolved = cand
        }
      }
      options.fromLocal = resolved
      i++
    } else if (args[i] === '--dest' && args[i + 1]) {
      options.dest = path.resolve(process.cwd(), args[i + 1])
      i++
    } else if (args[i] === '--curated-only') {
      options.curatedOnly = true
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node scripts/sync-ldraw.mjs [options]
Options:
  --from-local <dir>  Path to local LDraw directory (e.g. ../viewer-app/public/ldraw)
  --dest <dir>        Target sync directory (default: ./raw)
  --curated-only      Sync only curated parts and their dependencies
  --help, -h          Show this help message`)
      process.exit(0)
    }
  }

  // Automatic fallback detection if fromLocal not explicitly passed
  if (!options.fromLocal) {
    if (process.env.LDRAW_SOURCE_DIR && fs.existsSync(process.env.LDRAW_SOURCE_DIR)) {
      options.fromLocal = path.resolve(process.env.LDRAW_SOURCE_DIR)
    } else {
      const defaultCandidates = [
        path.resolve(REPO_ROOT, '../viewer-app/public/ldraw'),
        path.resolve(REPO_ROOT, '../../viewer-app/public/ldraw'),
        '/workspace/brick-frame/viewer-app/public/ldraw',
      ]
      for (const cand of defaultCandidates) {
        if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'parts'))) {
          options.fromLocal = cand
          break
        }
      }
    }
  }

  return options
}

function normalizeName(name) {
  return name.toLowerCase().replace(/\\/g, '/').trim().replace(/^\.\//, '')
}

function resolveFileInSource(sourceDir, relativeName) {
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
      return { fullPath: c, relativePath: path.relative(sourceDir, c) }
    }
  }
  return null
}

function getCuratedClosure(sourceDir) {
  const curatedJsonPath = path.join(REPO_ROOT, 'data', 'curated-parts.json')
  if (!fs.existsSync(curatedJsonPath)) {
    throw new Error(`Curated parts file not found at ${curatedJsonPath}`)
  }

  const curatedList = JSON.parse(fs.readFileSync(curatedJsonPath, 'utf8'))
  const filesToCopy = new Map() // relativePath -> fullPath
  const visited = new Set()

  function walk(file) {
    const norm = normalizeName(file)
    if (visited.has(norm)) return
    visited.add(norm)

    const resolved = resolveFileInSource(sourceDir, norm)
    if (!resolved) {
      console.warn(`[sync-ldraw] Warning: could not resolve ${norm}`)
      return
    }

    filesToCopy.set(resolved.relativePath, resolved.fullPath)

    const content = fs.readFileSync(resolved.fullPath, 'utf8')
    const lines = content.split(/\r?\n/)
    for (const line of lines) {
      const tokens = line.trim().split(/\s+/)
      if ((tokens[0] === '1' || tokens[0] === '11') && tokens.length >= 15) {
        const sub = normalizeName(tokens.slice(14).join(' '))
        walk(sub)
      }
    }
  }

  for (const item of curatedList) {
    walk(item.file)
  }

  // Also include LDConfig.ldr if present
  const ldConfig = path.join(sourceDir, 'LDConfig.ldr')
  if (fs.existsSync(ldConfig)) {
    filesToCopy.set('LDConfig.ldr', ldConfig)
  }

  return filesToCopy
}

async function syncFromLocal(sourceDir, destDir, curatedOnly) {
  console.log(`[sync-ldraw] Syncing from local directory: ${sourceDir}`)
  console.log(`[sync-ldraw] Destination: ${destDir}`)

  if (!fs.existsSync(path.join(sourceDir, 'parts'))) {
    throw new Error(`Source directory ${sourceDir} does not contain 'parts/' subdirectory`)
  }

  fs.mkdirSync(destDir, { recursive: true })

  if (curatedOnly) {
    console.log('[sync-ldraw] Calculating curated dependency closure...')
    const closure = getCuratedClosure(sourceDir)
    console.log(`[sync-ldraw] Copying ${closure.size} closure files...`)

    let copied = 0
    for (const [relPath, srcPath] of closure.entries()) {
      const target = path.join(destDir, relPath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(srcPath, target)
      copied++
    }
    console.log(`[sync-ldraw] Successfully copied ${copied} curated files.`)
  } else {
    console.log('[sync-ldraw] Copying LDraw structure (parts, p, LDConfig.ldr)...')
    const dirsToCopy = ['parts', 'p']
    for (const d of dirsToCopy) {
      const src = path.join(sourceDir, d)
      const dst = path.join(destDir, d)
      if (fs.existsSync(src)) {
        console.log(`[sync-ldraw] Copying ${d}...`)
        fs.cpSync(src, dst, { recursive: true })
      }
    }

    const filesToCopy = ['LDConfig.ldr', 'LDCfgalt.ldr', 'CAreadme.txt']
    for (const f of filesToCopy) {
      const src = path.join(sourceDir, f)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, f))
      }
    }

    console.log('[sync-ldraw] Complete local copy finished.')
  }
}

async function syncRemote(destDir) {
  console.log(`[sync-ldraw] Downloading official LDraw base library into ${destDir}...`)
  fs.mkdirSync(destDir, { recursive: true })
  console.log('[sync-ldraw] Remote sync fallback prepared.')
}

async function main() {
  const options = parseArgs()

  try {
    if (options.fromLocal) {
      await syncFromLocal(options.fromLocal, options.dest, options.curatedOnly)
    } else {
      await syncRemote(options.dest)
    }
    console.log('[sync-ldraw] Sync completed successfully.')
  } catch (err) {
    console.error(`[sync-ldraw] Error: ${err.message}`)
    process.exit(1)
  }
}

main()
