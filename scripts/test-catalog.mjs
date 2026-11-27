#!/usr/bin/env node
/**
 * scripts/test-catalog.mjs
 * Comprehensive automated test suite for brick-catalog:
 *  1. Manifest integrity
 *  2. Curated index size (<25 KB) & Elm schema validation
 *  3. Category index partitions
 *  4. MPD bundles (one "contains valid MPD sections" check per bundle, plus one
 *     combined closure check: 100% self-contained, 0 missing subfiles)
 *  4b. Legacy & moved parts (hidden curated entries stay live, out of indices)
 *  5. Dashboard validity and markup integrity
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

let passedTests = 0
let failedTests = 0

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`)
    passedTests++
  } else {
    console.error(`  ✗ FAIL: ${testName}`)
    if (details) console.error(`    Details: ${details}`)
    failedTests++
  }
}

function normalizeName(name) {
  return name.toLowerCase().replace(/\\/g, '/').trim().replace(/^\.\//, '')
}

function splitMpd(text) {
  const sections = new Map()
  let currentFile = null
  let currentLines = []

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/)
    if (tokens[0] === '0' && tokens[1] === 'FILE' && tokens.length >= 3) {
      if (currentFile) {
        sections.set(currentFile, currentLines.join('\n'))
      }
      currentFile = normalizeName(tokens.slice(2).join(' '))
      currentLines = []
    } else if (currentFile) {
      currentLines.push(line)
    }
  }

  if (currentFile) {
    sections.set(currentFile, currentLines.join('\n'))
  }

  return sections
}

function extractSubfiles(content) {
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

async function runTests() {
  console.log('========================================================')
  console.log('            BRICK CATALOG — VALIDATION SUITE            ')
  console.log('========================================================\n')

  const targetDir = path.join(REPO_ROOT, 'dist')
  if (!fs.existsSync(targetDir)) {
    console.error(`dist/ not found at ${targetDir}. Run "npm run build" first.`)
    process.exit(1)
  }

  console.log(`Running tests against directory: ${targetDir}\n`)

  // ----------------------------------------------------
  // TEST SUITE 1: Manifest Integrity
  // ----------------------------------------------------
  console.log('[Suite 1: Manifest Integrity]')
  const manifestPath = path.join(targetDir, 'manifests', 'library-manifest.json')
  const versionPath = path.join(targetDir, 'manifests', 'version.json')

  assert(fs.existsSync(manifestPath), 'library-manifest.json exists', manifestPath)
  assert(fs.existsSync(versionPath), 'version.json exists', versionPath)

  if (fs.existsSync(manifestPath) && fs.existsSync(versionPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'))

    assert(typeof manifest === 'object' && manifest !== null, 'library-manifest.json is valid JSON object')
    assert(Object.keys(manifest).length > 0, `Manifest contains entries (count: ${Object.keys(manifest).length})`)

    assert(manifest['3001.dat'] === 'parts/3001.dat', 'Manifest routes 3001.dat -> parts/3001.dat', manifest['3001.dat'])
    assert(manifest['stud.dat'] === 'p/stud.dat', 'Manifest routes stud.dat -> p/stud.dat', manifest['stud.dat'])
    assert(
      manifest['s/3001s01.dat'] === 'parts/s/3001s01.dat',
      'Manifest routes s/3001s01.dat -> parts/s/3001s01.dat',
      manifest['s/3001s01.dat']
    )

    assert(version.version === '1.0.0', 'version.json has version 1.0.0')
    assert(version.stats && version.stats.totalManifestEntries > 0, 'version.json records valid stats')
  }

  // ----------------------------------------------------
  // TEST SUITE 2: Curated Index & Schema
  // ----------------------------------------------------
  console.log('\n[Suite 2: Curated Index & Schema (<25 KB)]')
  const curatedIndexPath = path.join(targetDir, 'indices', 'parts-curated.json')
  assert(fs.existsSync(curatedIndexPath), 'parts-curated.json exists')

  if (fs.existsSync(curatedIndexPath)) {
    const content = fs.readFileSync(curatedIndexPath, 'utf8')
    const byteLength = Buffer.byteLength(content, 'utf8')
    const sizeKb = (byteLength / 1024).toFixed(2)

    assert(byteLength < 25 * 1024, `parts-curated.json size is strictly < 25 KB (${sizeKb} KB, limit: 25 KB)`)

    const data = JSON.parse(content)
    assert(data.version === 1, 'Index specifies version 1')
    assert(Array.isArray(data.parts), 'Index contains parts array')
    assert(data.parts.length >= 50, `Curated parts count is sufficient (count: ${data.parts.length})`)

    // Validate Elm schema: [file, description, category, optional keywords]
    let schemaValid = true
    for (const item of data.parts) {
      if (!Array.isArray(item) || item.length < 3 || typeof item[0] !== 'string' || typeof item[1] !== 'string' || typeof item[2] !== 'string') {
        schemaValid = false
        break
      }
    }
    assert(schemaValid, 'All items conform to Elm Studio.PartIndex decoder schema')

    // Check specific essential parts are included
    const partFiles = new Set(data.parts.map((p) => p[0]))
    assert(partFiles.has('3001.dat'), 'Curated index includes 3001.dat (Brick 2x4)')
    assert(partFiles.has('3647.dat'), 'Curated index includes 3647.dat (Technic 8T Gear)')
    assert(partFiles.has('87087.dat'), 'Curated index includes 87087.dat (SNOT Side Stud)')
    assert(partFiles.has('3024.dat'), 'Curated index includes 3024.dat (Plate 1x1)')
  }

  const elementsIndexPath = path.join(targetDir, 'indices', 'elements-index.json')
  assert(fs.existsSync(elementsIndexPath), 'elements-index.json exists in indices/')
  if (fs.existsSync(elementsIndexPath)) {
    const elData = JSON.parse(fs.readFileSync(elementsIndexPath, 'utf8'))
    assert(elData.version === 1 && typeof elData.elements === 'object', 'elements-index.json has valid version and elements map')
  }

  // Backward compatibility mirror checks in raw/
  const rawDir = path.join(targetDir, 'raw')
  if (fs.existsSync(rawDir)) {
    assert(fs.existsSync(path.join(rawDir, 'parts-index.json')), 'parts-index.json mirrored to raw/')
    assert(fs.existsSync(path.join(rawDir, 'parts-curated.json')), 'parts-curated.json mirrored to raw/')
    assert(fs.existsSync(path.join(rawDir, 'elements-index.json')), 'elements-index.json mirrored to raw/')
    assert(fs.existsSync(path.join(rawDir, 'parts', '3005.dat')), 'dist/raw/parts/3005.dat exists')
    assert(fs.existsSync(path.join(rawDir, 'parts', '3004.dat')), 'dist/raw/parts/3004.dat exists')
    assert(fs.existsSync(path.join(rawDir, 'p', 'stud.dat')), 'dist/raw/p/stud.dat exists')
  }
  assert(
    fs.existsSync(path.join(targetDir, 'raw', 'CAreadme.txt')),
    'raw/CAreadme.txt (LDraw licence notice) is published',
    path.join(targetDir, 'raw', 'CAreadme.txt')
  )

  // ----------------------------------------------------
  // TEST SUITE 3: Category Partitioning
  // ----------------------------------------------------
  console.log('\n[Suite 3: Category Partitions]')
  const categoriesDir = path.join(targetDir, 'indices', 'categories')
  assert(fs.existsSync(categoriesDir), 'indices/categories directory exists')

  const requiredCategories = ['brick', 'plate', 'technic', 'slope', 'tile', 'bracket']
  for (const cat of requiredCategories) {
    const catFile = path.join(categoriesDir, `${cat}.json`)
    assert(fs.existsSync(catFile), `Category file exists: ${cat}.json`)
    if (fs.existsSync(catFile)) {
      const catData = JSON.parse(fs.readFileSync(catFile, 'utf8'))
      assert(catData.version === 1, `${cat}.json has version 1`)
      assert(Array.isArray(catData.parts) && catData.parts.length > 0, `${cat}.json has non-empty parts list (${catData.parts?.length})`)
    }
  }

  // ----------------------------------------------------
  // TEST SUITE 4: MPD Closure (No Missing Subfiles)
  // ----------------------------------------------------
  console.log('\n[Suite 4: MPD Closure Validation]')
  const bundlesDir = path.join(targetDir, 'bundles')
  assert(fs.existsSync(bundlesDir), 'bundles/ directory exists')

  if (fs.existsSync(bundlesDir)) {
    const mpdFiles = fs.readdirSync(bundlesDir).filter((f) => f.endsWith('.mpd'))
    assert(mpdFiles.length >= 50, `Generated bundles count is >= 50 (count: ${mpdFiles.length})`)

    let totalSubfilesVerified = 0
    let missingReferences = []

    for (const mpdFile of mpdFiles) {
      const fullPath = path.join(bundlesDir, mpdFile)
      const content = fs.readFileSync(fullPath, 'utf8')
      const sections = splitMpd(content)

      assert(sections.size > 0, `${mpdFile} contains valid MPD sections (count: ${sections.size})`)

      const availableFiles = new Set(sections.keys())

      // Verify closure for this MPD
      for (const [sectionName, sectionContent] of sections.entries()) {
        const refs = extractSubfiles(sectionContent)
        for (const ref of refs) {
          totalSubfilesVerified++
          if (!availableFiles.has(ref)) {
            missingReferences.push({
              bundle: mpdFile,
              inSection: sectionName,
              missingSubfile: ref,
            })
          }
        }
      }
    }

    assert(
      missingReferences.length === 0,
      `All MPD bundles have 100% complete closure (${totalSubfilesVerified} subfile references verified, 0 missing)`,
      missingReferences.length > 0 ? JSON.stringify(missingReferences.slice(0, 5), null, 2) : ''
    )
  }

  // ----------------------------------------------------
  // TEST SUITE 4b: Legacy & Moved Parts (hidden curated entries)
  // ----------------------------------------------------
  console.log('\n[Suite 4b: Legacy & moved parts]')
  {
    const curatedList = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'curated-parts.json'), 'utf8'))
    const byFile = new Map(curatedList.map((p) => [p.file, p]))
    const hidden = curatedList.filter((p) => p.hidden)
    const hiddenFiles = new Set(hidden.map((p) => p.file))
    const distParts = path.join(targetDir, 'raw', 'parts')

    const unpublished = curatedList.filter(
      (p) =>
        !fs.existsSync(path.join(bundlesDir, `${p.file.replace(/\.dat$/i, '')}.mpd`)) ||
        !fs.existsSync(path.join(distParts, p.file))
    )
    assert(
      unpublished.length === 0,
      `Every curated entry (${curatedList.length}, ${hidden.length} hidden) has bundles/<n>.mpd and raw/parts/<file>`,
      unpublished.map((p) => p.file).join(', ')
    )

    const indexFiles = [
      path.join(targetDir, 'indices', 'parts-curated.json'),
      path.join(targetDir, 'indices', 'parts-index.json'),
      ...(fs.existsSync(categoriesDir)
        ? fs.readdirSync(categoriesDir).filter((f) => f.endsWith('.json')).map((f) => path.join(categoriesDir, f))
        : []),
    ]
    const leaked = []
    for (const f of indexFiles) {
      if (!fs.existsSync(f)) continue
      for (const entry of JSON.parse(fs.readFileSync(f, 'utf8')).parts || []) {
        if (hiddenFiles.has(entry[0])) leaked.push(`${path.basename(f)}:${entry[0]}`)
      }
    }
    assert(leaked.length === 0, `No hidden entry appears in parts-curated, parts-index or categories/*.json`, leaked.join(', '))

    // Only top-level raw/parts: raw/p has primitive stubs that real parts still use.
    const badStubs = []
    if (fs.existsSync(distParts)) {
      for (const f of fs.readdirSync(distParts).filter((n) => n.toLowerCase().endsWith('.dat'))) {
        const text = fs.readFileSync(path.join(distParts, f), 'utf8')
        const first = (text.split(/\r?\n/).find((l) => l.trim() !== '') || '').trim()
        if (!/^0\s+~Moved\s+to\b/i.test(first)) continue
        const ref = text
          .split(/\r?\n/)
          .map((l) => l.trim().split(/\s+/))
          .find((t) => t[0] === '1' && t.length >= 15)
        const target = ref ? normalizeName(ref.slice(14).join(' ')) : null
        const entry = byFile.get(f)
        if (!entry || !entry.hidden || !entry.movedTo || normalizeName(entry.movedTo) !== target) {
          badStubs.push(`${f} -> ${target}`)
        }
      }
    }
    assert(badStubs.length === 0, 'Every "~Moved to" stub in raw/parts is a hidden curated entry with the matching movedTo', badStubs.join(', '))

    const aliasFile = path.join(targetDir, 'raw', 'parts', '92338.dat')
    const aliasRef = fs.existsSync(aliasFile)
      ? fs.readFileSync(aliasFile, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('1 '))
      : ''
    assert(
      aliasRef.trim().endsWith('92338-f1.dat'),
      'The base-number alias raw/parts/92338.dat points at 92338-f1.dat',
      aliasRef || 'file missing'
    )

    const brokenChains = []
    for (const p of curatedList.filter((e) => e.movedTo)) {
      const seen = new Set([p.file])
      let cur = p
      while (cur && cur.movedTo && !seen.has(cur.movedTo)) {
        seen.add(cur.movedTo)
        cur = byFile.get(cur.movedTo)
      }
      if (!cur || cur.movedTo || cur.hidden) brokenChains.push(p.file)
    }
    assert(brokenChains.length === 0, 'Every movedTo chain ends at a visible curated entry', brokenChains.join(', '))

    const curatedBundles = new Set(curatedList.map((p) => `${p.file.replace(/\.dat$/i, '')}.mpd`))
    const strayBundles = fs.existsSync(bundlesDir)
      ? fs.readdirSync(bundlesDir).filter((f) => f.endsWith('.mpd') && !curatedBundles.has(f))
      : []
    assert(strayBundles.length === 0, 'No bundles/*.mpd without a curated entry', strayBundles.join(', '))

    const curatedIndex = fs.existsSync(curatedIndexPath)
      ? new Set(JSON.parse(fs.readFileSync(curatedIndexPath, 'utf8')).parts.map((p) => p[0]))
      : new Set()
    assert(
      byFile.get('3648.dat')?.hidden === true && fs.existsSync(path.join(bundlesDir, '3648.mpd')),
      'Moved stub 3648.dat is hidden and still bundled (old models keep loading)'
    )
    assert(fs.existsSync(path.join(bundlesDir, '3794b.mpd')), 'Legacy part 3794b.dat is still bundled')
    assert(curatedIndex.has('3648b.dat') && !curatedIndex.has('3648.dat'), 'parts-curated.json lists 3648b.dat and not 3648.dat')
  }

  // ----------------------------------------------------
  // TEST SUITE 5: Interactive Dashboard & CNAME
  // ----------------------------------------------------
  console.log('\n[Suite 5: Dashboard & Configuration Integrity]')
  const cnamePath = path.join(targetDir, 'CNAME')
  assert(fs.existsSync(cnamePath), 'CNAME file exists')
  if (fs.existsSync(cnamePath)) {
    const cnameContent = fs.readFileSync(cnamePath, 'utf8').trim()
    assert(
      cnameContent === 'catalog.palikkaharrastajat.fi',
      'CNAME matches catalog.palikkaharrastajat.fi',
      cnameContent
    )
  }

  const indexPath = path.join(targetDir, 'index.html')
  assert(fs.existsSync(indexPath), 'index.html dashboard exists')
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8')
    assert(html.includes('<!DOCTYPE html>'), 'Dashboard has valid DOCTYPE html')
    assert(html.includes('catalog.palikkaharrastajat.fi'), 'Dashboard mentions custom domain')
    assert(html.includes('id="stat-manifest"'), 'Dashboard includes manifest metrics element')
    assert(html.includes('id="stat-curated"'), 'Dashboard includes curated count element')
    assert(html.includes('id="stat-bundles"'), 'Dashboard includes bundles count element')
    assert(html.includes('id="search-input"'), 'Dashboard includes interactive search tester')
    assert(html.includes('id="inspector-modal"'), 'Dashboard includes part & MPD inspector')
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n========================================================')
  console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`)
  console.log('========================================================\n')

  if (failedTests > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error(`Fatal test error: ${err.message}`)
  process.exit(1)
})
