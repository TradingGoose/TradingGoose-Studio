export function getDocumentProcessingMaxDurationSeconds() {
  const duration = Number(process.env.KB_CONFIG_MAX_DURATION)
  return Number.isFinite(duration) && duration >= 1 ? duration : 600
}
