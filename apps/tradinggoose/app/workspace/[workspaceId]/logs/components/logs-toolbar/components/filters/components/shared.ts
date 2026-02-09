export const filterButtonClass =
  'inline-flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-[#E5E5E5] bg-background px-3 font-normal text-sm text-foreground transition-colors ring-offset-background hover:bg-card hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 dark:border-[#414141]'

export const dropdownContentClass =
  'w-[200px] rounded-sm border-border bg-background p-0 shadow-xs '

export const commandListClass = 'overflow-y-auto overflow-x-hidden'

export const workflowDropdownListStyle = {
  maxHeight: '14rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const

export const folderDropdownListStyle = {
  maxHeight: '10rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const

export const triggerDropdownListStyle = {
  maxHeight: '7.5rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const

export const timelineDropdownListStyle = {
  maxHeight: '9rem',
  overflowY: 'auto',
  overflowX: 'hidden',
} as const
