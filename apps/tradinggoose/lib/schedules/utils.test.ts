/**
 * Tests for schedule utility functions
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type BlockState,
  calculateNextRunTime,
  generateCronExpression,
  getScheduleTimeValues,
  getSubBlockValue,
  parseCronToHumanReadable,
  parseTimeString,
  validateCronExpression,
} from '@/lib/schedules/utils'

describe('Schedule Utilities', () => {
  describe('parseTimeString', () => {
    it.concurrent('should parse valid time strings', () => {
      expect(parseTimeString('09:30')).toEqual([9, 30])
      expect(parseTimeString('23:45')).toEqual([23, 45])
      expect(parseTimeString('00:00')).toEqual([0, 0])
    })

    it.concurrent('should return default values for invalid inputs', () => {
      expect(parseTimeString('')).toEqual([9, 0])
      expect(parseTimeString(null)).toEqual([9, 0])
      expect(parseTimeString(undefined)).toEqual([9, 0])
      expect(parseTimeString('invalid')).toEqual([9, 0])
    })

    it.concurrent('should handle malformed time strings', () => {
      expect(parseTimeString('9:30')).toEqual([9, 30])
      expect(parseTimeString('9:3')).toEqual([9, 3])
      expect(parseTimeString('9:')).toEqual([9, 0])
      expect(parseTimeString(':30')).toEqual([0, 30]) // Only has minutes
    })

    it.concurrent('should handle out-of-range time values', () => {
      expect(parseTimeString('25:30')).toEqual([25, 30]) // Hours > 24
      expect(parseTimeString('10:75')).toEqual([10, 75]) // Minutes > 59
      expect(parseTimeString('99:99')).toEqual([99, 99]) // Both out of range
    })
  })

  describe('getSubBlockValue', () => {
    it.concurrent('should get values from block subBlocks', () => {
      const block: BlockState = {
        type: 'schedule',
        subBlocks: {
          scheduleType: { value: 'daily' },
          dailyTime: { value: '09:30' },
          emptyValue: { value: '' },
          nullValue: { value: null },
        },
      } as BlockState

      expect(getSubBlockValue(block, 'scheduleType')).toBe('daily')
      expect(getSubBlockValue(block, 'dailyTime')).toBe('09:30')
      expect(getSubBlockValue(block, 'emptyValue')).toBe('')
      expect(getSubBlockValue(block, 'nullValue')).toBe('')
      expect(getSubBlockValue(block, 'nonExistent')).toBe('')
    })

    it.concurrent('should handle missing subBlocks', () => {
      const block = {
        type: 'schedule',
        subBlocks: {}, // Empty subBlocks
      } as BlockState

      expect(getSubBlockValue(block, 'anyField')).toBe('')
    })
  })

  describe('getScheduleTimeValues', () => {
    it.concurrent('should extract all time values from a block', () => {
      const block: BlockState = {
        type: 'schedule',
        subBlocks: {
          minutesInterval: { value: '15' },
          hourlyMinute: { value: '45' },
          dailyTime: { value: '10:15' },
          weeklyDay: { value: 'MON' },
          weeklyDayTime: { value: '12:00' },
          monthlyDay: { value: '15' },
          monthlyTime: { value: '14:30' },
          timezone: { value: 'UTC' },
        },
      } as BlockState

      const result = getScheduleTimeValues(block)

      expect(result).toEqual({
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 45,
        dailyTime: [10, 15],
        weeklyDay: 1, // MON = 1
        weeklyTime: [12, 0],
        monthlyDay: 15,
        monthlyTime: [14, 30],
        cronExpression: null,
      })
    })

    it.concurrent('should use default values for missing fields', () => {
      const block: BlockState = {
        type: 'schedule',
        subBlocks: {
          // Minimal config
          scheduleType: { value: 'daily' },
        },
      } as BlockState

      const result = getScheduleTimeValues(block)

      expect(result).toEqual({
        timezone: 'UTC',
        minutesInterval: 15, // Default
        hourlyMinute: 0, // Default
        dailyTime: [9, 0], // Default
        weeklyDay: 1, // Default (MON)
        weeklyTime: [9, 0], // Default
        monthlyDay: 1, // Default
        monthlyTime: [9, 0], // Default
        cronExpression: null,
      })
    })
  })

  describe('generateCronExpression', () => {
    it.concurrent('should generate correct cron expressions for different schedule types', () => {
      const scheduleValues = {
        minutesInterval: 15,
        hourlyMinute: 45,
        dailyTime: [10, 15] as [number, number],
        weeklyDay: 1, // Monday
        weeklyTime: [12, 0] as [number, number],
        monthlyDay: 15,
        monthlyTime: [14, 30] as [number, number],
        timezone: 'UTC',
        cronExpression: null,
      }

      // Minutes (every 15 minutes)
      expect(generateCronExpression('minutes', scheduleValues)).toBe('*/15 * * * *')

      // Hourly (at minute 45)
      expect(generateCronExpression('hourly', scheduleValues)).toBe('45 * * * *')

      // Daily (at 10:15)
      expect(generateCronExpression('daily', scheduleValues)).toBe('15 10 * * *')

      // Weekly (Monday at 12:00)
      expect(generateCronExpression('weekly', scheduleValues)).toBe('0 12 * * 1')

      // Monthly (15th at 14:30)
      expect(generateCronExpression('monthly', scheduleValues)).toBe('30 14 15 * *')
    })

    it.concurrent('should handle custom cron expressions', () => {
      // For this simplified test, let's skip the complex mocking
      // and just verify the 'custom' case is in the switch statement

      // Create a mock block with custom cron expression
      const mockBlock: BlockState = {
        type: 'schedule',
        subBlocks: {
          cronExpression: { value: '*/5 * * * *' },
        },
      }

      // Create schedule values with the block as any since we're testing a special case
      const scheduleValues = {
        ...getScheduleTimeValues(mockBlock),
        // Override as BlockState to access the cronExpression
        // This simulates what happens in the actual code
        subBlocks: mockBlock.subBlocks,
      } as any

      // Now properly test the custom case
      const result = generateCronExpression('custom', scheduleValues)
      expect(result).toBe('*/5 * * * *')

      // Also verify other schedule types still work
      const standardScheduleValues = {
        minutesInterval: 15,
        hourlyMinute: 30,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [10, 0] as [number, number],
        monthlyDay: 15,
        monthlyTime: [14, 30] as [number, number],
        timezone: 'UTC',
        cronExpression: null,
      }

      expect(generateCronExpression('minutes', standardScheduleValues)).toBe('*/15 * * * *')
    })

    it.concurrent('should throw for invalid schedule types', () => {
      const scheduleValues = {} as any
      expect(() => generateCronExpression('invalid-type', scheduleValues)).toThrow()
    })
  })

  describe('calculateNextRunTime', () => {
    beforeEach(() => {
      // Mock Date.now for consistent testing
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-04-12T12:00:00.000Z')) // Noon on April 12, 2025
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it.concurrent('should calculate next run for minutes schedule using Croner', () => {
      const scheduleValues = {
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('minutes', scheduleValues)

      // Just check that it's a valid date in the future
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)

      // Croner will calculate based on the cron expression */15 * * * *
      // The exact minute depends on Croner's calculation
    })

    it.concurrent('should calculate next run for hourly schedule using Croner', () => {
      const scheduleValues = {
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 30,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('hourly', scheduleValues)

      // Verify it's a valid future date using Croner's calculation
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
      // Croner calculates based on cron "30 * * * *"
      expect(nextRun.getMinutes()).toBe(30)
    })

    it.concurrent('should calculate next run for daily schedule using Croner with timezone', () => {
      const scheduleValues = {
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('daily', scheduleValues)

      // Verify it's a future date at exactly 9:00 UTC using Croner
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
      expect(nextRun.getUTCHours()).toBe(9)
      expect(nextRun.getUTCMinutes()).toBe(0)
    })

    it.concurrent(
      'should calculate next run for weekly schedule using Croner with timezone',
      () => {
        const scheduleValues = {
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1, // Monday
          weeklyTime: [10, 0] as [number, number],
          monthlyDay: 1,
          monthlyTime: [9, 0] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('weekly', scheduleValues)

        // Should be next Monday at 10:00 AM UTC using Croner
        expect(nextRun.getUTCDay()).toBe(1) // Monday
        expect(nextRun.getUTCHours()).toBe(10)
        expect(nextRun.getUTCMinutes()).toBe(0)
      }
    )

    it.concurrent(
      'should calculate next run for monthly schedule using Croner with timezone',
      () => {
        const scheduleValues = {
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1,
          weeklyTime: [9, 0] as [number, number],
          monthlyDay: 15,
          monthlyTime: [14, 30] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('monthly', scheduleValues)

        // Current date is 2025-04-12 12:00, so next run should be 2025-04-15 14:30 UTC using Croner
        expect(nextRun.getFullYear()).toBe(2025)
        expect(nextRun.getUTCMonth()).toBe(3) // April (0-indexed)
        expect(nextRun.getUTCDate()).toBe(15)
        expect(nextRun.getUTCHours()).toBe(14)
        expect(nextRun.getUTCMinutes()).toBe(30)
      }
    )

    it.concurrent(
      'should work with lastRanAt parameter (though Croner calculates independently)',
      () => {
        const scheduleValues = {
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1,
          weeklyTime: [9, 0] as [number, number],
          monthlyDay: 1,
          monthlyTime: [9, 0] as [number, number],
          cronExpression: null,
        }

        // Last ran 10 minutes ago
        const lastRanAt = new Date()
        lastRanAt.setMinutes(lastRanAt.getMinutes() - 10)

        const nextRun = calculateNextRunTime('minutes', scheduleValues, lastRanAt)

        // With Croner, it calculates based on cron expression, not lastRanAt
        // Just verify we get a future date
        expect(nextRun instanceof Date).toBe(true)
        expect(nextRun > new Date()).toBe(true)
      }
    )

  })

  describe('validateCronExpression', () => {
    it.concurrent('should validate correct cron expressions', () => {
      expect(validateCronExpression('0 9 * * *')).toEqual({
        isValid: true,
        nextRun: expect.any(Date),
      })
      expect(validateCronExpression('*/15 * * * *')).toEqual({
        isValid: true,
        nextRun: expect.any(Date),
      })
      expect(validateCronExpression('30 14 15 * *')).toEqual({
        isValid: true,
        nextRun: expect.any(Date),
      })
    })

    it.concurrent('should validate cron expressions with utc offset', () => {
      const result = validateCronExpression('0 9 * * *', -420)
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
    })

    it.concurrent('should reject invalid cron expressions', () => {
      expect(validateCronExpression('invalid')).toEqual({
        isValid: false,
        error: expect.stringContaining('invalid'),
      })
      expect(validateCronExpression('60 * * * *')).toEqual({
        isValid: false,
        error: expect.any(String),
      })
      expect(validateCronExpression('')).toEqual({
        isValid: false,
        error: 'Cron expression cannot be empty',
      })
      expect(validateCronExpression('   ')).toEqual({
        isValid: false,
        error: 'Cron expression cannot be empty',
      })
    })

    it.concurrent('should detect impossible cron expressions', () => {
      // This would be February 31st - impossible date
      expect(validateCronExpression('0 0 31 2 *')).toEqual({
        isValid: false,
        error: 'Cron expression produces no future occurrences',
      })
    })
  })

  describe('parseCronToHumanReadable', () => {
    it.concurrent('should parse common cron patterns using cronstrue', () => {
      // cronstrue produces "Every minute" for '* * * * *'
      expect(parseCronToHumanReadable('* * * * *')).toBe('Every minute')

      // cronstrue produces "Every 15 minutes" for '*/15 * * * *'
      expect(parseCronToHumanReadable('*/15 * * * *')).toBe('Every 15 minutes')

      // cronstrue produces "At 30 minutes past the hour" for '30 * * * *'
      expect(parseCronToHumanReadable('30 * * * *')).toContain('30 minutes past the hour')

      // cronstrue produces "At 09:00 AM" for '0 9 * * *'
      expect(parseCronToHumanReadable('0 9 * * *')).toContain('09:00 AM')

      // cronstrue produces "At 02:30 PM" for '30 14 * * *'
      expect(parseCronToHumanReadable('30 14 * * *')).toContain('02:30 PM')

      // cronstrue produces "At 09:00 AM, only on Monday" for '0 9 * * 1'
      expect(parseCronToHumanReadable('0 9 * * 1')).toContain('Monday')

      // cronstrue produces "At 02:30 PM, on day 15 of the month" for '30 14 15 * *'
      expect(parseCronToHumanReadable('30 14 15 * *')).toContain('15')
    })

    it.concurrent('should include timezone information when provided', () => {
      const resultPT = parseCronToHumanReadable('0 9 * * *', 'America/Los_Angeles')
      expect(resultPT).toContain('(America/Los_Angeles)')
      expect(resultPT).toContain('09:00 AM')

      const resultET = parseCronToHumanReadable('30 14 * * *', 'America/New_York')
      expect(resultET).toContain('(America/New_York)')
      expect(resultET).toContain('02:30 PM')

      const resultUTC = parseCronToHumanReadable('0 12 * * *', 'UTC')
      expect(resultUTC).not.toContain('(UTC)') // UTC should not be explicitly shown
    })

    it.concurrent('should handle complex patterns with cronstrue', () => {
      // cronstrue can handle complex patterns better than our custom parser
      const result1 = parseCronToHumanReadable('0 9 * * 1-5')
      expect(result1).toContain('Monday through Friday')

      const result2 = parseCronToHumanReadable('0 9 1,15 * *')
      expect(result2).toContain('day 1 and 15')
    })

    it.concurrent('should return a fallback for invalid patterns', () => {
      const result = parseCronToHumanReadable('invalid cron')
      // Should fallback to "Schedule: <expression>"
      expect(result).toContain('Schedule:')
      expect(result).toContain('invalid cron')
    })
  })

})
