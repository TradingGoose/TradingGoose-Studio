import { MinusCircle } from 'lucide-react'
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
import { WidgetSelector } from '@/widgets/components/widget-selector'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'

type EmptyWidgetProps = WidgetComponentProps & {
  onWidgetChange?: (widgetKey: string) => void
}

const EmptyBody = ({ widget, onWidgetChange }: EmptyWidgetProps) => (
  <Empty className='p-6'>
    <EmptyHeader>
      <EmptyMedia variant='default'>
        <Avatar className='size-12 border border-border/60 '>
          <AvatarFallback className='bg-transparent'>
            <MinusCircle className='size-5 text-muted-foreground' aria-hidden='true' />
          </AvatarFallback>
        </Avatar>
      </EmptyMedia>
      <EmptyTitle>
        {widget?.key && widget?.key !== 'empty' ? 'Empty Widget' : 'No widget selected'}
      </EmptyTitle>
      <EmptyDescription>
        {widget?.key && widget?.key !== 'empty'
          ? 'This widget is currently empty, choose another widget to continue.'
          : 'Pick a widget from the gallery to start using this panel.'}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <WidgetSelector
        currentKey={widget?.key}
        onSelect={(key) => onWidgetChange?.(key)}
        disabled={!onWidgetChange}
        renderTrigger={({ disabled }) => (
          <Button size='sm' variant='outline' disabled={disabled} type='button'>
            Choose Widget
          </Button>
        )}
      />
    </EmptyContent>
  </Empty>
)

export const emptyWidget: DashboardWidgetDefinition = {
  key: 'empty',
  title: 'Empty Surface',
  icon: MinusCircle,
  category: 'utility',
  description: 'Placeholder state shown when the panel does not have a widget assigned.',
  component: EmptyBody,
  renderHeader: () => ({
    center: <span className='text-muted-foreground text-xs'>No widget selected</span>,
  }),
}
