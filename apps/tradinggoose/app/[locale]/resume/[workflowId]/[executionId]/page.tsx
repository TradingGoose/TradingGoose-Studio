import { getSession } from '@/lib/auth'
import { redirect } from '@/i18n/navigation'
import type { LocaleCode } from '@/i18n/utils'
import { WorkflowReview } from './review'

export default async function WorkflowReviewPage({
  params,
}: {
  params: Promise<{ locale: string; workflowId: string; executionId: string }>
}) {
  const { locale, workflowId, executionId } = await params
  if (!(await getSession())?.user?.id) {
    return redirect({
      href: {
        pathname: '/login',
        query: {
          callbackUrl: `/resume/${encodeURIComponent(workflowId)}/${encodeURIComponent(executionId)}`,
        },
      },
      locale: locale as LocaleCode,
    })
  }
  return <WorkflowReview workflowId={workflowId} executionId={executionId} />
}
