'use client'

import { Blocks, LibraryBig, Workflow } from 'lucide-react'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'

interface CopilotWelcomeProps {
  onQuestionClick?: (question: string) => void
  accessLevel?: CopilotAccessLevel
}

export function CopilotWelcome({ onQuestionClick, accessLevel = 'limited' }: CopilotWelcomeProps) {
  const handleQuestionClick = (question: string) => {
    onQuestionClick?.(question)
  }

  const subtitle =
    accessLevel === 'full'
      ? 'Apply workflow, skill, MCP, and tool changes directly with full access'
      : 'Ask questions and review workflow, skill, MCP, and tool changes before they apply'

  const capabilities =
    accessLevel === 'full'
      ? [
          {
            title: 'Build & edit workflows',
            question: 'Help me build a workflow',
            Icon: Workflow,
          },
          {
            title: 'Optimize workflows',
            question: 'Help me optimize my workflow',
            Icon: Blocks,
          },
          {
            title: 'Debug workflows',
            question: 'Help me debug my workflow',
            Icon: LibraryBig,
          },
        ]
      : [
          {
            title: 'Understand workflows',
            question: 'What does my workflow do?',
            Icon: Workflow,
          },
          {
            title: 'Review changes safely',
            question: 'Help me update this workflow safely',
            Icon: Blocks,
          },
          {
            title: 'Plan next steps',
            question: 'What should I change in this workflow next?',
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
            Tip: Use <span className='font-medium text-foreground'>@</span> to reference chats,
            workflows, knowledge, blocks, or templates
          </p>
          <p className='mt-1.5'>Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  )
}
