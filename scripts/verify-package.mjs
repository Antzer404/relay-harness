#!/usr/bin/env node
/**
 * Verifies that electron-builder produced an app whose SDK native CLI was
 * unpacked out of app.asar. Run after `electron-builder --dir` or any dist
 * command; it inspects the unpacked app directory left in release/.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const releaseDir = join(process.cwd(), 'release')

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    visit(full, entry)
    if (entry.isDirectory()) walk(full, visit)
  }
}

function findUnpackedDirs() {
  const found = []
  if (!existsSync(releaseDir)) return found
  walk(releaseDir, (full, entry) => {
    if (entry.isDirectory() && entry.name === 'app.asar.unpacked') found.push(full)
  })
  return found
}

function findBinaries(root) {
  const binaries = []
  walk(root, (full, entry) => {
    if (!entry.isFile()) return
    if (entry.name === 'claude' || entry.name === 'claude.exe') binaries.push(full)
  })
  return binaries
}

const unpackedDirs = findUnpackedDirs()
if (unpackedDirs.length === 0) {
  console.error('[verify-package] no app.asar.unpacked found under release/')
  process.exit(1)
}

let failures = 0
for (const dir of unpackedDirs) {
  const appRoot = join(dir, '..')
  const asar = join(appRoot, 'app.asar')
  const binaries = findBinaries(dir)
  const musl = binaries.filter((file) => file.includes('musl'))
  const sdkBinaries = binaries.filter((file) => file.includes('claude-agent-sdk-'))

  if (!existsSync(asar)) {
    console.error(`[verify-package] missing app.asar next to ${relative(process.cwd(), dir)}`)
    failures += 1
  }
  if (sdkBinaries.length === 0) {
    console.error(`[verify-package] no SDK CLI binary in ${relative(process.cwd(), dir)}`)
    failures += 1
  }
  if (musl.length > 0) {
    console.error(`[verify-package] musl binary should not ship: ${musl.map((file) => relative(process.cwd(), file)).join(', ')}`)
    failures += 1
  }

  for (const binary of sdkBinaries) {
    const size = statSync(binary).size
    if (size < 10 * 1024 * 1024) {
      console.error(`[verify-package] SDK CLI looks too small (${size} bytes): ${binary}`)
      failures += 1
    }
    console.log(
      `[verify-package] ${relative(process.cwd(), binary)} (${(size / 1024 / 1024).toFixed(0)} MB)`
    )
  }
}

if (failures > 0) process.exit(1)
console.log(`[verify-package] OK — ${unpackedDirs.length} unpacked app(s) verified`)
