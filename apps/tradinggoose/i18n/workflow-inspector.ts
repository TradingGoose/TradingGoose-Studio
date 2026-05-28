import { getPublicCopy } from './public-copy'
import type { LocaleCode } from './utils'

export type WorkflowInspectorCopy = ReturnType<
  typeof getPublicCopy
>['workspace']['widgets']['workflowInspector']

export function getWorkflowInspectorCopy(locale: LocaleCode): WorkflowInspectorCopy {
  return getPublicCopy(locale).workspace.widgets.workflowInspector
}
