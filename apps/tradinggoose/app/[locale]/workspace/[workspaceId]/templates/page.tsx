import { db } from '@tradinggoose/db'
import { templateStars, templates } from '@tradinggoose/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getLocale } from 'next-intl/server'
import { getSession } from '@/lib/auth'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import type { Template } from '@/app/workspace/[workspaceId]/templates/templates'
import Templates from '@/app/workspace/[workspaceId]/templates/templates'

export default async function TemplatesPage() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale).workspace.templates
  const session = await getSession()

  if (!session?.user?.id) {
    return <div>{copy.loginRequired}</div>
  }

  // Fetch templates server-side with all necessary data
  const templatesData = await db
    .select({
      id: templates.id,
      workflowId: templates.workflowId,
      userId: templates.userId,
      name: templates.name,
      description: templates.description,
      author: templates.author,
      views: templates.views,
      stars: templates.stars,
      color: templates.color,
      icon: templates.icon,
      category: templates.category,
      state: templates.state,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
      isStarred: sql<boolean>`CASE WHEN ${templateStars.id} IS NOT NULL THEN true ELSE false END`,
    })
    .from(templates)
    .leftJoin(
      templateStars,
      and(eq(templateStars.templateId, templates.id), eq(templateStars.userId, session.user.id))
    )
    .orderBy(desc(templates.views), desc(templates.createdAt))

  return (
    <Templates
      initialTemplates={templatesData as unknown as Template[]}
      currentUserId={session.user.id}
    />
  )
}
