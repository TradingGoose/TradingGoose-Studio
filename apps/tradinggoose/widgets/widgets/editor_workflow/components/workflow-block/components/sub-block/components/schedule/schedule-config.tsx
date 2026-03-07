import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveTimezoneOffset } from '@/components/timezone-selector/fetchers'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { formatDateTime } from '@/lib/utils'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowStore } from '@/stores/workflows/workflow/store-client'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import {
  emitScheduleUpdated,
  subscribeScheduleUpdated,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus'
import {
  useWorkflowChannelId,
  useWorkflowId,
} from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ScheduleConfig')

interface ScheduleConfigProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  disabled?: boolean
}

export function ScheduleConfig({
  blockId,
  subBlockId: _subBlockId,
  isConnecting,
  disabled = false,
}: ScheduleConfigProps) {
  const [error, setError] = useState<string | null>(null)
  const [scheduleData, setScheduleData] = useState<{
    id: string | null
    nextRunAt: string | null
    lastRanAt: string | null
    cronExpression: string | null
    timezone: string
  }>({
    id: null,
    nextRunAt: null,
    lastRanAt: null,
    cronExpression: null,
    timezone: 'UTC',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [resolvedUtcOffset, setResolvedUtcOffset] = useState<string | null>(null)

  const workflowId = useWorkflowId()
  const channelId = useWorkflowChannelId()

  // Get workflow state from store

  // Get schedule fields from the block state
  const [scheduleType, setScheduleType] = useSubBlockValue(blockId, 'scheduleType')
  const [minutesInterval, setMinutesInterval] = useSubBlockValue(blockId, 'minutesInterval')
  const [hourlyMinute, setHourlyMinute] = useSubBlockValue(blockId, 'hourlyMinute')
  const [dailyTime, setDailyTime] = useSubBlockValue(blockId, 'dailyTime')
  const [weeklyDay, setWeeklyDay] = useSubBlockValue(blockId, 'weeklyDay')
  const [weeklyDayTime, setWeeklyDayTime] = useSubBlockValue(blockId, 'weeklyDayTime')
  const [monthlyDay, setMonthlyDay] = useSubBlockValue(blockId, 'monthlyDay')
  const [monthlyTime, setMonthlyTime] = useSubBlockValue(blockId, 'monthlyTime')
  const [cronExpression, setCronExpression] = useSubBlockValue(blockId, 'cronExpression')
  const [, setTimezone] = useSubBlockValue(blockId, 'timezone')

  // Fetch schedule data from API
  const fetchSchedule = useCallback(async () => {
    if (!workflowId) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        workflowId,
        mode: 'schedule',
      })
      params.set('blockId', blockId)

      const response = await fetch(`/api/schedules?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (response.ok) {
        const data = await response.json()
        if (data.schedule) {
          setScheduleData({
            id: data.schedule.id,
            nextRunAt: data.schedule.nextRunAt,
            lastRanAt: data.schedule.lastRanAt,
            cronExpression: data.schedule.cronExpression,
            timezone: data.schedule.timezone || 'UTC',
          })
        } else {
          setScheduleData({
            id: null,
            nextRunAt: null,
            lastRanAt: null,
            cronExpression: null,
            timezone: 'UTC',
          })
        }
      }
    } catch (error) {
      logger.error('Error fetching schedule:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workflowId, blockId])

  // Fetch schedule data on mount and when dependencies change
  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  useEffect(() => {
    const timezoneValue = scheduleData.timezone || 'UTC'
    let active = true

    resolveTimezoneOffset(timezoneValue)
      .then((offset) => {
        if (!active) return
        setResolvedUtcOffset(offset)
      })
      .catch((error) => {
        logger.error('Failed to resolve timezone offset', error)
        if (!active) return
        setResolvedUtcOffset(null)
      })

    return () => {
      active = false
    }
  }, [scheduleData.timezone])

  // Separate effect for event listener to avoid removing/re-adding on every dependency change
  useEffect(() => {
    const unsubscribeScheduleUpdated = subscribeScheduleUpdated(
      { channelId, workflowId },
      ({ workflowId: updatedWorkflowId, blockId: updatedBlockId }) => {
        if (updatedWorkflowId === workflowId && updatedBlockId === blockId) {
          logger.debug('Schedule update event received in schedule-config, refetching')
          fetchSchedule()
        }
      }
    )

    return () => {
      unsubscribeScheduleUpdated()
    }
  }, [channelId, workflowId, blockId, fetchSchedule])

  // Format the schedule information for display
  const getScheduleInfo = () => {
    if (!scheduleData.id || !scheduleData.nextRunAt) return null

    let scheduleTiming = 'Unknown schedule'

    if (scheduleData.cronExpression) {
      scheduleTiming = parseCronToHumanReadable(scheduleData.cronExpression, scheduleData.timezone)
    } else if (scheduleType) {
      scheduleTiming = `${scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}`
    }

    return (
      <>
        <div className='truncate font-normal text-sm'>{scheduleTiming}</div>
        <div className='text-muted-foreground text-xs'>
          <div>
            Next run:{' '}
            {formatDateTime(new Date(scheduleData.nextRunAt), resolvedUtcOffset ?? undefined)}
          </div>
          {scheduleData.lastRanAt && (
            <div>
              Last run:{' '}
              {formatDateTime(new Date(scheduleData.lastRanAt), resolvedUtcOffset ?? undefined)}
            </div>
          )}
        </div>
      </>
    )
  }

  const scheduleValues = useMemo(
    () => ({
      scheduleType: (scheduleType as string | null) || 'daily',
      minutesInterval,
      hourlyMinute,
      dailyTime,
      weeklyDay,
      weeklyDayTime,
      monthlyDay,
      monthlyTime,
      cronExpression,
    }),
    [
      scheduleType,
      minutesInterval,
      hourlyMinute,
      dailyTime,
      weeklyDay,
      weeklyDayTime,
      monthlyDay,
      monthlyTime,
      cronExpression,
    ]
  )

  const validateScheduleValues = () => {
    switch (scheduleValues.scheduleType) {
      case 'minutes':
        return !!scheduleValues.minutesInterval
      case 'hourly':
        return scheduleValues.hourlyMinute !== null && scheduleValues.hourlyMinute !== undefined
      case 'daily':
        return !!scheduleValues.dailyTime
      case 'weekly':
        return !!scheduleValues.weeklyDay && !!scheduleValues.weeklyDayTime
      case 'monthly':
        return !!scheduleValues.monthlyDay && !!scheduleValues.monthlyTime
      case 'custom':
        return !!scheduleValues.cronExpression
      default:
        return false
    }
  }

  const handleSaveSchedule = useCallback(async (): Promise<boolean> => {
    if (disabled) return false

    setIsSaving(true)
    setError(null)

    try {
      if (!validateScheduleValues()) {
        setError('Please complete the required schedule fields before saving.')
        return false
      }

      // Get the fully merged current state with updated values
      // This ensures we send the complete, correct workflow state to the backend
      const currentWorkflowWithValues = getWorkflowWithValues(workflowId, channelId)
      if (!currentWorkflowWithValues) {
        setError('Failed to get current workflow state')
        return false
      }

      // 4. Make a direct API call instead of relying on sync
      // This gives us more control and better error handling
      logger.debug('Making direct API call to save schedule with complete state')

      // Prepare the request body
      const requestBody: any = {
        workflowId,
        state: currentWorkflowWithValues.state,
      }

      requestBody.blockId = blockId

      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      // Parse the response
      const responseText = await response.text()
      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (e) {
        logger.error('Failed to parse response JSON', e, responseText)
        responseData = {}
      }

      if (!response.ok) {
        setError(responseData.error || 'Failed to save schedule')
        return false
      }

      logger.debug('Schedule save response:', responseData)

      // 5. Update our local state with the response data
      if (responseData.cronExpression || responseData.nextRunAt) {
        setScheduleData((prev) => ({
          ...prev,
          cronExpression: responseData.cronExpression || prev.cronExpression,
          nextRunAt:
            typeof responseData.nextRunAt === 'string'
              ? responseData.nextRunAt
              : responseData.nextRunAt?.toISOString?.() || prev.nextRunAt,
        }))
      }

      // 6. Dispatch custom event to notify parent workflow-block component to refetch schedule info
      // This ensures the badge updates immediately after saving
      emitScheduleUpdated({ channelId, workflowId, blockId })
      logger.debug('Published schedule update', { channelId, workflowId, blockId })

      // 6. Update the schedule status and trigger a workflow update
      // Note: Global schedule status is managed at a higher level

      // 7. Tell the workflow store that the state has been saved
      const workflowStore = useWorkflowStore.getState(channelId)
      workflowStore.updateLastSaved()
      workflowStore.triggerUpdate()

      // 8. Refetch the schedule to update local state
      await fetchSchedule()

      return true
    } catch (error) {
      logger.error('Error saving schedule:', { error })
      setError('Failed to save schedule')
      return false
    } finally {
      setIsSaving(false)
    }
  }, [workflowId, blockId, fetchSchedule, channelId, validateScheduleValues, disabled])

  const handleDeleteSchedule = useCallback(async (): Promise<boolean> => {
    if (!scheduleData.id || disabled) return false

    setIsDeleting(true)
    try {
      // Make the DELETE API call to remove the schedule
      const response = await fetch(`/api/schedules/${scheduleData.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete schedule')
        return false
      }

      // Clear schedule state
      setScheduleData({
        id: null,
        nextRunAt: null,
        lastRanAt: null,
        cronExpression: null,
        timezone: 'UTC',
      })
      setScheduleType('daily')
      setMinutesInterval('')
      setHourlyMinute('')
      setDailyTime('')
      setWeeklyDay('')
      setWeeklyDayTime('')
      setMonthlyDay('')
      setMonthlyTime('')
      setCronExpression('')
      setTimezone('UTC')
      setError(null)

      // Dispatch custom event to notify parent workflow-block component
      emitScheduleUpdated({ channelId, workflowId, blockId })
      logger.debug('Published schedule update after delete', { channelId, workflowId, blockId })

      return true
    } catch (error) {
      logger.error('Error deleting schedule:', { error })
      setError('Failed to delete schedule')
      return false
    } finally {
      setIsDeleting(false)
    }
  }, [
    scheduleData.id,
    disabled,
    workflowId,
    channelId,
    blockId,
    setCronExpression,
    setDailyTime,
    setHourlyMinute,
    setMinutesInterval,
    setMonthlyDay,
    setMonthlyTime,
    setScheduleType,
    setTimezone,
    setWeeklyDay,
    setWeeklyDayTime,
  ])

  // Check if the schedule is active
  const isScheduleActive = !!scheduleData.id && !!scheduleData.nextRunAt

  return (
    <div className='w-full' onClick={(e) => e.stopPropagation()}>
      {error && <div className='mb-2 text-red-500 text-sm dark:text-red-400'>{error}</div>}

      {isScheduleActive && (
        <div className='rounded border border-border bg-background px-3 py-2'>
          {getScheduleInfo()}
        </div>
      )}

      <div className='mt-2 flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='default'
          className='flex-1'
          onClick={handleSaveSchedule}
          disabled={isConnecting || isSaving || isDeleting || disabled || isLoading}
        >
          {isSaving ? 'Saving...' : isScheduleActive ? 'Update Schedule' : 'Save Schedule'}
        </Button>

        {scheduleData.id && (
          <Button
            type='button'
            variant='outline'
            onClick={handleDeleteSchedule}
            disabled={isConnecting || isSaving || isDeleting || disabled}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        )}
      </div>
    </div>
  )
}
