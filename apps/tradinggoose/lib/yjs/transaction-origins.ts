export const YJS_ORIGINS = {
  SYSTEM: 'system',
  USER: 'user',
  COPILOT_TOOL: 'copilot-tool',
  COPILOT_REVIEW_ACCEPT: 'copilot-review-accept',
  SAVE: 'save',
} as const

export type YjsOrigin = (typeof YJS_ORIGINS)[keyof typeof YJS_ORIGINS]
