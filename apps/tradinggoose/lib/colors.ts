const VIBRANT_SATURATION = 100
const VIBRANT_LIGHTNESS = 60

const supportsCrypto =
  typeof globalThis !== 'undefined' &&
  typeof globalThis.crypto !== 'undefined' &&
  typeof globalThis.crypto.getRandomValues === 'function'

const getRandomHue = (): number => {
  if (supportsCrypto) {
    const values = new Uint32Array(1)
    globalThis.crypto.getRandomValues(values)
    return values[0] % 360
  }

  return Math.floor(Math.random() * 360)
}

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

// Generates a random vibrant color using HSL with a fixed saturation/lightness for consistency
export function getRandomVibrantColor(): string {
  const hue = getRandomHue()
  return hslToHex(hue, VIBRANT_SATURATION, VIBRANT_LIGHTNESS)
}
