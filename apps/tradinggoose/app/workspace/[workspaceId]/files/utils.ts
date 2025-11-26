export const PLAN_NAMES = {
  enterprise: 'Enterprise',
  team: 'Team',
  pro: 'Pro',
  free: 'Free',
} as const

export const GRADIENT_TEXT_STYLES =
  'gradient-text bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const formatDisplayDate = (date: Date | string): string => {
  const d = new Date(date)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${mm}/${dd}/${yy}`
}

export const truncateMiddle = (text: string, start = 24, end = 12) => {
  if (!text) return ''
  if (text.length <= start + end + 3) return text
  return `${text.slice(0, start)}...${text.slice(-end)}`
}

export const formatStorageSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
