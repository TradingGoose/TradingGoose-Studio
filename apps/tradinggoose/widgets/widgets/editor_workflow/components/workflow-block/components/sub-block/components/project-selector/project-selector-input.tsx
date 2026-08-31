'use client'

import { useLocale } from 'next-intl'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { JiraProjectSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/project-selector/components/jira-project-selector'
import { LinearProjectSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/project-selector/components/linear-project-selector'
import { LinearTeamSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/project-selector/components/linear-team-selector'
import { useDependsOnGate } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface ProjectSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
}

export function ProjectSelectorInput({
  blockId,
  subBlock,
  disabled = false,
}: ProjectSelectorInputProps) {
  const locale = useLocale() as LocaleCode
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [connectedCredential] = useSubBlockValue(blockId, 'credential')
  const selectedProjectId = typeof storeValue === 'string' ? storeValue : ''
  const { isForeignCredential } = useForeignCredential(
    subBlock.provider || subBlock.serviceId || 'jira',
    (connectedCredential as string) || ''
  )
  const [linearTeamId] = useSubBlockValue(blockId, 'teamId')
  const { workflowId, workspaceId } = useWorkflowRoute()
  const { finalDisabled } = useDependsOnGate(blockId, subBlock, { disabled })

  // Get provider-specific values
  const provider = subBlock.provider || 'jira'
  const isLinear = provider === 'linear'

  // Jira/Discord upstream fields
  const [jiraDomain] = useSubBlockValue(blockId, 'domain')
  const domain = (jiraDomain as string) || ''

  // Discord no longer uses a server selector; fall through to other providers

  // Render Linear team/project selector if provider is linear
  if (isLinear) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <div className='w-full'>
                {subBlock.id === 'teamId' ? (
                  <LinearTeamSelector
                    value={selectedProjectId}
                    onChange={setStoreValue}
                    credential={(connectedCredential as string) || ''}
                    label={
                      subBlock.placeholder || translateWorkflowLabel(locale, 'selectLinearTeam')
                    }
                    disabled={finalDisabled}
                    showPreview={true}
                    workflowId={workflowId || ''}
                  />
                ) : (
                  (() => {
                    const credential = (connectedCredential as string) || ''
                    const teamId = (linearTeamId as string) || ''
                    const isDisabled = finalDisabled
                    return (
                      <LinearProjectSelector
                        value={selectedProjectId}
                        onChange={setStoreValue}
                        credential={credential}
                        teamId={teamId}
                        label={
                          subBlock.placeholder ||
                          translateWorkflowLabel(locale, 'selectLinearProject')
                        }
                        disabled={isDisabled}
                        workflowId={workflowId || ''}
                      />
                    )
                  })()
                )}
              </div>
            }
          />
          {!(connectedCredential as string) && (
            <TooltipContent side='top'>
              <p>{translateWorkflowLabel(locale, 'pleaseSelectALinearAccountFirst')}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Default to Jira project selector
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <div className='w-full'>
              <JiraProjectSelector
                value={selectedProjectId}
                onChange={setStoreValue}
                domain={domain}
                provider='jira'
                label={subBlock.placeholder || translateWorkflowLabel(locale, 'selectJiraProject')}
                disabled={finalDisabled}
                showPreview={true}
                credentialId={(connectedCredential as string) || ''}
                isForeignCredential={isForeignCredential}
                workflowId={workflowId || ''}
                workspaceId={workspaceId}
              />
            </div>
          }
        />
      </Tooltip>
    </TooltipProvider>
  )
}
