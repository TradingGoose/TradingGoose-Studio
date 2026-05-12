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
  valueById?: Record<string, boolean>
  onOptionChange?: (optionId: string, checked: boolean) => void
}

export function CheckboxList({
  blockId,
  subBlockId,
  options,
  layout,
  disabled = false,
  valueById,
  onOptionChange,
}: CheckboxListProps) {
  const isControlled = valueById !== undefined && onOptionChange !== undefined

  return (
    <div className={cn('grid gap-4', layout === 'half' ? 'grid-cols-2' : 'grid-cols-1', 'pt-1')}>
      {options.map((option) => {
        const [storeValue, setStoreValue] = useSubBlockValue(blockId, option.id)
        const inputId = `${blockId}-${subBlockId}-${option.id}`
        const checked = isControlled ? Boolean(valueById[option.id]) : Boolean(storeValue)

        const handleChange = (nextChecked: boolean) => {
          if (disabled) return
          if (isControlled) {
            onOptionChange(option.id, nextChecked)
            return
          }
          setStoreValue(nextChecked)
        }

        return (
          <div key={option.id} className='flex items-center space-x-2'>
            <Checkbox
              id={inputId}
              checked={checked}
              onCheckedChange={(nextChecked) => handleChange(nextChecked === true)}
              disabled={disabled}
            />
            <Label
              htmlFor={inputId}
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
