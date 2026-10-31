#!/usr/bin/env node
/**
 * scripts/preview.mjs
 * Lightweight local preview server for brick-catalog.
 * Serves dist/ directory with CORS and proper content types.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mpd': 'text/plain; charset=utf-8',
  '.dat': 'text/plain; charset=utf-8',
  '.ldr': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

const serveDir = fs.existsSync(path.join(REPO_ROOT, 'dist'))
  ? path.join(REPO_ROOT, 'dist')
  : REPO_ROOT

const PORT = parseInt(process.env.PORT || '8182', 10)

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)
  let filePath = path.join(serveDir, urlPath)

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end(`404 Not Found: ${urlPath}`)
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  res.writeHead(200, { 'Content-Type': contentType })
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  console.log(`[preview] Catalog server running at http://localhost:${PORT}/`)
  console.log(`[preview] Serving content from: ${serveDir}`)
})
