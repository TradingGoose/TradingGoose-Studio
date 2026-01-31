export const parseTime = (time?: string | null) => {
  if (!time) return null
  const parts = time.split(':').map((value) => Number(value))
  if (parts.length < 2) return null
  const [hours, minutes, seconds = 0] = parts
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null
  }
  return { hours, minutes, seconds }
}
