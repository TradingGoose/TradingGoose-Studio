'use client'

import { useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowJsonStore } from '@/stores/workflows/json/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ExportControls')

type ControlVariant = 'workspace' | 'widget'

interface ExportControlsProps {
  disabled?: boolean
  variant?: ControlVariant
}

export function ExportControls({ disabled = false, variant = 'workspace' }: ExportControlsProps) {
  const [isExporting, setIsExporting] = useState(false)
  const { workflows } = useWorkflowRegistry()
  const { workflowId, channelId } = useWorkflowRoute()
  const { getJson } = useWorkflowJsonStore()

  const currentWorkflow = workflowId ? workflows[workflowId] : null

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    try {
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Failed to download file:', error)
    }
  }

  const handleExportJson = async () => {
    if (!currentWorkflow || !workflowId) {
      logger.warn('No active workflow to export')
      return
    }

    setIsExporting(true)
    try {
      // Get the JSON from the store
      const jsonContent = await getJson({ workflowId, channelId })

      if (!jsonContent) {
        throw new Error('Failed to generate JSON')
      }

      const filename = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.json`
      downloadFile(jsonContent, filename, 'application/json')
      logger.info('Workflow exported as JSON')
    } catch (error) {
      logger.error('Failed to export workflow as JSON:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const isDisabled = disabled || isExporting || !workflowId || !currentWorkflow

  const getTooltipText = () => {
    if (disabled) return 'Export not available'
    if (!currentWorkflow) return 'No workflow to export'
    if (isExporting) return 'Exporting...'
    return 'Export workflow as JSON'
  }

  const buttonClass =
    variant === 'widget'
      ? widgetHeaderIconButtonClassName()
      : 'h-12 w-12 rounded-md border bg-card text-card-foreground shadow-xs hover:bg-secondary'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='outline'
          onClick={handleExportJson}
          disabled={isDisabled}
          className={buttonClass}
        >
          <ArrowDownToLine className='h-5 w-5' />
          <span className='sr-only'>Export</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{getTooltipText()}</TooltipContent>
    </Tooltip>
  )
}
