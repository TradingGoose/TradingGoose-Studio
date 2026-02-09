export type MarketHoursResponse = {
  isHoliday?: boolean
  timeZone?: {
    name?: string
    utcOffset?: string
    dstOn?: boolean
    observesDst?: boolean
  }
  marketHours?: {
    premarket?: { start?: string; end?: string }
    market?: { start?: string; end?: string }
    postmarket?: { start?: string; end?: string }
  }
}

export type MarketSession = 'regular' | 'extended'
