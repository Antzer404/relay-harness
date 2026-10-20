export function clock(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

export function dateStamp(value: number): string {
  const date = new Date(value)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return '今天'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return '昨天'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export function relativeTime(value: number): string {
  const delta = Date.now() - value
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return dateStamp(value)
}

export function baseName(path: string | null | undefined): string {
  if (!path) return '未选择目录'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function shortModel(model: string | null | undefined): string {
  if (!model) return '默认模型'
  return model.replace(/\[1m\]/i, '')
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`
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
        return value.replace(/\s+/g, ' ').slice(0, 180)
      }
    }
  }
  try {
    return JSON.stringify(input).slice(0, 180)
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

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return value.toLocaleString('en-US')
}
