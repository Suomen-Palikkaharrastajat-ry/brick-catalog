#!/usr/bin/env node
/**
 * scripts/build-indices.mjs
 * Generates search and palette indices:
 *  - indices/parts-curated.json (~20 KB, Elm decoder compatible)
 *  - indices/parts-index.json (same entries as parts-curated.json)
 *  - indices/categories/*.json (partitioned category subsets)
 *  - indices/elements-index.json (copy of data/elements-index.json)
 *
 * Entries of data/curated-parts.json with `"hidden": true` (LDraw "~Moved to"
 * stubs, with `"movedTo": "<target>.dat"`, and legacy parts kept for old
 * models) stay in the sync closure, the bundles and the manifest, but are left
 * out of every index above except elements-index.json.
 *
 * The curated list is validated against the synced LDraw source; any problem
 * (missing file, visible stub, wrong or stale movedTo, broken chain) is an
 * error, so a deploy fails instead of publishing a broken palette.
 *
 * Usage:
 *   node scripts/build-indices.mjs [--source <dir>] [--dest <dir>]
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
    dest: path.join(REPO_ROOT, 'indices'),
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
    const rawDir = path.join(REPO_ROOT, 'raw')
    if (fs.existsSync(path.join(rawDir, 'parts'))) {
      options.source = rawDir
    }
  }

  return options
}

const MOVED_RE = /^0\s+~Moved\s+to\s+(\S+)/i

/** The "~Moved to" target of an LDraw part file, or null when it is a real part. */
function readMovedTarget(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const first = lines.find((l) => l.trim() !== '') || ''
  if (!MOVED_RE.test(first.trim())) return null
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/)
    if (tokens[0] === '1' && tokens.length >= 15) {
      return tokens.slice(14).join(' ').replace(/\\/g, '/').toLowerCase()
    }
  }
  // Stub without a type-1 line: fall back to the title ("~Moved to 3023b").
  return `${MOVED_RE.exec(first.trim())[1].toLowerCase()}.dat`
}

/**
 * Checks data/curated-parts.json against the synced LDraw library and returns
 * a list of error messages (empty when everything is consistent).
 */
export function validateCuratedList(curatedList, sourceDir) {
  const errors = []
  const byFile = new Map()
  for (const p of curatedList) {
    if (byFile.has(p.file)) errors.push(`${p.file}: listed more than once`)
    byFile.set(p.file, p)
  }

  for (const p of curatedList) {
    const filePath = path.join(sourceDir, 'parts', p.file)
    if (!fs.existsSync(filePath)) {
      errors.push(`${p.file}: not found in ${path.join(sourceDir, 'parts')}`)
      continue
    }
    const target = readMovedTarget(filePath)
    if (p.movedTo && !p.hidden) {
      errors.push(`${p.file}: has movedTo "${p.movedTo}" but is not hidden; add "hidden": true`)
    }
    if (target && !p.hidden) {
      errors.push(`${p.file}: is an LDraw "~Moved to ${target}" stub; mark it "hidden": true with "movedTo": "${target}" (and curate ${target} if it is missing)`)
    } else if (target && !p.movedTo) {
      errors.push(`${p.file}: hidden, and now an LDraw "~Moved to ${target}" stub; add "movedTo": "${target}"`)
    } else if (target && p.movedTo.toLowerCase() !== target) {
      errors.push(`${p.file}: movedTo is "${p.movedTo}", but LDraw moves it to "${target}"; set "movedTo": "${target}"`)
    } else if (!target && p.movedTo) {
      errors.push(`${p.file}: hidden with movedTo "${p.movedTo}", but it is no longer a "~Moved to" stub upstream; remove "hidden" and "movedTo" (and check its name)`)
    }
  }

  // Every movedTo chain must end at a visible curated entry.
  for (const p of curatedList) {
    if (!p.movedTo) continue
    const seen = new Set([p.file])
    let cur = p
    while (cur && cur.movedTo) {
      const next = byFile.get(cur.movedTo)
      if (!next) {
        errors.push(`${p.file}: movedTo chain reaches ${cur.movedTo}, which is not in the curated list; add it`)
        break
      }
      if (seen.has(next.file)) {
        errors.push(`${p.file}: movedTo chain has a cycle at ${next.file}`)
        break
      }
      seen.add(next.file)
      cur = next
    }
    if (cur && !cur.movedTo && cur.hidden && cur !== p) {
      errors.push(`${p.file}: movedTo chain ends at hidden entry ${cur.file}; the target must be visible`)
    }
  }
  return errors
}

export function buildIndices(sourceDir, destDir) {
  console.log(`[build-indices] Generating indices into ${destDir}...`)
  if (!sourceDir || !fs.existsSync(path.join(sourceDir, 'parts'))) {
    throw new Error(`No LDraw source with parts/ (got ${sourceDir}); run "npm run sync -- --curated-only" first`)
  }
  fs.mkdirSync(destDir, { recursive: true })
  const categoriesDir = path.join(destDir, 'categories')
  fs.mkdirSync(categoriesDir, { recursive: true })

  // 1. Build Curated Index
  const curatedJsonPath = path.join(REPO_ROOT, 'data', 'curated-parts.json')
  if (!fs.existsSync(curatedJsonPath)) {
    throw new Error(`Curated parts data file not found at ${curatedJsonPath}`)
  }

  const curatedList = JSON.parse(fs.readFileSync(curatedJsonPath, 'utf8'))
  const errors = validateCuratedList(curatedList, sourceDir)
  if (errors.length > 0) {
    throw new Error(
      `data/curated-parts.json does not match the LDraw library in ${sourceDir} (${errors.length} problem(s)):\n  - ${errors.join('\n  - ')}`
    )
  }

  const visibleList = curatedList.filter((p) => !p.hidden)
  const hiddenCount = curatedList.length - visibleList.length
  console.log(`[build-indices] Curated list valid: ${curatedList.length} entries, ${hiddenCount} hidden (moved stubs and legacy parts)`)

  const curatedPartsArray = visibleList.map((p) => {
    const entry = [p.file, p.name || p.description, p.category]
    if (p.keywords) {
      entry.push(p.keywords)
    }
    return entry
  })

  const curatedIndexPayload = {
    version: 1,
    parts: curatedPartsArray,
  }

  const curatedIndexPath = path.join(destDir, 'parts-curated.json')
  const curatedJsonString = JSON.stringify(curatedIndexPayload)
  fs.writeFileSync(curatedIndexPath, curatedJsonString, 'utf8')
  const curatedSizeKb = (Buffer.byteLength(curatedJsonString, 'utf8') / 1024).toFixed(2)
  console.log(`[build-indices] Wrote parts-curated.json (${curatedPartsArray.length} parts, ${curatedSizeKb} KB)`)

  if (Buffer.byteLength(curatedJsonString, 'utf8') >= 25 * 1024) {
    throw new Error(`[build-indices] Error: parts-curated.json size (${curatedSizeKb} KB) exceeds 25 KB limit!`)
  }

  // 2. Full Index (synthesized from the visible curated entries)
  console.log('[build-indices] Synthesizing parts-index from curated list...')
  const fullIndexPayload = curatedIndexPayload

  const fullIndexPath = path.join(destDir, 'parts-index.json')
  fs.writeFileSync(fullIndexPath, JSON.stringify(fullIndexPayload), 'utf8')
  console.log(`[build-indices] Wrote parts-index.json (${fullIndexPayload.parts.length} entries)`)

  // 3. Partition into Categories
  // Categories required: brick, plate, technic, slope, tile, bracket
  const categoryBuckets = new Map()

  for (const part of fullIndexPayload.parts) {
    const category = (part[2] || 'Other').trim()
    const catLower = category.toLowerCase()

    let targetKey = 'other'
    if (catLower.includes('brick')) targetKey = 'brick'
    else if (catLower.includes('plate')) targetKey = 'plate'
    else if (catLower.includes('technic') || catLower.includes('gear') || catLower.includes('axle')) targetKey = 'technic'
    else if (catLower.includes('slope')) targetKey = 'slope'
    else if (catLower.includes('tile')) targetKey = 'tile'
    else if (catLower.includes('bracket') || catLower.includes('snot')) targetKey = 'bracket'

    if (!categoryBuckets.has(targetKey)) {
      categoryBuckets.set(targetKey, [])
    }
    categoryBuckets.get(targetKey).push(part)
  }

  // Ensure standard buckets exist
  const standardCategories = ['brick', 'plate', 'technic', 'slope', 'tile', 'bracket']
  for (const cat of standardCategories) {
    if (!categoryBuckets.has(cat)) {
      categoryBuckets.set(cat, [])
    }
  }

  for (const [catName, partsList] of categoryBuckets.entries()) {
    const catFile = path.join(categoriesDir, `${catName}.json`)
    const catPayload = {
      version: 1,
      category: catName,
      count: partsList.length,
      parts: partsList,
    }
    fs.writeFileSync(catFile, JSON.stringify(catPayload), 'utf8')
    console.log(`[build-indices] Wrote category ${catName}.json (${partsList.length} parts)`)
  }

  // 4. Build or Copy Elements Index. Not filtered: its keys are lookup keys for
  // placed parts, and old models still place hidden numbers such as 3023.dat.
  const elementsDataPath = path.join(REPO_ROOT, 'data', 'elements-index.json')
  let elementsSourcePath = null
  if (sourceDir && fs.existsSync(path.join(sourceDir, 'elements-index.json'))) {
    elementsSourcePath = path.join(sourceDir, 'elements-index.json')
  } else if (fs.existsSync(elementsDataPath)) {
    elementsSourcePath = elementsDataPath
  }

  if (elementsSourcePath) {
    const elementsContent = fs.readFileSync(elementsSourcePath, 'utf8')
    const elementsDestPath = path.join(destDir, 'elements-index.json')
    fs.writeFileSync(elementsDestPath, elementsContent, 'utf8')
    console.log(`[build-indices] Wrote elements-index.json to ${elementsDestPath}`)
  } else {
    console.warn('[build-indices] Warning: elements-index.json not found in source or data/')
  }

  console.log('[build-indices] All indices built successfully.')
  return {
    curatedCount: curatedPartsArray.length,
    hiddenCount,
    curatedSizeKb,
    totalCount: fullIndexPayload.parts.length,
    categoriesCount: categoryBuckets.size,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs()
  try {
    buildIndices(options.source, options.dest)
  } catch (err) {
    console.error(`[build-indices] Error: ${err.message}`)
    process.exit(1)
  }
}
