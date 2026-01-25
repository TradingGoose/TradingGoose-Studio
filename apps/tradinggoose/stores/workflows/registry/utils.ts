import { getRandomVibrantColor } from '@/lib/colors'

// Generates a random vibrant color using HSL with a fixed saturation/lightness for consistency
export function getNextWorkflowColor(): string {
  return getRandomVibrantColor()
}
