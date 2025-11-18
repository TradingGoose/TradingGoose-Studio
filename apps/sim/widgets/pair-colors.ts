export type PairColor = 'gray' | 'red' | 'orange' | 'blue' | 'green' | 'purple'

export const PAIR_COLOR_META: Record<PairColor, { label: string; description: string; hex: string }> = {
  gray: { label: 'Unlinked', description: 'Keep this widget independent', hex: '#6b7280' },
  red: { label: 'Red', description: 'Linked channel', hex: '#ff0000' },
  orange: { label: 'Orange', description: 'Linked channel', hex: '#ff9900' },
  blue: { label: 'Blue', description: 'Linked channel', hex: '#3b82f6' },
  green: { label: 'Green', description: 'Linked channel', hex: '#10b981' },
  purple: { label: 'Purple', description: 'Linked channel', hex: '#a855f7' },
}

export const PAIR_COLORS: PairColor[] = ['gray', 'red', 'orange', 'blue', 'green', 'purple']

export const PAIR_COLOR_OPTIONS = PAIR_COLORS.map((value) => ({
  value,
  ...PAIR_COLOR_META[value],
}))

export function isPairColor(value: unknown): value is PairColor {
  return typeof value === 'string' && (PAIR_COLORS as ReadonlyArray<string>).includes(value)
}
