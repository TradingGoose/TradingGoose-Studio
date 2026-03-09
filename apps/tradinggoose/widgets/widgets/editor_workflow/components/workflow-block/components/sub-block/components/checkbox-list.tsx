import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface CheckboxListProps {
  blockId: string
  subBlockId: string
  options: { label: string; id: string }[]
  layout?: 'full' | 'half'
  disabled?: boolean
}

export function CheckboxList({
  blockId,
  options,
  layout,
  disabled = false,
}: CheckboxListProps) {
  return (
    <div className={cn('grid gap-4', layout === 'half' ? 'grid-cols-2' : 'grid-cols-1', 'pt-1')}>
      {options.map((option) => {
        const [storeValue, setStoreValue] = useSubBlockValue(blockId, option.id)

        const handleChange = (checked: boolean) => {
          if (!disabled) {
            setStoreValue(checked)
          }
        }

        return (
          <div key={option.id} className='flex items-center space-x-2'>
            <Checkbox
              id={`${blockId}-${option.id}`}
              checked={Boolean(storeValue)}
              onCheckedChange={handleChange}
              disabled={disabled}
            />
            <Label
              htmlFor={`${blockId}-${option.id}`}
              className='cursor-pointer font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              {option.label}
            </Label>
          </div>
        )
      })}
    </div>
  )
}
