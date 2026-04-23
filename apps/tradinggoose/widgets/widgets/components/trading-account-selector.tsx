'use client'

import { Check, ChevronDown, Wallet } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

type TradingAccountOption = {
  id: string
  name?: string | null
}

type TradingAccountSelectorProps = {
  accountId?: string | null
  accounts: TradingAccountOption[]
  isAccountsLoading?: boolean
  accountsError?: unknown
  disabled?: boolean
  placeholder?: string
  tooltipText?: string
  onAccountSelect?: (accountId: string) => void
}

export function TradingAccountSelector({
  accountId,
  accounts,
  isAccountsLoading = false,
  accountsError,
  disabled = false,
  placeholder,
  tooltipText,
  onAccountSelect,
}: TradingAccountSelectorProps) {
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null
  const buttonLabel =
    selectedAccount?.name ?? selectedAccount?.id ?? placeholder ?? 'Select account'
  const resolvedTooltipText = tooltipText ?? 'Select trading account'

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                disabled={disabled}
                className={widgetHeaderControlClassName(
                  'group flex min-w-[220px] items-center justify-between gap-2'
                )}
                aria-haspopup='listbox'
                aria-label='Select trading account'
              >
                <span className='flex min-w-0 flex-1 items-center gap-2 overflow-hidden'>
                  <span
                    className='h-5 w-5 rounded-xs bg-muted/60 p-0.5 text-muted-foreground'
                    aria-hidden='true'
                  >
                    <Wallet className='h-4 w-4' />
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-left text-sm',
                      selectedAccount ? 'font-medium text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {buttonLabel}
                  </span>
                </span>
                <ChevronDown
                  className='h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
                  aria-hidden='true'
                />
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{resolvedTooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-[260px] p-1')}
      >
        {isAccountsLoading ? (
          <div className='px-3 py-2 text-muted-foreground text-xs'>Loading accounts...</div>
        ) : accountsError ? (
          <div className='px-3 py-2 text-muted-foreground text-xs'>
            Unable to load broker accounts.
          </div>
        ) : accounts.length === 0 ? (
          <div className='px-3 py-2 text-muted-foreground text-xs'>No broker accounts found.</div>
        ) : (
          accounts.map((account) => (
            <DropdownMenuItem
              key={account.id}
              className={cn(widgetHeaderMenuItemClassName, 'justify-between')}
              onSelect={() => {
                if (account.id === accountId) return
                onAccountSelect?.(account.id)
              }}
            >
              <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                {account.name ?? account.id}
              </span>
              {account.id === accountId ? <Check className='h-3.5 w-3.5 text-primary' /> : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
