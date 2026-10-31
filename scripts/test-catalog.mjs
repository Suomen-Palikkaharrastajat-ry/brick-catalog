#!/usr/bin/env node
/**
 * scripts/test-catalog.mjs
 * Comprehensive automated test suite for brick-catalog:
 *  1. Manifest integrity
 *  2. MPD closure (100% self-contained, 0 missing subfiles)
 *  3. Curated index size (<25 KB) & Elm schema validation
 *  4. Category index partitions
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

  const targetDir = fs.existsSync(path.join(REPO_ROOT, 'dist'))
    ? path.join(REPO_ROOT, 'dist')
    : REPO_ROOT

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
