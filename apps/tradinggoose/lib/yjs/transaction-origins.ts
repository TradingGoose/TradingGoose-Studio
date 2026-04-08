export const YJS_ORIGINS = {
  SYSTEM: 'system',
  USER: 'user',
  COPILOT_TOOL: 'copilot-tool',
  COPILOT_REVIEW_ACCEPT: 'copilot-review-accept',
  SAVE: 'save',
} as const

export type YjsOrigin = (typeof YJS_ORIGINS)[keyof typeof YJS_ORIGINS]

const YJS_UNDOABLE_ORIGINS: ReadonlyArray<YjsOrigin | null> = [
  null,
  YJS_ORIGINS.USER,
  YJS_ORIGINS.COPILOT_TOOL,
  YJS_ORIGINS.COPILOT_REVIEW_ACCEPT,
]

export function createYjsUndoTrackedOrigins(): Set<YjsOrigin | null> {
  return new Set(YJS_UNDOABLE_ORIGINS)
}
