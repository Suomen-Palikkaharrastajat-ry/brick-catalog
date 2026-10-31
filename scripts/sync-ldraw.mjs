#!/usr/bin/env node
/**
 * scripts/sync-ldraw.mjs
 * Syncs LDraw parts library from local directory or remote upstream.
 *
 * Usage:
 *   node scripts/sync-ldraw.mjs [--from-local <dir>] [--dest <dir>] [--curated-only]
 *
 * Writes <dest>/.ldraw-source (JSON provenance: source URL/path, commit, date,
 * syncedAt), which build-manifest.mjs uses for version.json `ldrawRelease`.
 * Provenance can be given with LDRAW_SOURCE_URL, LDRAW_SOURCE_COMMIT and
 * LDRAW_SOURCE_DATE; for a GitHub codeload zip the commit is read from the zip
 * comment.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

const LDRAW_SYNC_URL =
  process.env.LDRAW_SYNC_URL || 'https://library.ldraw.org/library/updates/complete.zip'
const LDRAW_FALLBACK_URL =
  process.env.LDRAW_FALLBACK_URL ||
  // kulits/ldraw-parts: unmodified daily mirror of library.ldraw.org complete.zip.
  // The archive holds ldraw-parts-master/ldraw/{parts,p,CAreadme.txt,...}.
  'https://codeload.github.com/kulits/ldraw-parts/zip/refs/heads/master'

// Licence files shipped with the LDraw library; always copied next to the parts.
const LICENCE_FILES = ['CAreadme.txt', 'CAlicense.txt', 'CAlicense4.txt']

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
        path.resolve(REPO_ROOT, '../brick-frame/viewer-app/public/ldraw'),
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

function isSameOrInside(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Removes <dest>/parts and <dest>/p so files from an earlier sync (parts that
 * left the curated list, old primitives) do not leak into dist/. Called only
 * once the source has been located and the closure computed, so a failed
 * download never wipes a working raw/. Skipped when the source is the
 * destination or lies inside it.
 */
function clearStaleDest(sourceDir, destDir) {
  const src = fs.realpathSync(sourceDir)
  const dest = fs.existsSync(destDir) ? fs.realpathSync(destDir) : path.resolve(destDir)
  if (isSameOrInside(src, dest) || isSameOrInside(dest, src)) {
    console.warn(`[sync-ldraw] Not clearing ${destDir}: it overlaps the source ${sourceDir}`)
    return
  }
  for (const d of ['parts', 'p']) {
    const target = path.join(dest, d)
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true })
      console.log(`[sync-ldraw] Cleared stale ${target}`)
    }
  }
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
    clearStaleDest(sourceDir, destDir)
    console.log(`[sync-ldraw] Copying ${closure.size} closure files...`)

    let copied = 0
    for (const [relPath, srcPath] of closure.entries()) {
      const target = path.join(destDir, relPath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(srcPath, target)
      copied++
    }
    console.log(`[sync-ldraw] Successfully copied ${copied} curated files.`)

    for (const f of LICENCE_FILES) {
      const src = path.join(sourceDir, f)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, f))
      } else {
        console.warn(`[sync-ldraw] Warning: licence file ${f} not found in ${sourceDir}`)
      }
    }
  } else {
    clearStaleDest(sourceDir, destDir)
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

    const filesToCopy = ['LDConfig.ldr', 'LDCfgalt.ldr', ...LICENCE_FILES]
    for (const f of filesToCopy) {
      const src = path.join(sourceDir, f)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, f))
      }
    }

    console.log('[sync-ldraw] Complete local copy finished.')
  }
}

async function downloadFile(url, destFilePath) {
  console.log(`[sync-ldraw] Downloading archive from: ${url}`)

  const hasCurl = spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0
  if (hasCurl) {
    try {
      execSync(`curl -fLsS --retry 3 --retry-delay 2 -o "${destFilePath}" "${url}"`, {
        stdio: 'inherit',
      })
      if (fs.existsSync(destFilePath) && fs.statSync(destFilePath).size > 1000) {
        return
      }
    } catch (err) {
      console.warn(`[sync-ldraw] curl download failed: ${err.message}. Trying fetch...`)
    }
  }

  console.log(`[sync-ldraw] Fetching via Node.js native fetch: ${url}...`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`)
  }
  const fileStream = fs.createWriteStream(destFilePath)
  await pipeline(Readable.fromWeb(response.body), fileStream)
  console.log(`[sync-ldraw] Download completed (${fs.statSync(destFilePath).size} bytes).`)
}

function extractArchive(zipPath, targetDir) {
  console.log(`[sync-ldraw] Decompressing archive into ${targetDir}...`)
  fs.mkdirSync(targetDir, { recursive: true })

  const hasUnzip = spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0
  if (hasUnzip) {
    execSync(`unzip -q "${zipPath}" -d "${targetDir}"`, { stdio: 'inherit' })
    return
  }

  const hasTar = spawnSync('tar', ['--version'], { stdio: 'ignore' }).status === 0
  if (hasTar) {
    execSync(`tar -xf "${zipPath}" -C "${targetDir}"`, { stdio: 'inherit' })
    return
  }

  throw new Error('Neither unzip nor tar utility found to decompress LDraw archive')
}

function locateLdrawSource(extractDir) {
  const directCandidates = [
    path.join(extractDir, 'ldraw'),
    path.join(extractDir, 'complete', 'ldraw'),
    path.join(extractDir, 'ldraw-parts-master', 'ldraw'),
    extractDir,
  ]
  for (const cand of directCandidates) {
    if (fs.existsSync(path.join(cand, 'parts')) && fs.existsSync(path.join(cand, 'p'))) {
      return cand
    }
  }

  function search(dir, depth = 0) {
    if (depth > 3) return null
    if (fs.existsSync(path.join(dir, 'parts')) && fs.existsSync(path.join(dir, 'p'))) {
      return dir
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = search(path.join(dir, entry.name), depth + 1)
        if (found) return found
      }
    }
    return null
  }

  const found = search(extractDir)
  if (found) return found
  throw new Error(`Failed to locate LDraw parts/ and p/ directories inside extracted archive at ${extractDir}`)
}

function readZipComment(zipPath) {
  const res = spawnSync('unzip', ['-z', zipPath], { encoding: 'utf8' })
  if (res.status !== 0 || !res.stdout) return null
  // First line is "Archive:  <path>"; the comment follows.
  const comment = res.stdout.split(/\r?\n/).slice(1).join('\n').trim()
  return /^[0-9a-f]{40}$/.test(comment) ? comment : null
}

async function githubCommitDate(url, commit) {
  const m = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\//.exec(url)
  if (!m || !commit) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/commits/${commit}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.commit?.committer?.date || null
  } catch {
    return null
  }
}

function writeSourceInfo(destDir, info) {
  const data = {
    source: process.env.LDRAW_SOURCE_URL || info.source,
    commit: process.env.LDRAW_SOURCE_COMMIT || info.commit || null,
    date: process.env.LDRAW_SOURCE_DATE || info.date || null,
    syncedAt: new Date().toISOString(),
  }
  fs.mkdirSync(destDir, { recursive: true })
  fs.writeFileSync(path.join(destDir, '.ldraw-source'), JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`[sync-ldraw] Wrote provenance ${path.join(destDir, '.ldraw-source')} (commit: ${data.commit || 'unknown'}, date: ${data.date || 'unknown'})`)
}

async function syncRemote(destDir, curatedOnly) {
  console.log(`[sync-ldraw] Downloading official LDraw base library into ${destDir} (curatedOnly=${Boolean(curatedOnly)})...`)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brick-catalog-sync-'))
  const zipPath = path.join(tmpDir, 'complete.zip')
  const extractDir = path.join(tmpDir, 'extracted')

  try {
    let sourceUrl = LDRAW_SYNC_URL
    try {
      await downloadFile(LDRAW_SYNC_URL, zipPath)
    } catch (primaryErr) {
      console.warn(`[sync-ldraw] Primary sync failed (${primaryErr.message}). Trying fallback upstream...`)
      sourceUrl = LDRAW_FALLBACK_URL
      await downloadFile(LDRAW_FALLBACK_URL, zipPath)
    }
    const commit = readZipComment(zipPath)
    const date = await githubCommitDate(sourceUrl, commit)

    extractArchive(zipPath, extractDir)
    const ldrawSource = locateLdrawSource(extractDir)
    console.log(`[sync-ldraw] Found valid LDraw structure at ${ldrawSource}`)

    await syncFromLocal(ldrawSource, destDir, curatedOnly)
    writeSourceInfo(destDir, { source: sourceUrl, commit, date })
    console.log('[sync-ldraw] Remote sync completed successfully.')
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (cleanErr) {
      console.warn(`[sync-ldraw] Failed to remove temporary directory ${tmpDir}: ${cleanErr.message}`)
    }
  }
}

async function main() {
  const options = parseArgs()

  try {
    if (options.fromLocal) {
      await syncFromLocal(options.fromLocal, options.dest, options.curatedOnly)
      writeSourceInfo(options.dest, { source: options.fromLocal })
    } else {
      await syncRemote(options.dest, options.curatedOnly)
    }
    console.log('[sync-ldraw] Sync completed successfully.')
  } catch (err) {
    console.error(`[sync-ldraw] Error: ${err.message}`)
    process.exit(1)
  }
}

main()
