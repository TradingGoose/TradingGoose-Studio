import { z } from 'zod'
import { env } from '@/lib/env'
import { isHosted } from '@/lib/environment'
import { getBaseUrl } from '@/lib/urls/utils'

const CompletionUsageReportSchema = z.object({
  kind: z.literal('completion'),
  model: z.string().min(1),
  usage: z.any(),
  remoteModel: z.string().nullable().optional(),
  completionId: z.string().nullable().optional(),
  workflowId: z.string().nullable().optional(),
})

export type LocalCompletionUsageReport = z.infer<typeof CompletionUsageReportSchema>

export async function commitLocalCompletionUsageReports(params: {
  userId: string
  reports: unknown[]
  requestId: string
  logger: {
    warn: (message: string, data?: unknown) => void
  }
}) {
  if (isHosted || params.reports.length === 0) return

  const url = new URL('/api/copilot/usage', getBaseUrl()).toString()
  for (const report of params.reports) {
    const parsed = CompletionUsageReportSchema.safeParse(report)
    if (!parsed.success) {
      params.logger.warn(`[${params.requestId}] Skipping invalid copilot completion usage report`, {
        errors: parsed.error.errors,
      })
      continue
    }

    const payload = parsed.data
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.INTERNAL_API_SECRET,
        },
        body: JSON.stringify({
          action: 'commit',
          kind: 'completion',
          userId: params.userId,
          model: payload.model,
          usage: payload.usage,
          ...(payload.remoteModel ? { remoteModel: payload.remoteModel } : {}),
          ...(payload.completionId ? { completionId: payload.completionId } : {}),
          ...(payload.workflowId ? { workflowId: payload.workflowId } : {}),
        }),
      })

      if (!response.ok) {
        params.logger.warn(`[${params.requestId}] Local copilot completion billing failed`, {
          status: response.status,
        })
      }
    } catch (error) {
      params.logger.warn(`[${params.requestId}] Local copilot completion billing failed`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
