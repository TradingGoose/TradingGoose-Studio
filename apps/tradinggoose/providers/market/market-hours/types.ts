export type MarketHoursResponse = {
  isHoliday?: boolean
  timeZone?: {
    name?: string
    utcOffset?: string
    dstOn?: boolean
    observesDst?: boolean
  }
  marketHours?: {
    premarket?: { start?: string; end?: string } | null
    market?: { start?: string; end?: string } | null
    postmarket?: { start?: string; end?: string } | null
  }
}

export type MarketSession = 'regular' | 'extended'
