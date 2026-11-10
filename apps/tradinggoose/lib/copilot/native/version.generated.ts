/** Generated from the accepted canonical protocol/schema; do not edit. */
export const COPILOT_NATIVE_REVISION = "copilot-native/2026-11-09.8" as const
export const COPILOT_NATIVE_API_VERSION = "v1" as const
export const COPILOT_NATIVE_COMMAND_STATUSES = {
  "message": [
    "completed",
    "suspended",
    "refused",
    "failed"
  ],
  "pending.list": [
    "pending_targets",
    "refused",
    "failed"
  ],
  "tool.approve": [
    "completed",
    "suspended",
    "refused",
    "failed"
  ],
  "tool.decline": [
    "completed",
    "suspended",
    "refused",
    "failed"
  ],
  "tool.result": [
    "completed",
    "suspended",
    "refused",
    "failed"
  ],
  "cancel": [
    "cancel_requested",
    "refused",
    "failed"
  ],
  "threads.list": [
    "threads",
    "refused",
    "failed"
  ],
  "history.read": [
    "history",
    "refused",
    "failed"
  ],
  "thread.title": [
    "updated",
    "refused",
    "failed"
  ],
  "history.edit": [
    "updated",
    "refused",
    "failed"
  ],
  "thread.delete": [
    "updated",
    "refused",
    "failed"
  ],
  "context.read": [
    "context",
    "refused",
    "failed"
  ],
  "context.compact": [
    "compacted",
    "refused",
    "failed"
  ]
} as const
