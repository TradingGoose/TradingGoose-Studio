'use client'

import { Blocks, LibraryBig, Workflow } from 'lucide-react'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'

interface CopilotWelcomeProps {
  onQuestionClick?: (question: string) => void
  accessLevel?: CopilotAccessLevel
}

export function CopilotWelcome({ onQuestionClick, accessLevel = 'limited' }: CopilotWelcomeProps) {
  const copilotCopy = useCopilotMessages()

  const handleQuestionClick = (question: string) => {
    onQuestionClick?.(question)
  }

  const subtitle =
    accessLevel === 'full'
      ? copilotCopy.welcome.subtitleFull
      : copilotCopy.welcome.subtitleLimited

  const capabilities =
    accessLevel === 'full'
      ? [
          {
            title: copilotCopy.welcome.cards.buildEditWorkflows.title,
            question: copilotCopy.welcome.cards.buildEditWorkflows.question,
            Icon: Workflow,
          },
          {
            title: copilotCopy.welcome.cards.optimizeWorkflows.title,
            question: copilotCopy.welcome.cards.optimizeWorkflows.question,
            Icon: Blocks,
          },
          {
            title: copilotCopy.welcome.cards.debugWorkflows.title,
            question: copilotCopy.welcome.cards.debugWorkflows.question,
            Icon: LibraryBig,
          },
        ]
      : [
          {
            title: copilotCopy.welcome.cards.understandWorkflows.title,
            question: copilotCopy.welcome.cards.understandWorkflows.question,
            Icon: Workflow,
          },
          {
            title: copilotCopy.welcome.cards.reviewChangesSafely.title,
            question: copilotCopy.welcome.cards.reviewChangesSafely.question,
            Icon: Blocks,
          },
          {
            title: copilotCopy.welcome.cards.planNextSteps.title,
            question: copilotCopy.welcome.cards.planNextSteps.question,
            Icon: LibraryBig,
          },
        ]

  return (
    <div className='relative h-full w-full overflow-hidden px-4 pt-8 pb-6'>
      <div className='relative mx-auto w-full max-w-xl'>
        {/* Header */}
        <div className='flex flex-col items-center text-center'>
          <h3 className='mt-2 font-medium text-foreground text-lg sm:text-xl'>{subtitle}</h3>
        </div>

        {/* Unified capability cards */}
        <div className='mt-7 space-y-2.5'>
          {capabilities.map(({ title, question, Icon }, idx) => (
            <button
              key={idx}
              type='button'
              onClick={() => handleQuestionClick(question)}
              className='w-full rounded-md border bg-background/60 p-3 text-left transition-colors hover:bg-card focus:outline-none focus:ring-2 focus:ring-[var(--primary-hover)]/30'
            >
              <div className='flex items-start gap-2'>
                <div className='mt-0.5 flex h-6 w-6 items-center justify-center rounded bg-[color-mix(in_srgb,var(--primary-hover)_16%,transparent)] text-primary-hover'>
                  <Icon className='h-3.5 w-3.5' />
                </div>
                <div>
                  <div className='font-medium text-xs'>{title}</div>
                  <p className='mt-1 text-[11px] text-muted-foreground'>{question}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Tips */}
        <div className='mt-6 text-center text-[11px] text-muted-foreground'>
          <p>
            {copilotCopy.welcome.tipPrefix}{' '}
            <span className='font-medium text-foreground'>@</span>{' '}
            {copilotCopy.welcome.tipSuffix}
          </p>
          <p className='mt-1.5'>{copilotCopy.welcome.shiftEnter}</p>
        </div>
      </div>
    </div>
  )
}
