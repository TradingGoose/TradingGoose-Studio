import { Cron } from 'croner'
import cronstrue from 'cronstrue'
import { createLogger } from '@/lib/logs/console/logger'
import { formatTimezoneLabel } from '@/lib/time-format'
import { formatDateTime } from '@/lib/utils'

const logger = createLogger('ScheduleUtils')

/**
 * Validates a cron expression and returns validation results
 * @param cronExpression - The cron expression to validate
 * @param utcOffsetMinutes - Optional UTC offset in minutes (e.g., -420). Defaults to 0
 * @returns Validation result with isValid flag, error message, and next run date
 */
export function validateCronExpression(
  cronExpression: string,
  utcOffsetMinutes = 0
): {
  isValid: boolean
  error?: string
  nextRun?: Date
} {
  if (!cronExpression?.trim()) {
    return {
      isValid: false,
      error: 'Cron expression cannot be empty',
    }
  }

  try {
    // Validate using explicit UTC offset for deterministic scheduling
    const cron = new Cron(cronExpression, { utcOffset: utcOffsetMinutes })
    const nextRun = cron.nextRun()

    if (!nextRun) {
      return {
        isValid: false,
        error: 'Cron expression produces no future occurrences',
      }
    }

    return {
      isValid: true,
      nextRun,
    }
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid cron expression syntax',
    }
  }
}

export interface SubBlockValue {
  value: string
}

export interface BlockState {
  type: string
  subBlocks: Record<string, SubBlockValue | any>
  [key: string]: any
}

export const DAY_MAP: Record<string, number> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 0,
}

/**
 * Safely extract a value from a block's subBlocks
 */
export function getSubBlockValue(block: BlockState, id: string): string {
  const subBlock = block.subBlocks[id] as SubBlockValue | undefined
  return subBlock?.value || ''
}

/**
 * Parse and extract hours and minutes from a time string
 * @param timeString - Time string in format "HH:mm" or "HH:mm:ss"
 * @returns Array with [hours, minutes] as numbers, or [9, 0] as default
 */
export function parseTimeString(timeString: string | undefined | null): [number, number] {
  if (!timeString || !timeString.includes(':')) {
    return [9, 0] // Default to 9:00 AM
  }

  const [hours, minutes] = timeString.split(':').map(Number)
  return [Number.isNaN(hours) ? 9 : hours, Number.isNaN(minutes) ? 0 : minutes]
}

/**
 * Get time values from a schedule trigger block
 * @param scheduleBlock - The trigger block containing schedule configuration
 * @returns Object with parsed time values
 */
export function getScheduleTimeValues(scheduleBlock: BlockState): {
  minutesInterval: number
  hourlyMinute: number
  dailyTime: [number, number]
  weeklyDay: number
  weeklyTime: [number, number]
  monthlyDay: number
  monthlyTime: [number, number]
  cronExpression: string | null
  timezone: string
} {
  // Extract timezone (default to UTC)
  const timezone = getSubBlockValue(scheduleBlock, 'timezone') || 'UTC'

  // Get minutes interval (default to 15)
  const minutesIntervalStr = getSubBlockValue(scheduleBlock, 'minutesInterval')
  const minutesInterval = Number.parseInt(minutesIntervalStr) || 15

  // Get hourly minute (default to 0)
  const hourlyMinuteStr = getSubBlockValue(scheduleBlock, 'hourlyMinute')
  const hourlyMinute = Number.parseInt(hourlyMinuteStr) || 0

  // Get daily time
  const dailyTime = parseTimeString(getSubBlockValue(scheduleBlock, 'dailyTime'))

  // Get weekly config
  const weeklyDayStr = getSubBlockValue(scheduleBlock, 'weeklyDay') || 'MON'
  const weeklyDay = DAY_MAP[weeklyDayStr] || 1
  const weeklyTime = parseTimeString(getSubBlockValue(scheduleBlock, 'weeklyDayTime'))

  // Get monthly config
  const monthlyDayStr = getSubBlockValue(scheduleBlock, 'monthlyDay')
  const monthlyDay = Number.parseInt(monthlyDayStr) || 1
  const monthlyTime = parseTimeString(getSubBlockValue(scheduleBlock, 'monthlyTime'))

  const cronExpression = getSubBlockValue(scheduleBlock, 'cronExpression') || null

  return {
    timezone,
    minutesInterval,
    hourlyMinute,
    dailyTime,
    weeklyDay,
    weeklyTime,
    monthlyDay,
    monthlyTime,
    cronExpression,
  }
}

/**
 * Generate cron expression based on schedule type and values
 *
 * IMPORTANT: The generated cron expressions use local time values (hours/minutes)
 * from the user's configured schedule. When used with Croner, pass a UTC offset
 * (minutes) so the server interprets the cron in the intended local time.
 *
 * Example:
 *   const cronExpr = generateCronExpression('daily', { dailyTime: [14, 30], timezone: 'UTC' })
 *   const cron = new Cron(cronExpr, { utcOffset: -420 })
 *
 * @param scheduleType - Type of schedule (minutes, hourly, daily, weekly, monthly, custom)
 * @param scheduleValues - Object containing schedule configuration including timezone
 * @returns Cron expression string representing the schedule in local time
 */
export function generateCronExpression(
  scheduleType: string,
  scheduleValues: ReturnType<typeof getScheduleTimeValues>
): string {
  switch (scheduleType) {
    case 'minutes':
      return `*/${scheduleValues.minutesInterval} * * * *`

    case 'hourly':
      return `${scheduleValues.hourlyMinute} * * * *`

    case 'daily': {
      const [hours, minutes] = scheduleValues.dailyTime
      return `${minutes} ${hours} * * *`
    }

    case 'weekly': {
      const [hours, minutes] = scheduleValues.weeklyTime
      return `${minutes} ${hours} * * ${scheduleValues.weeklyDay}`
    }

    case 'monthly': {
      const [hours, minutes] = scheduleValues.monthlyTime
      return `${minutes} ${hours} ${scheduleValues.monthlyDay} * *`
    }

    case 'custom': {
      if (!scheduleValues.cronExpression?.trim()) {
        throw new Error('Custom schedule requires a valid cron expression')
      }
      return scheduleValues.cronExpression
    }

    default:
      throw new Error(`Unsupported schedule type: ${scheduleType}`)
  }
}

/**
 * Calculate the next run time based on schedule configuration
 * Uses Croner library with an explicit UTC offset for deterministic scheduling
 * @param scheduleType - Type of schedule (minutes, hourly, daily, etc)
 * @param scheduleValues - Object with schedule configuration values
 * @param lastRanAt - Optional last execution time
 * @returns Date object for next execution time
 */
export function calculateNextRunTime(
  scheduleType: string,
  scheduleValues: ReturnType<typeof getScheduleTimeValues>,
  lastRanAt?: Date | null,
  utcOffsetMinutes = 0
): Date {
  try {
    const cronExpression = generateCronExpression(scheduleType, scheduleValues)
    logger.debug(`Using cron expression: ${cronExpression} with utcOffset: ${utcOffsetMinutes}`)

    const cron = new Cron(cronExpression, {
      utcOffset: utcOffsetMinutes,
    })

    const nextDate = cron.nextRun()

    if (!nextDate) {
      throw new Error(`No next run date calculated for cron: ${cronExpression}`)
    }

    if (lastRanAt && nextDate <= lastRanAt) {
      throw new Error('Next run date is not after last run')
    }

    logger.debug(`Next run calculated: ${nextDate.toISOString()}`)
    return nextDate
  } catch (error) {
    logger.error('Error calculating next run with Croner:', error)
    throw new Error(
      `Failed to calculate next run time for schedule type ${scheduleType}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Converts a cron expression to a human-readable string format
 * Uses the cronstrue library for accurate parsing of complex cron expressions
 *
 * @param cronExpression - The cron expression to parse
 * @param timezone - Optional IANA timezone string to include in the description
 * @returns Human-readable description of the schedule
 */
export const parseCronToHumanReadable = (cronExpression: string, timezone?: string): string => {
  try {
    // Use cronstrue for reliable cron expression parsing
    const baseDescription = cronstrue.toString(cronExpression, {
      use24HourTimeFormat: false, // Use 12-hour format with AM/PM
      verbose: false, // Keep it concise
    })

    const tzLabel = formatTimezoneLabel(timezone)
    return tzLabel && tzLabel !== 'UTC' ? `${baseDescription} (${tzLabel})` : baseDescription
  } catch (error) {
    logger.warn('Failed to parse cron expression with cronstrue:', {
      cronExpression,
      error: error instanceof Error ? error.message : String(error),
    })
    const tzLabel = formatTimezoneLabel(timezone)
    return `Schedule: ${cronExpression}${tzLabel && tzLabel !== 'UTC' ? ` (${tzLabel})` : ''}`
  }
}

/**
 * Format schedule information for display
 */
export const getScheduleInfo = (
  cronExpression: string | null,
  nextRunAt: string | null,
  lastRanAt: string | null,
  scheduleType?: string | null,
  utcOffset?: string | null
): {
  scheduleTiming: string
  nextRunFormatted: string | null
  lastRunFormatted: string | null
} => {
  if (!nextRunAt) {
    return {
      scheduleTiming: 'Unknown schedule',
      nextRunFormatted: null,
      lastRunFormatted: null,
    }
  }

  let scheduleTiming = 'Unknown schedule'

  if (cronExpression) {
    scheduleTiming = parseCronToHumanReadable(cronExpression, utcOffset || undefined)
  } else if (scheduleType) {
    scheduleTiming = `${scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}`
  }

  return {
    scheduleTiming,
    nextRunFormatted: formatDateTime(new Date(nextRunAt), utcOffset || undefined),
    lastRunFormatted: lastRanAt ? formatDateTime(new Date(lastRanAt), utcOffset || undefined) : null,
  }
}
