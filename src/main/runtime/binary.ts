import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export interface SdkInfo {
  version: string
  cliVersion: string | null
}

export function readSdkInfo(): SdkInfo {
  try {
    const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk')
    const root = dirname(sdkEntry)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }
    let cliVersion: string | null = null
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
        version?: string
      }
      cliVersion = manifest.version ?? null
    } catch {
      cliVersion = null
    }
    return { version: pkg.version ?? 'unknown', cliVersion }
  } catch {
    return { version: 'unknown', cliVersion: null }
  }
}

export function claudeExecutableCandidates(
  platform: NodeJS.Platform,
  arch: string,
  resourcesPath: string
): string[] {
  const packageName = `claude-agent-sdk-${platform}-${arch}`
  const binaryNames = platform === 'win32' ? ['claude.exe', 'claude'] : ['claude']
  const bases = [
    join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
      'node_modules',
      '@anthropic-ai',
      packageName
    ),
    join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@anthropic-ai',
      packageName
    )
  ]
  return bases.flatMap((base) => binaryNames.map((name) => join(base, name)))
}

/**
 * In a packaged app the SDK's platform package lives outside app.asar (see
 * electron-builder.yml). Handing the explicit path to the SDK avoids spawning
 * a binary through the asar virtual filesystem.
 */
export function resolveClaudeExecutable(isPackaged: boolean): string | undefined {
  const override = process.env.RELAY_CLAUDE_EXECUTABLE
  if (override && existsSync(override)) return override
  if (!isPackaged) return undefined

  for (const candidate of claudeExecutableCandidates(
    process.platform,
    process.arch,
    process.resourcesPath
  )) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
