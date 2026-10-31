#!/usr/bin/env node
/**
 * scripts/build-indices.mjs
 * Generates search and palette indices:
 *  - indices/parts-curated.json (~20 KB, Elm decoder compatible)
 *  - indices/parts-index.json (full library index)
 *  - indices/categories/*.json (partitioned category subsets)
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

export function buildIndices(sourceDir, destDir) {
  console.log(`[build-indices] Generating indices into ${destDir}...`)
  fs.mkdirSync(destDir, { recursive: true })
  const categoriesDir = path.join(destDir, 'categories')
  fs.mkdirSync(categoriesDir, { recursive: true })

  // 1. Build Curated Index
  const curatedJsonPath = path.join(REPO_ROOT, 'data', 'curated-parts.json')
  if (!fs.existsSync(curatedJsonPath)) {
    throw new Error(`Curated parts data file not found at ${curatedJsonPath}`)
  }

  const curatedList = JSON.parse(fs.readFileSync(curatedJsonPath, 'utf8'))
  const curatedPartsArray = curatedList.map((p) => {
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

  // 2. Build or Copy Full Index
  let fullIndexPayload = null
  let existingIndexFile = null
  if (sourceDir) {
    const cand = path.join(sourceDir, 'parts-index.json')
    if (fs.existsSync(cand)) {
      existingIndexFile = cand
    }
  }

  if (existingIndexFile) {
    console.log(`[build-indices] Loading existing parts-index.json from ${existingIndexFile}...`)
    fullIndexPayload = JSON.parse(fs.readFileSync(existingIndexFile, 'utf8'))
  } else {
    console.log('[build-indices] Synthesizing base parts-index from curated list...')
    fullIndexPayload = curatedIndexPayload
  }

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

  console.log('[build-indices] All indices built successfully.')
  return {
    curatedCount: curatedPartsArray.length,
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
