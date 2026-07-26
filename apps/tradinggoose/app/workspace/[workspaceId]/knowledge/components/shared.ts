export const filterButtonClass =
  'w-full justify-between rounded-md border-[#E5E5E5] bg-background font-normal text-sm dark:border-[#414141] '

export const dropdownContentClass =
  'w-[220px] rounded-sm border-border bg-background p-0 shadow-xs '

export const commandListClass = 'overflow-y-auto overflow-x-hidden'

export type SortOption = 'name'
export type SortOrder = 'asc' | 'desc'

export const SORT_OPTION_DEFINITIONS = [
  { value: 'name-asc', labelKey: 'sort.nameAsc' },
  { value: 'name-desc', labelKey: 'sort.nameDesc' },
] as const
