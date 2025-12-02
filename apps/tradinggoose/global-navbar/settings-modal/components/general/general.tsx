'use client'

import { useEffect } from 'react'
import { Info, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getEnv, isTruthy } from '@/lib/env'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { useGeneralStore } from '@/stores/settings/general/store'

const TOOLTIPS = {
  autoConnect: 'Automatically connect nodes.',
  autoPan: 'Automatically pan to active blocks during workflow execution.',
  consoleExpandedByDefault:
    'Show console entries expanded by default. When disabled, entries will be collapsed by default.',
  floatingControls:
    'Show floating controls for zoom, undo, and redo at the bottom of the workflow canvas.',
  trainingControls:
    'Show training controls for recording workflow edits to build copilot training datasets.',
  telemetry:
    'We collect anonymous data about feature usage, performance, and errors to improve the application.',
}

const THEME_OPTIONS = [
  { value: 'light' as const, label: 'Light', Icon: Sun },
  { value: 'system' as const, label: 'System', Icon: Monitor },
  { value: 'dark' as const, label: 'Dark', Icon: Moon },
]

const THEME_ITEM_BASE_CLASSES =
  'relative flex h-9 w-9 flex-1 items-center justify-center gap-0 rounded-md border px-0 py-0 text-sm transition-colors focus:bg-accent focus:text-accent-foreground'
const THEME_ITEM_ACTIVE_CLASSES = 'border-border bg-accent text-accent-foreground shadow-sm'
const THEME_ITEM_INACTIVE_CLASSES =
  'border-transparent text-muted-foreground hover:bg-card hover:text-foreground'

export function General() {
  const { isPending: isSettingsPending } = useGeneralSettings()
  const storeIsLoading = useGeneralStore((state) => state.isLoading)
  const isTrainingEnabled = isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED'))
  const theme = useGeneralStore((state) => state.theme)
  const isAutoConnectEnabled = useGeneralStore((state) => state.isAutoConnectEnabled)

  const isAutoPanEnabled = useGeneralStore((state) => state.isAutoPanEnabled)
  const isConsoleExpandedByDefault = useGeneralStore((state) => state.isConsoleExpandedByDefault)
  const showFloatingControls = useGeneralStore((state) => state.showFloatingControls)
  const showTrainingControls = useGeneralStore((state) => state.showTrainingControls)
  const telemetryEnabled = useGeneralStore((state) => state.telemetryEnabled)

  // Loading states
  const isAutoConnectLoading = useGeneralStore((state) => state.isAutoConnectLoading)

  const isAutoPanLoading = useGeneralStore((state) => state.isAutoPanLoading)
  const isConsoleExpandedByDefaultLoading = useGeneralStore(
    (state) => state.isConsoleExpandedByDefaultLoading
  )
  const isThemeLoading = useGeneralStore((state) => state.isThemeLoading)
  const isFloatingControlsLoading = useGeneralStore((state) => state.isFloatingControlsLoading)
  const isTrainingControlsLoading = useGeneralStore((state) => state.isTrainingControlsLoading)
  const isTelemetryLoading = useGeneralStore((state) => state.isTelemetryLoading)

  const setTheme = useGeneralStore((state) => state.setTheme)
  const toggleAutoConnect = useGeneralStore((state) => state.toggleAutoConnect)

  const toggleAutoPan = useGeneralStore((state) => state.toggleAutoPan)
  const toggleConsoleExpandedByDefault = useGeneralStore(
    (state) => state.toggleConsoleExpandedByDefault
  )
  const toggleFloatingControls = useGeneralStore((state) => state.toggleFloatingControls)
  const toggleTrainingControls = useGeneralStore((state) => state.toggleTrainingControls)
  const setTelemetryEnabled = useGeneralStore((state) => state.setTelemetryEnabled)

  const isLoading = isSettingsPending || storeIsLoading

  // Sync theme from store to next-themes when theme changes
  useEffect(() => {
    if (!isLoading && theme) {
      // Ensure next-themes is in sync with our store
      const { syncThemeToNextThemes } = require('@/lib/theme-sync')
      syncThemeToNextThemes(theme)
    }
  }, [theme, isLoading])

  const handleThemeChange = async (value: 'system' | 'light' | 'dark') => {
    await setTheme(value)
  }

  const handleAutoConnectChange = async (checked: boolean) => {
    if (checked !== isAutoConnectEnabled && !isAutoConnectLoading) {
      await toggleAutoConnect()
    }
  }

  const handleAutoPanChange = async (checked: boolean) => {
    if (checked !== isAutoPanEnabled && !isAutoPanLoading) {
      await toggleAutoPan()
    }
  }

  const handleConsoleExpandedByDefaultChange = async (checked: boolean) => {
    if (checked !== isConsoleExpandedByDefault && !isConsoleExpandedByDefaultLoading) {
      await toggleConsoleExpandedByDefault()
    }
  }

  const handleFloatingControlsChange = async (checked: boolean) => {
    if (checked !== showFloatingControls && !isFloatingControlsLoading) {
      await toggleFloatingControls()
    }
  }

  const handleTrainingControlsChange = async (checked: boolean) => {
    if (checked !== showTrainingControls && !isTrainingControlsLoading) {
      await toggleTrainingControls()
    }
  }

  const handleTelemetryToggle = (checked: boolean) => {
    if (checked === telemetryEnabled || isTelemetryLoading) {
      return
    }

    void setTelemetryEnabled(checked)

    if (checked && typeof window !== 'undefined') {
      fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'consent',
          action: 'enable_from_settings',
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {
        // Silently fail - this is just telemetry
      })
    }
  }

  return (
    <TooltipProvider>
      <div className='px-6 pt-4 pb-2'>
        <div className='flex flex-col gap-4'>
          {isLoading ? (
            <>
              {/* Theme setting with skeleton value */}
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='theme-select' className='font-normal'>
                    Theme
                  </Label>
                </div>
                <Skeleton className='h-9 w-[180px]' />
              </div>

              {/* Auto-connect setting with skeleton value */}
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='auto-connect' className='font-normal'>
                    Auto-connect on drop
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 p-1 text-gray-500'
                        aria-label='Learn more about auto-connect feature'
                        disabled={true}
                      >
                        <Info className='h-5 w-5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.autoConnect}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Skeleton className='h-6 w-11 rounded-full' />
              </div>

              {/* Console expanded setting with skeleton value */}
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='console-expanded-by-default' className='font-normal'>
                    Console expanded by default
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 p-1 text-gray-500'
                        aria-label='Learn more about console expanded by default'
                        disabled={true}
                      >
                        <Info className='h-5 w-5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.consoleExpandedByDefault}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Skeleton className='h-6 w-11 rounded-full' />
              </div>

              {/* Telemetry setting with skeleton value */}
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-5 w-32' />
                  <Skeleton className='h-7 w-7 rounded' />
                </div>
                <Skeleton className='h-6 w-11 rounded-full' />
              </div>

              <div className='border-t pt-4'>
                <p className='text-muted-foreground text-xs'>
                  We use OpenTelemetry to collect anonymous usage data to improve Sim. All data is
                  collected in accordance with our privacy policy, and you can opt-out at any time.
                  This setting applies to your account on all devices.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='theme-select' className='font-normal'>
                    Theme
                  </Label>
                </div>
                <div className='flex items-center gap-1.5 px-2 pb-1.5 pt-0.5'>
                  {THEME_OPTIONS.map(({ value, label, Icon }) => {
                    const isActive = theme === value
                    const themeClasses = `${THEME_ITEM_BASE_CLASSES} ${isActive ? THEME_ITEM_ACTIVE_CLASSES : THEME_ITEM_INACTIVE_CLASSES}`
                    return (
                      <button
                        key={value}
                        type='button'
                        aria-label={`${label} theme`}
                        className={themeClasses}
                        disabled={isThemeLoading || isLoading}
                        onClick={() => {
                          if (!isActive) {
                            void handleThemeChange(value)
                          }
                        }}
                        title={label}
                      >
                        <Icon className='size-4' />
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='auto-connect' className='font-normal'>
                    Auto-connect on drop
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 p-1 text-gray-500'
                        aria-label='Learn more about auto-connect feature'
                        disabled={isLoading || isAutoConnectLoading}
                      >
                        <Info className='h-5 w-5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.autoConnect}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='auto-connect'
                  checked={isAutoConnectEnabled}
                  onCheckedChange={handleAutoConnectChange}
                  disabled={isLoading || isAutoConnectLoading}
                />
              </div>

              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='console-expanded-by-default' className='font-normal'>
                    Console expanded by default
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 p-1 text-gray-500'
                        aria-label='Learn more about console expanded by default'
                        disabled={isLoading || isConsoleExpandedByDefaultLoading}
                      >
                        <Info className='h-5 w-5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.consoleExpandedByDefault}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='console-expanded-by-default'
                  checked={isConsoleExpandedByDefault}
                  onCheckedChange={handleConsoleExpandedByDefaultChange}
                  disabled={isLoading || isConsoleExpandedByDefaultLoading}
                />
              </div>

              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='floating-controls' className='font-normal'>
                    Floating controls
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 p-1 text-gray-500'
                        aria-label='Learn more about floating controls'
                        disabled={isLoading || isFloatingControlsLoading}
                      >
                        <Info className='h-5 w-5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[300px] p-3'>
                      <p className='text-sm'>{TOOLTIPS.floatingControls}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='floating-controls'
                  checked={showFloatingControls}
                  onCheckedChange={handleFloatingControlsChange}
                  disabled={isLoading || isFloatingControlsLoading}
                />
              </div>

              {isTrainingEnabled && (
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Label htmlFor='training-controls' className='font-normal'>
                      Training controls
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-5 w-5 p-0'
                          aria-label='Learn more about training controls'
                          disabled={isLoading || isTrainingControlsLoading}
                        >
                          <Info className='h-3.5 w-3.5 text-muted-foreground' />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side='top' className='max-w-[300px] p-3'>
                        <p className='text-sm'>{TOOLTIPS.trainingControls}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id='training-controls'
                    checked={showTrainingControls}
                    onCheckedChange={handleTrainingControlsChange}
                    disabled={isLoading || isTrainingControlsLoading}
                  />
                </div>
              )}

              <div className='flex flex-col gap-2 border-t pt-4'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Label htmlFor='telemetry' className='font-normal'>
                      Allow anonymous telemetry
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 p-1 text-gray-500'
                          aria-label='Learn more about telemetry data collection'
                          disabled={isLoading || isTelemetryLoading}
                        >
                          <Info className='h-5 w-5' />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side='top' className='max-w-[300px] p-3'>
                        <p className='text-sm'>{TOOLTIPS.telemetry}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id='telemetry'
                    checked={telemetryEnabled}
                    onCheckedChange={handleTelemetryToggle}
                    disabled={isLoading || isTelemetryLoading}
                  />
                </div>

                <p className='text-muted-foreground text-xs'>
                  We use OpenTelemetry to collect anonymous usage data to improve Sim. All data is
                  collected in accordance with our privacy policy, and you can opt-out at any time.
                  This setting applies to your account on all devices.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
