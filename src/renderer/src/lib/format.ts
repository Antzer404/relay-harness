export function clock(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value))
}

export function dateStamp(value: number): string {
  const date = new Date(value)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export function number(value: number): string {
  return value.toLocaleString('en-US')
}

export function cost(value: number): string {
  if (!Number.isFinite(value)) return '$0.0000'
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

export function shortModel(model: string | null | undefined): string {
  if (!model) return '—'
  return model.replace(/\[1m\]/i, '').replace(/^deepseek-/i, '').toUpperCase()
}

export function baseName(path: string | null | undefined): string {
  if (!path) return '—'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function toolSummary(name: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    const keys = [
      'command',
      'file_path',
      'path',
      'pattern',
      'url',
      'query',
      'description',
      'prompt'
    ]
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return value.replace(/\s+/g, ' ').slice(0, 160)
      }
    }
  }
  try {
    return JSON.stringify(input).slice(0, 160)
  } catch {
    return name
  }
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
