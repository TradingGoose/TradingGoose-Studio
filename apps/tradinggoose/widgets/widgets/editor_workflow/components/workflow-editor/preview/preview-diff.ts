export type PreviewDiffStatus = 'new' | 'edited'

export type PreviewDiffOperation = {
  operation_type?: string
  block_id?: string
}

const PREVIEW_DIFF_CLASS_BY_STATUS: Record<PreviewDiffStatus, string> = {
  new: 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
  edited: 'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
}

function toPreviewDiffStatus(operationType?: string): PreviewDiffStatus | null {
  switch (operationType) {
    case 'add':
      return 'new'
    case 'edit':
    case 'insert_into_subflow':
    case 'extract_from_subflow':
      return 'edited'
    default:
      return null
  }
}

export function buildPreviewDiffStatusMap(
  operations?: PreviewDiffOperation[]
): Map<string, PreviewDiffStatus> {
  const statuses = new Map<string, PreviewDiffStatus>()

  for (const operation of operations || []) {
    const blockId = operation.block_id
    if (!blockId) {
      continue
    }

    const nextStatus = toPreviewDiffStatus(operation.operation_type)
    if (!nextStatus) {
      continue
    }

    const currentStatus = statuses.get(blockId)
    if (currentStatus === 'new') {
      continue
    }

    statuses.set(blockId, nextStatus)
  }

  return statuses
}

export function getPreviewDiffClasses(status?: PreviewDiffStatus): string {
  return status ? PREVIEW_DIFF_CLASS_BY_STATUS[status] : ''
}
