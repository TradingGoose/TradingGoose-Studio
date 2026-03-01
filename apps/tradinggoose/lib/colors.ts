const VIBRANT_SATURATION = 100
const VIBRANT_LIGHTNESS = 35
const GOLDEN_ANGLE_DEGREES = 137.508

// Source - https://stackoverflow.com/a
// Posted by Juraj, modified by community. See post 'Timeline' for change history
// Retrieved 2025-11-24, License - CC BY-SA 4.0
function hslToHex(h: number, s: number, l: number): string {
  const normalizedLightness = l / 100
  const a = (s * Math.min(normalizedLightness, 1 - normalizedLightness)) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = normalizedLightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function hashSeed(seed: string): number {
  const safeSeed = typeof seed === 'string' ? seed : String(seed)
  let hash = 2166136261
  for (let i = 0; i < safeSeed.length; i += 1) {
    hash ^= safeSeed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const resolveHueFromSeed = (seed: string) => hashSeed(seed) % 360

export function getStableVibrantColor(seed: string): string {
  const hue = resolveHueFromSeed(seed)
  return hslToHex(hue, VIBRANT_SATURATION, VIBRANT_LIGHTNESS)
}

export function getStableVibrantColorWithOffset(seed: string, offsetIndex: number): string {
  const baseHue = resolveHueFromSeed(seed)
  const safeOffset = Number.isFinite(offsetIndex) ? Math.max(0, Math.trunc(offsetIndex)) : 0
  const hue = (baseHue + safeOffset * GOLDEN_ANGLE_DEGREES) % 360
  return hslToHex(hue, VIBRANT_SATURATION, VIBRANT_LIGHTNESS)
}
