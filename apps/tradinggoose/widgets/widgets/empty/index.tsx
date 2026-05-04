'use client'

import { MinusCircle } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { WidgetSelector } from '@/widgets/widgets/components/widget-selector'

type EmptyWidgetProps = WidgetComponentProps & {
  onWidgetChange?: (widgetKey: string) => void
}

const EmptyHeaderLabel = () => {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.widgets.empty

  return <span className='text-muted-foreground text-xs'>{copy.noWidgetSelected}</span>
}

const EmptyBody = ({ widget, onWidgetChange }: EmptyWidgetProps) => {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.widgets.empty

  const isEmptyWidget = widget?.key && widget.key !== 'empty'

  return (
    <Empty className='p-6'>
      <EmptyHeader>
        <EmptyMedia variant='default'>
          <Avatar className='size-12 border border-border/60 '>
            <AvatarFallback className='bg-transparent'>
              <MinusCircle className='size-5 text-muted-foreground' aria-hidden='true' />
            </AvatarFallback>
          </Avatar>
        </EmptyMedia>
        <EmptyTitle>{isEmptyWidget ? copy.emptyWidget : copy.noWidgetSelected}</EmptyTitle>
        <EmptyDescription>
          {isEmptyWidget ? copy.emptyWidgetDescription : copy.noWidgetDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <WidgetSelector
          currentKey={widget?.key}
          onSelect={(key) => onWidgetChange?.(key)}
          disabled={!onWidgetChange}
          renderTrigger={({ disabled }) => (
            <Button size='sm' variant='outline' disabled={disabled} type='button'>
              {copy.chooseWidget}
            </Button>
          )}
        />
      </EmptyContent>
    </Empty>
  )
}

export const emptyWidget: DashboardWidgetDefinition = {
  key: 'empty',
  title: 'Empty Surface',
  icon: MinusCircle,
  category: 'utility',
  description: 'Placeholder state shown when the panel does not have a widget assigned.',
  component: EmptyBody,
  renderHeader: () => ({
    center: <EmptyHeaderLabel />,
  }),
}
