export const filterButtonClass =
  'w-full justify-between rounded-md border-[#E5E5E5] bg-background font-normal text-sm dark:border-[#414141] '

export const dropdownContentClass =
  'w-[220px] rounded-sm border-border bg-background p-0 shadow-xs '

export const commandListClass = 'overflow-y-auto overflow-x-hidden'

export type SortOption = 'name' | 'createdAt' | 'updatedAt' | 'docCount'
export type SortOrder = 'asc' | 'desc'

export const SORT_OPTION_DEFINITIONS = [
  { value: 'updatedAt-desc', labelKey: 'sort.lastUpdated' },
  { value: 'createdAt-desc', labelKey: 'sort.newestFirst' },
  { value: 'createdAt-asc', labelKey: 'sort.oldestFirst' },
  { value: 'name-asc', labelKey: 'sort.nameAsc' },
  { value: 'name-desc', labelKey: 'sort.nameDesc' },
  { value: 'docCount-desc', labelKey: 'sort.mostDocuments' },
  { value: 'docCount-asc', labelKey: 'sort.leastDocuments' },
] as const
