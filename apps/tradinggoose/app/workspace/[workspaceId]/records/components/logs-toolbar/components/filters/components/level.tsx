import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/stores/logs/filters/store'
import { logLevelOptions } from './shared'

export default function Level() {
  const t = useTranslations('workspace.logs.dashboard.filters')
  const { level, setLevel } = useFilterStore()

  const getDisplayLabel = () => {
    if (level === 'all') return t('anyStatus')
    const selected = logLevelOptions.find((option) => option.value === level)
    return selected ? t(selected.labelKey) : t('anyStatus')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-between rounded-md border-[#E5E5E5] bg-background font-normal text-sm dark:border-[#414141] '
        >
          {getDisplayLabel()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className='w-[180px] rounded-lg border-[#E5E5E5] bg-background shadow-xs dark:border-[#414141] '
      >
        <DropdownMenuItem
          key='all'
          onSelect={(e) => {
            e.preventDefault()
            setLevel('all')
          }}
          className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
        >
          <span>{t('anyStatus')}</span>
          {level === 'all' && <Check className='h-4 w-4 text-muted-foreground' />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {logLevelOptions.map((levelItem) => (
          <DropdownMenuItem
            key={levelItem.value}
            onSelect={(e) => {
              e.preventDefault()
              setLevel(levelItem.value)
            }}
            className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <div className='flex items-center'>
              <div className={`mr-2 h-2 w-2 rounded-full ${levelItem.color}`} />
              {t(levelItem.labelKey)}
            </div>
            {level === levelItem.value && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
