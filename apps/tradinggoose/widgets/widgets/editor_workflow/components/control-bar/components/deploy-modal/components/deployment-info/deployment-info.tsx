'use client'

import { Skeleton } from '@/components/ui'
import {
  ApiEndpoint,
  ApiKey,
  ExampleCommand,
} from '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/deployment-info/components'

interface WorkflowDeploymentInfo {
  apiKey: string
  endpoint: string
  exampleCommand: string
}

interface DeploymentInfoProps {
  isLoading: boolean
  deploymentInfo: WorkflowDeploymentInfo | null
  workflowId: string | null
  getInputFormatExample?: (includeStreaming?: boolean) => string
  selectedStreamingOutputs: string[]
  onSelectedStreamingOutputsChange: (outputs: string[]) => void
  showApiKeyInfo?: boolean
  showApiAccessInfo?: boolean
}

export function DeploymentInfo({
  isLoading,
  deploymentInfo,
  workflowId,
  getInputFormatExample,
  selectedStreamingOutputs,
  onSelectedStreamingOutputsChange,
  showApiKeyInfo = true,
  showApiAccessInfo = true,
}: DeploymentInfoProps) {
  if (isLoading || !deploymentInfo) {
    return (
      <div className='space-y-4 overflow-y-auto px-1'>
        {showApiKeyInfo && (
          <div className='space-y-3'>
            <Skeleton className='h-5 w-20' />
            <Skeleton className='h-10 w-full' />
          </div>
        )}

        {showApiAccessInfo && (
          <>
            <div className='space-y-3'>
              <Skeleton className='h-5 w-28' />
              <Skeleton className='h-10 w-full' />
            </div>

            <div className='space-y-3'>
              <Skeleton className='h-5 w-36' />
              <Skeleton className='h-24 w-full rounded-md' />
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className='space-y-4 overflow-y-auto px-1'>
      <div className='space-y-4'>
        {showApiKeyInfo && <ApiKey apiKey={deploymentInfo.apiKey} />}
        {showApiAccessInfo ? (
          <>
            <ApiEndpoint endpoint={deploymentInfo.endpoint} />
            <ExampleCommand
              command={deploymentInfo.exampleCommand}
              apiKey={deploymentInfo.apiKey}
              endpoint={deploymentInfo.endpoint}
              getInputFormatExample={getInputFormatExample}
              workflowId={workflowId}
              selectedStreamingOutputs={selectedStreamingOutputs}
              onSelectedStreamingOutputsChange={onSelectedStreamingOutputsChange}
            />
          </>
        ) : (
          <div className='rounded-md border p-3 text-muted-foreground text-sm'>
            The shared deployment API key is used for workflow deployment, billing attribution, and
            API trigger authentication.
          </div>
        )}
      </div>
    </div>
  )
}
