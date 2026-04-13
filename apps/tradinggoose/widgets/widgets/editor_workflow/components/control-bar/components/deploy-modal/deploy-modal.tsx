'use client'

import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react'
import { Check, ChevronDown, CreditCard, History, Loader2, MoreVertical, PanelLeft, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type ChatAuthType,
  getChatDeploymentDraftFromBlock,
  isChatDeploymentDraftConfigured,
} from '@/lib/chat/deployment-config'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getIconTileStyle, sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/db-helpers'
import { useWorkflowBlocks } from '@/lib/yjs/use-workflow-doc'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { getTrigger, isNativeTrigger } from '@/triggers'
import { isConfigurableTriggerDeploySubBlock } from '@/triggers/constants'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'
import {
  DeployForm,
  DeploymentInfo,
} from '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components'
import { ChatDeploy } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/chat-deploy/chat-deploy'
import { DeployStatus } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/deployment-info/components'
import { DeployedWorkflowModal } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deployment-controls/components/deployed-workflow-modal'
import { SubBlock } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/sub-block'
import {
  buildTriggerEditingLayout,
  getTriggerAwareSubBlockStableKey,
  removeTriggerModeSelectorFromRows,
} from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/trigger-editing-layout'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('DeployModal')

interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string | null
  needsRedeployment: boolean
  setNeedsRedeployment: (value: boolean) => void
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
  refetchDeployedState: () => Promise<void>
}

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
}

interface WorkflowDeploymentInfo {
  isDeployed: boolean
  deployedAt?: string
  apiKey: string
  pinnedApiKeyId?: string | null
  endpoint: string
  exampleCommand: string
  needsRedeployment: boolean
  hasReusableApiKey: boolean
  asyncExecutionEnabled: boolean
}

interface DeployFormValues {
  apiKey: string
  newKeyName?: string
}

interface PublishedChatDeployment {
  id: string
  identifier: string
  title: string
  description: string
  authType: ChatAuthType
  allowedEmails: string[]
  outputConfigs: Array<{ blockId: string; path: string }>
  customizations?: {
    welcomeMessage?: string
    imageUrl?: string
  }
  hasPassword?: boolean
  isActive: boolean
  chatUrl?: string
}

type TabView = string

const BILLING_TAB_KEY = 'billing'
const API_TRIGGER_TAB_KEY = 'api-trigger'

interface TriggerDeployTab {
  key: string
  blockId: string
  label: string
  triggerId: string
  icon: ComponentType<{ className?: string }> | undefined
  iconAccentColor: string | undefined
  regularRows: SubBlockConfig[][]
  advancedRows: SubBlockConfig[][]
  stateToUse: Record<string, any>
  displayAdvancedOptions: boolean
  hasAdvancedOnlyFields: boolean
  hasConfigurableFields: boolean
}

interface TriggerDeployValidationState {
  key: string
  missingRequiredFieldLabels: string[]
  requiresSavedConfig: boolean
  webhookIdValue: unknown
  hasUnsavedDeployConfig: boolean
}

interface DeployableTriggerState {
  key: string
  isConfigured: boolean
}

interface TriggerTabItem {
  key: string
  label: string
  icon: ComponentType<{ className?: string }> | undefined
  iconAccentColor: string | undefined
  isReady?: boolean
}

const NON_DEPLOYABLE_TRIGGER_IDS = new Set(['manual'])
const deployNavGroupLabelClass =
  'flex h-8 shrink-0 items-center rounded-md px-1 font-medium text-sidebar-foreground/70 text-xs'
const deployNavButtonClass =
  'flex h-8 w-full items-center gap-2 overflow-hidden rounded-md bg-background px-2 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-secondary/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground'
const deployInlineNavButtonClass =
  'inline-flex h-8 items-center rounded-md bg-background px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-secondary/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground'

function isMissingConfigValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim() === ''
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  return false
}

function getSavedTriggerConfigValue(savedConfig: unknown, subBlockId: string): unknown {
  if (!savedConfig || typeof savedConfig !== 'object' || Array.isArray(savedConfig)) {
    return undefined
  }
  return (savedConfig as Record<string, unknown>)[subBlockId]
}

function areConfigValuesEqual(currentValue: unknown, savedValue: unknown): boolean {
  if (isMissingConfigValue(currentValue) && isMissingConfigValue(savedValue)) {
    return true
  }

  try {
    return JSON.stringify(currentValue) === JSON.stringify(savedValue)
  } catch {
    return currentValue === savedValue
  }
}

function isDeployableTriggerId(triggerId: string): boolean {
  return !NON_DEPLOYABLE_TRIGGER_IDS.has(triggerId)
}

function isTriggerDeployTabConfigured(tabState: TriggerDeployValidationState): boolean {
  return (
    tabState.missingRequiredFieldLabels.length === 0 &&
    (!tabState.requiresSavedConfig || !isMissingConfigValue(tabState.webhookIdValue)) &&
    !tabState.hasUnsavedDeployConfig
  )
}

export function DeployModal({
  open,
  onOpenChange,
  workflowId,
  needsRedeployment,
  setNeedsRedeployment,
  deployedState,
  isLoadingDeployedState,
  refetchDeployedState,
}: DeployModalProps) {
  const workspaceId = useWorkspaceId()
  const userPermissions = useUserPermissionsContext()
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(workflowId)
  )
  const setDeploymentStatus = useWorkflowRegistry((state) => state.setDeploymentStatus)
  const currentBlocks = useWorkflowBlocks()
  const { collaborativeToggleBlockAdvancedMode } = useWorkflowEditorActions()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUndeploying, setIsUndeploying] = useState(false)
  const [deploymentInfo, setDeploymentInfo] = useState<WorkflowDeploymentInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [activeTab, setActiveTab] = useState<TabView>('versions')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<string>('')
  const [apiDeployError, setApiDeployError] = useState<string | null>(null)
  const [publishedChat, setPublishedChat] = useState<PublishedChatDeployment | null>(null)
  const [isChatConfigBusy, setIsChatConfigBusy] = useState(false)
  const [selectedStreamingOutputs, setSelectedStreamingOutputs] = useState<string[]>([])
  const [isViewingActiveDeployment, setIsViewingActiveDeployment] = useState(false)
  const [showUndeployConfirm, setShowUndeployConfirm] = useState(false)

  const [versions, setVersions] = useState<WorkflowDeploymentVersionResponse[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const activatingVersion: number | null = null
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [previewDeployedState, setPreviewDeployedState] = useState<WorkflowState | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [versionToActivate, setVersionToActivate] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRootId = workflowId ? `workflow-editor-overlay-root-${workflowId}` : null
  const overlayContainer =
    open && overlayRootId && typeof document !== 'undefined'
      ? document.getElementById(overlayRootId)
      : null
  const isWorkflowDeployed =
    Boolean(deploymentStatus?.isDeployed) ||
    Boolean(deploymentInfo?.isDeployed) ||
    Boolean(deployedState)
  const mergedBlocks = workflowId ? mergeSubblockState(currentBlocks, workflowId) : currentBlocks
  const blockList = Object.values(mergedBlocks)
  const shouldDisableTriggerWrite = !userPermissions.canEdit
  const hasApiTrigger = blockList.some((block) => block.type === 'api_trigger')
  const hasInputTrigger = blockList.some((block) => block.type === 'input_trigger')
  const hasIndicatorTrigger = blockList.some((block) => block.type === 'indicator_trigger')
  const chatTriggerBlock =
    blockList.find((block) => resolveTriggerIdForBlock(block) === 'chat') ?? null
  const hasChatTrigger = Boolean(chatTriggerBlock)
  const hasApiTriggerTab = hasApiTrigger
  const triggerDeployTabs: TriggerDeployTab[] = blockList
    .map((block) => {
      const blockConfig = getBlock(block.type)
      const triggerId = resolveTriggerIdForBlock(block)
      const triggerDef = triggerId ? getTrigger(triggerId) : null
      if (!triggerId) {
        return null
      }
      if (triggerId === 'chat' || triggerId === 'api' || !isDeployableTriggerId(triggerId)) {
        return null
      }

      const triggerEditingLayout = buildTriggerEditingLayout({
        blockConfig,
        blockState: block,
        shouldDisableWrite: shouldDisableTriggerWrite,
      })
      const regularRows = removeTriggerModeSelectorFromRows(triggerEditingLayout.regularRows)
      const advancedRows = removeTriggerModeSelectorFromRows(triggerEditingLayout.advancedRows)
      const allSubBlocks = [
        ...regularRows.flat(),
        ...advancedRows.flat(),
      ]
      const hasConfigurableFields = allSubBlocks.some(isConfigurableTriggerDeploySubBlock)

      return {
        key: `trigger-${block.id}`,
        blockId: block.id,
        label: block.name || blockConfig?.name || triggerDef?.name || triggerId,
        triggerId,
        icon:
          triggerDef?.icon ??
          (blockConfig?.icon as ComponentType<{ className?: string }> | undefined),
        iconAccentColor: sanitizeSolidIconColor(blockConfig?.bgColor),
        regularRows,
        advancedRows,
        stateToUse: triggerEditingLayout.stateToUse,
        displayAdvancedOptions: triggerEditingLayout.displayAdvancedOptions,
        hasAdvancedOnlyFields: triggerEditingLayout.hasAdvancedOnlyFields,
        hasConfigurableFields,
      }
    })
    .filter((tab): tab is TriggerDeployTab => tab !== null)

  const hasNonChatDeployPath =
    hasApiTrigger || hasInputTrigger || hasIndicatorTrigger || triggerDeployTabs.length > 0
  const requiresApiKeyForDeployment = hasNonChatDeployPath || hasChatTrigger
  const showBillingTab = requiresApiKeyForDeployment
  const hasSelectedSharedApiKey = Boolean(
    selectedApiKeyId || deploymentInfo?.pinnedApiKeyId || deploymentInfo?.hasReusableApiKey
  )
  const fallbackTab: TabView = hasApiTriggerTab
    ? !isWorkflowDeployed && !hasSelectedSharedApiKey
      ? BILLING_TAB_KEY
      : API_TRIGGER_TAB_KEY
    : showBillingTab
      ? BILLING_TAB_KEY
      : triggerDeployTabs[0]?.key
        ? triggerDeployTabs[0].key
        : hasChatTrigger
          ? 'chat'
          : 'versions'
  const triggerDeployValidationState = useMemo(() => {
    if (!workflowId) {
      return []
    }

    return triggerDeployTabs.map((tab) => {
      const block = currentBlocks[tab.blockId]
      const visibleSubBlocks = [
        ...tab.regularRows.flat(),
        ...(tab.displayAdvancedOptions ? tab.advancedRows.flat() : []),
      ]
      const configurableSubBlocks = visibleSubBlocks.filter(isConfigurableTriggerDeploySubBlock)
      const missingRequiredFieldLabels = configurableSubBlocks
        .filter((subBlock) => subBlock.required)
        .filter((subBlock) => {
          const value = block?.subBlocks?.[subBlock.id]?.value ?? null
          if (isMissingConfigValue(value) && subBlock.defaultValue !== undefined) {
            return isMissingConfigValue(subBlock.defaultValue)
          }
          return isMissingConfigValue(value)
        })
        .map((subBlock) => subBlock.title || subBlock.id)

      const requiresSavedConfig = visibleSubBlocks.some(
        (subBlock) => subBlock.id === 'triggerSave' || subBlock.type === 'trigger-save'
      )
      const webhookIdValue = requiresSavedConfig
        ? (block?.subBlocks?.['webhookId']?.value ?? null)
        : null
      const savedTriggerConfig = requiresSavedConfig
        ? (block?.subBlocks?.['triggerConfig']?.value ?? null)
        : null
      const hasUnsavedDeployConfig =
        requiresSavedConfig &&
        configurableSubBlocks.some((subBlock) => {
          if (subBlock.id === 'triggerCredentials') {
            return false
          }
          const currentValue = block?.subBlocks?.[subBlock.id]?.value ?? null
          const savedValue = getSavedTriggerConfigValue(savedTriggerConfig, subBlock.id)
          return !areConfigValuesEqual(currentValue, savedValue)
        })

      return {
        key: tab.key,
        missingRequiredFieldLabels,
        requiresSavedConfig,
        webhookIdValue,
        hasUnsavedDeployConfig,
      }
    })
  }, [triggerDeployTabs, workflowId, currentBlocks])
  const triggerValidationStateByKey = new Map(
    triggerDeployValidationState.map((tabState) => [tabState.key, tabState])
  )
  const isChatTriggerReady = chatTriggerBlock
    ? isChatDeploymentDraftConfigured(getChatDeploymentDraftFromBlock(chatTriggerBlock), {
        hasPasswordFallback: Boolean(publishedChat?.hasPassword),
      })
    : false
  const isApiTriggerReady = hasApiTriggerTab
    ? Boolean(selectedApiKeyId || deploymentInfo?.apiKey || isWorkflowDeployed)
    : false
  const deployableTriggerStates: DeployableTriggerState[] = blockList
    .map((block) => {
      const triggerId = resolveTriggerIdForBlock(block)
      if (!triggerId || !isDeployableTriggerId(triggerId)) {
        return null
      }

      const key = `trigger-${block.id}`
      const validationState = triggerValidationStateByKey.get(key)
      if (validationState) {
        return {
          key,
          isConfigured: isTriggerDeployTabConfigured(validationState),
        }
      }

      if (triggerId === 'chat') {
        return {
          key,
          isConfigured: isChatDeploymentDraftConfigured(getChatDeploymentDraftFromBlock(block), {
            hasPasswordFallback: Boolean(publishedChat?.hasPassword),
          }),
        }
      }

      if (triggerId === 'api') {
        return {
          key,
          isConfigured: Boolean(selectedApiKeyId || deploymentInfo?.apiKey || isWorkflowDeployed),
        }
      }

      return {
        key,
        isConfigured: true,
      }
    })
    .filter((triggerState): triggerState is DeployableTriggerState => triggerState !== null)
  const triggerReadyStateByKey = new Map(
    deployableTriggerStates.map((triggerState) => [triggerState.key, triggerState.isConfigured])
  )
  const infoTabItems: TriggerTabItem[] = [
    ...(showBillingTab
      ? [
          {
            key: BILLING_TAB_KEY,
            label: 'Billing',
            icon: CreditCard,
            iconAccentColor: undefined,
            isReady: undefined,
          },
        ]
      : []),
    {
      key: 'versions',
      label: 'Versions',
      icon: History,
      iconAccentColor: undefined,
      isReady: undefined,
    },
  ]
  const nativeTriggerTabItems: TriggerTabItem[] = [
    ...(hasChatTrigger
      ? [
          {
            key: 'chat',
            label: 'Chat',
            icon: getTrigger('chat')?.icon,
            iconAccentColor: sanitizeSolidIconColor(getBlock('chat_trigger')?.bgColor),
            isReady: isChatTriggerReady,
          },
        ]
      : []),
    ...(hasApiTriggerTab
      ? [
          {
            key: API_TRIGGER_TAB_KEY,
            label: 'API Trigger',
            icon: getTrigger('api')?.icon,
            iconAccentColor: sanitizeSolidIconColor(getBlock('api_trigger')?.bgColor),
            isReady: isApiTriggerReady,
          },
        ]
      : []),
    ...triggerDeployTabs
      .filter((tab) => isNativeTrigger(tab.triggerId))
      .map((tab) => ({
        key: tab.key,
        label: tab.label,
        icon: tab.icon,
        iconAccentColor: tab.iconAccentColor,
        isReady: triggerReadyStateByKey.get(tab.key) ?? false,
      })),
  ]
  const integrationTriggerTabItems: TriggerTabItem[] = triggerDeployTabs
    .filter((tab) => !isNativeTrigger(tab.triggerId))
    .map((tab) => ({
      key: tab.key,
      label: tab.label,
      icon: tab.icon,
      iconAccentColor: tab.iconAccentColor,
      isReady: triggerReadyStateByKey.get(tab.key) ?? false,
    }))
  const triggerTabItems: TriggerTabItem[] = [
    ...nativeTriggerTabItems,
    ...integrationTriggerTabItems,
  ]
  const activeNativeTriggerTabValue = nativeTriggerTabItems.some((tab) => tab.key === activeTab)
    ? activeTab
    : ''
  const activeIntegrationTriggerTabValue = integrationTriggerTabItems.some(
    (tab) => tab.key === activeTab
  )
    ? activeTab
    : ''
  const activeTriggerDeployTab = triggerDeployTabs.find((tab) => tab.key === activeTab)
  const activeTabMeta =
    activeTab === BILLING_TAB_KEY
      ? {
          title: 'Billing',
          description:
            'Choose the shared API key used for workflow deployment, billing attribution, and API trigger authentication.',
        }
      : activeTab === API_TRIGGER_TAB_KEY
        ? {
            title: 'API Trigger Deployment',
            description:
              'Review the API trigger endpoint and payload contract. This trigger uses the same shared API key selected in Billing.',
          }
        : activeTab === 'versions'
          ? {
              title: 'Deployment Versions',
              description:
                'Inspect previous deployments, rename versions, or activate an older snapshot.',
            }
          : activeTab === 'chat'
            ? {
                title: 'Chat Deployment',
                description:
                  'Configure chat publishing details here. Deploying the workflow publishes the chat trigger with these settings.',
              }
            : activeTriggerDeployTab
              ? {
                  title: activeTriggerDeployTab.label,
                  description:
                    activeTriggerDeployTab.triggerId === 'indicator_trigger'
                      ? 'Indicator monitors are managed from Logs -> Monitors. This trigger deploys with the workflow and does not need extra deployment fields here.'
                      : activeTriggerDeployTab.hasConfigurableFields
                        ? "Trigger mode is managed in the workflow editor. Edit the active mode's settings here, and save webhook-backed triggers after changes."
                        : 'Review this trigger before deployment. No additional configuration is required.',
                }
              : null
  const sharedApiKeyDisplay =
    deploymentInfo?.apiKey && deploymentInfo.apiKey !== 'No API key found'
      ? deploymentInfo.apiKey
      : null
  const apiTriggerSharedKeyMessage = isWorkflowDeployed
    ? sharedApiKeyDisplay
      ? `This API trigger uses the shared deployment API key ${sharedApiKeyDisplay}.`
      : 'This API trigger uses the shared deployment API key selected in Billing.'
    : hasSelectedSharedApiKey
      ? 'This API trigger will use the shared deployment API key currently selected in Billing.'
      : 'Select a shared deployment API key in Billing before deploying this API trigger.'
  const deployButtonLabel =
    versionToActivate !== null
      ? `Deploy ${versions.find((v) => v.version === versionToActivate)?.name || `v${versionToActivate}`}`
      : 'Deploy Workflow'
  const isVersionActivationAction = versionToActivate !== null
  const isInitialWorkflowDeployAction = !isVersionActivationAction && !isWorkflowDeployed
  const isWorkflowRedeployAction =
    !isVersionActivationAction && isWorkflowDeployed && needsRedeployment
  const hasReusableApiKey = Boolean(deploymentInfo?.hasReusableApiKey)
  const hasConfiguredTriggerToDeploy = deployableTriggerStates.some(
    (triggerState) => triggerState.isConfigured
  )
  const showFooter = versionToActivate !== null || hasNonChatDeployPath || hasChatTrigger
  const showFooterStatus = isWorkflowDeployed && versionToActivate === null
  const canViewActiveDeployment = !isLoadingDeployedState && !!deployedState
  const showFooterPrimaryAction =
    isVersionActivationAction || isInitialWorkflowDeployAction || isWorkflowRedeployAction
  const footerPrimaryLabel = deployButtonLabel
  const footerPrimaryMissingApiKey =
    requiresApiKeyForDeployment &&
    ((isInitialWorkflowDeployAction && !selectedApiKeyId) ||
      (isWorkflowRedeployAction && !hasReusableApiKey && !selectedApiKeyId))
  const footerPrimaryMissingConfiguredTrigger =
    !isVersionActivationAction &&
    deployableTriggerStates.length > 0 &&
    !hasConfiguredTriggerToDeploy
  const footerPrimaryDisabled =
    isSubmitting ||
    isChatConfigBusy ||
    footerPrimaryMissingApiKey ||
    footerPrimaryMissingConfiguredTrigger
  const showViewDeploymentButton = isWorkflowDeployed && versionToActivate === null
  const showUndeployButton = isWorkflowDeployed && versionToActivate === null

  const handleTriggerTabsWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }, [])

  useEffect(() => {
    if (editingVersion !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingVersion])

  const getInputFormatExample = (includeStreaming = false) => {
    let inputFormatExample = ''
    try {
      const blocks = Object.values(currentBlocks)

      // Check for API trigger block first (takes precedence)
      const apiTriggerBlock = blocks.find((block) => block.type === 'api_trigger')
      const targetBlock = apiTriggerBlock

      if (targetBlock) {
        const inputFormat = targetBlock.subBlocks?.['inputFormat']?.value ?? null

        const exampleData: Record<string, any> = {}

        if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
          inputFormat.forEach((field: any) => {
            if (field.name) {
              switch (field.type) {
                case 'string':
                  exampleData[field.name] = 'example'
                  break
                case 'number':
                  exampleData[field.name] = 42
                  break
                case 'boolean':
                  exampleData[field.name] = true
                  break
                case 'object':
                  exampleData[field.name] = { key: 'value' }
                  break
                case 'array':
                  exampleData[field.name] = [1, 2, 3]
                  break
                case 'files':
                  exampleData[field.name] = [
                    {
                      data: 'data:application/pdf;base64,...',
                      type: 'file',
                      name: 'document.pdf',
                      mime: 'application/pdf',
                    },
                  ]
                  break
              }
            }
          })
        }

        // Add streaming parameters if enabled and outputs are selected
        if (includeStreaming && selectedStreamingOutputs.length > 0) {
          exampleData.stream = true
          // Convert blockId_attribute format to blockName.attribute format for display
          const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

          const convertedOutputs = selectedStreamingOutputs.map((outputId) => {
            // If it starts with a UUID, convert to blockName.attribute format
            if (UUID_REGEX.test(outputId)) {
              const underscoreIndex = outputId.indexOf('_')
              if (underscoreIndex === -1) return outputId

              const blockId = outputId.substring(0, underscoreIndex)
              const attribute = outputId.substring(underscoreIndex + 1)

              // Find the block by ID and get its name
              const block = blocks.find((b) => b.id === blockId)
              if (block?.name) {
                // Normalize block name: lowercase and remove spaces
                const normalizedBlockName = block.name.toLowerCase().replace(/\s+/g, '')
                return `${normalizedBlockName}.${attribute}`
              }
            }

            // Already in blockName.attribute format or couldn't convert
            return outputId
          })

          exampleData.selectedOutputs = convertedOutputs
        }

        if (Object.keys(exampleData).length > 0) {
          inputFormatExample = ` -d '${JSON.stringify(exampleData)}'`
        }
      }
    } catch (error) {
      logger.error('Error generating input format example:', error)
    }

    return inputFormatExample
  }

  const fetchApiKeys = async () => {
    if (!open) return

    try {
      const [workspaceResponse, personalResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/api-keys`),
        fetch('/api/users/me/api-keys'),
      ])

      const workspaceData = workspaceResponse.ok ? await workspaceResponse.json() : { keys: [] }
      const personalData = personalResponse.ok ? await personalResponse.json() : { keys: [] }

      setApiKeys([...(workspaceData.keys || []), ...(personalData.keys || [])])
    } catch (error) {
      logger.error('Error fetching API keys:', { error })
    }
  }

  const fetchPublishedChatInfo = async () => {
    if (!open || !workflowId) return

    try {
      setIsLoading(true)
      const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

      if (response.ok) {
        const data = await response.json()
        if (data.isDeployed && data.deployment) {
          const detailResponse = await fetch(`/api/chat/manage/${data.deployment.id}`)
          if (detailResponse.ok) {
            const detailData = await detailResponse.json()
            setPublishedChat(detailData)
          } else {
            setPublishedChat(null)
          }
        } else {
          setPublishedChat(null)
        }
      } else {
        setPublishedChat(null)
      }
    } catch (error) {
      logger.error('Error fetching published chat info:', { error })
      setPublishedChat(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setIsLoading(true)
      fetchApiKeys()
      if (hasChatTrigger) {
        fetchPublishedChatInfo()
      } else {
        setPublishedChat(null)
      }
      setActiveTab(fallbackTab)
      setVersionToActivate(null)
    } else {
      setSelectedApiKeyId('')
      setDeploymentInfo(null)
      setPublishedChat(null)
      setVersionToActivate(null)
    }
  }, [open, workflowId, requiresApiKeyForDeployment, hasChatTrigger, fallbackTab])

  useEffect(() => {
    const availableTabs = new Set<TabView>([
      'versions',
      ...(showBillingTab ? [BILLING_TAB_KEY] : []),
      ...triggerTabItems.map((tab) => tab.key),
    ])

    if (!availableTabs.has(activeTab)) {
      setActiveTab(fallbackTab)
    }
  }, [activeTab, showBillingTab, triggerTabItems, fallbackTab])

  useEffect(() => {
    if (deploymentInfo?.pinnedApiKeyId) {
      const matchingKey = apiKeys.find((k) => k.id === deploymentInfo.pinnedApiKeyId)
      if (matchingKey) {
        setSelectedApiKeyId(matchingKey.id)
        return
      }

      setSelectedApiKeyId(deploymentInfo.pinnedApiKeyId)
      return
    }

    if (apiKeys.length === 0) return

    if (!selectedApiKeyId) {
      setSelectedApiKeyId(apiKeys[0].id)
    }
  }, [deploymentInfo?.pinnedApiKeyId, apiKeys, selectedApiKeyId])

  useEffect(() => {
    async function fetchDeploymentInfo() {
      if (!open || !workflowId) {
        setDeploymentInfo(null)
        if (!open) {
          setIsLoading(false)
        }
        return
      }

      if (deploymentInfo?.isDeployed && !needsRedeployment) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)

        const response = await fetch(`/api/workflows/${workflowId}/deploy`)

        if (!response.ok) {
          throw new Error('Failed to fetch deployment information')
        }

        const data = await response.json()
        if (!data.isDeployed) {
          setDeploymentInfo(null)
          return
        }

        const endpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`
        const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)

        setDeploymentInfo({
          isDeployed: data.isDeployed,
          deployedAt: data.deployedAt,
          apiKey: data.apiKey,
          pinnedApiKeyId: data.pinnedApiKeyId ?? null,
          endpoint,
          exampleCommand: `curl -X POST -H "X-API-Key: ${data.apiKey}" -H "Content-Type: application/json"${inputFormatExample} ${endpoint}`,
          needsRedeployment,
          hasReusableApiKey: Boolean(data.hasReusableApiKey),
          asyncExecutionEnabled: Boolean(data.asyncExecutionEnabled),
        })
      } catch (error) {
        logger.error('Error fetching deployment info:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    fetchDeploymentInfo()
  }, [open, workflowId, needsRedeployment, deploymentInfo?.isDeployed])

  const onDeploy = async (data: DeployFormValues) => {
    setApiDeployError(null)

    try {
      setIsSubmitting(true)

      const apiKeyToUse = data.apiKey || selectedApiKeyId
      const normalizedApiKey = apiKeyToUse?.trim() ? apiKeyToUse : undefined

      let deployEndpoint = `/api/workflows/${workflowId}/deploy`
      if (versionToActivate !== null) {
        deployEndpoint = `/api/workflows/${workflowId}/deployments/${versionToActivate}/activate`
      }

      const response = await fetch(deployEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to deploy workflow')
      }

      const responseData = await response.json()

      const isActivating = versionToActivate !== null
      const isDeployedStatus = isActivating ? true : (responseData.isDeployed ?? false)
      const deployedAtTime = responseData.deployedAt ? new Date(responseData.deployedAt) : undefined
      const apiKeyFromResponse = responseData.apiKey || normalizedApiKey || ''

      setDeploymentStatus(workflowId, isDeployedStatus, deployedAtTime, apiKeyFromResponse)

      const matchingKey = apiKeys.find(
        (k) => k.key === apiKeyFromResponse || k.id === normalizedApiKey
      )
      if (matchingKey) {
        setSelectedApiKeyId(matchingKey.id)
      }

      const isActivatingVersion = versionToActivate !== null
      setNeedsRedeployment(isActivatingVersion)
      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, isActivatingVersion)
      }

      await refetchDeployedState()
      await fetchVersions()

      const deploymentInfoResponse = await fetch(`/api/workflows/${workflowId}/deploy`)
      if (deploymentInfoResponse.ok) {
        const deploymentData = await deploymentInfoResponse.json()
        const apiEndpoint = `${getEnv('NEXT_PUBLIC_APP_URL')}/api/workflows/${workflowId}/execute`
        const inputFormatExample = getInputFormatExample(selectedStreamingOutputs.length > 0)

        setDeploymentInfo({
          isDeployed: deploymentData.isDeployed,
          deployedAt: deploymentData.deployedAt,
          apiKey: deploymentData.apiKey,
          pinnedApiKeyId: deploymentData.pinnedApiKeyId ?? null,
          endpoint: apiEndpoint,
          exampleCommand: `curl -X POST -H "X-API-Key: ${deploymentData.apiKey}" -H "Content-Type: application/json"${inputFormatExample} ${apiEndpoint}`,
          needsRedeployment: isActivatingVersion,
          hasReusableApiKey: Boolean(deploymentData.hasReusableApiKey),
          asyncExecutionEnabled: Boolean(deploymentData.asyncExecutionEnabled),
        })
      }

      setVersionToActivate(null)
      setApiDeployError(null)
    } catch (error: unknown) {
      logger.error('Error deploying workflow:', { error })
      const errorMessage = error instanceof Error ? error.message : 'Failed to deploy workflow'
      setApiDeployError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const fetchVersions = async () => {
    if (!workflowId) return
    try {
      setVersionsLoading(true)
      const res = await fetch(`/api/workflows/${workflowId}/deployments`)
      if (res.ok) {
        const data = await res.json()
        setVersions(Array.isArray(data.versions) ? data.versions : [])
      } else {
        setVersions([])
      }
    } catch {
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }

  useEffect(() => {
    if (open && workflowId) {
      fetchVersions()
    }
  }, [open, workflowId])

  const handleActivateVersion = (version: number) => {
    setVersionToActivate(version)
    setActiveTab(
      hasApiTriggerTab ? API_TRIGGER_TAB_KEY : showBillingTab ? BILLING_TAB_KEY : 'versions'
    )
  }

  const openVersionPreview = async (version: number) => {
    if (!workflowId) return
    try {
      setPreviewVersion(version)
      const res = await fetch(`/api/workflows/${workflowId}/deployments/${version}`)
      if (res.ok) {
        const data = await res.json()
        setPreviewDeployedState(data.deployedState || null)
      } else {
        setPreviewDeployedState(null)
      }
    } finally {
      // keep modal open even if error; user can close
    }
  }

  const handleStartRename = (version: number, currentName: string | null | undefined) => {
    setOpenDropdown(null) // Close dropdown first
    setEditingVersion(version)
    setEditValue(currentName || `v${version}`)
  }

  const handleSaveRename = async (version: number) => {
    if (!workflowId || !editValue.trim()) {
      setEditingVersion(null)
      return
    }

    const currentVersion = versions.find((v) => v.version === version)
    const currentName = currentVersion?.name || `v${version}`

    if (editValue.trim() === currentName) {
      setEditingVersion(null)
      return
    }

    setIsRenaming(true)
    try {
      const res = await fetch(`/api/workflows/${workflowId}/deployments/${version}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editValue.trim() }),
      })

      if (res.ok) {
        await fetchVersions()
        setEditingVersion(null)
      } else {
        logger.error('Failed to rename version')
      }
    } catch (error) {
      logger.error('Error renaming version:', error)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelRename = () => {
    setEditingVersion(null)
    setEditValue('')
  }

  const handleUndeploy = async () => {
    try {
      setIsUndeploying(true)
      setShowUndeployConfirm(false)

      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to undeploy workflow')
      }

      setDeploymentStatus(workflowId, false)
      setPublishedChat(null)
      onOpenChange(false)
    } catch (error: unknown) {
      logger.error('Error undeploying workflow:', { error })
    } finally {
      setIsUndeploying(false)
    }
  }

  const handleRedeploy = async () => {
    try {
      setIsSubmitting(true)
      const apiKeyToUse = selectedApiKeyId?.trim() ? selectedApiKeyId : undefined

      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiKeyToUse ? { apiKey: apiKeyToUse } : {}),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to redeploy workflow')
      }

      const { isDeployed: newDeployStatus, deployedAt, apiKey } = await response.json()

      setDeploymentStatus(
        workflowId,
        newDeployStatus,
        deployedAt ? new Date(deployedAt) : undefined,
        apiKey
      )

      setNeedsRedeployment(false)
      if (workflowId) {
        useWorkflowRegistry.getState().setWorkflowNeedsRedeployment(workflowId, false)
      }

      await refetchDeployedState()
      await fetchVersions()

      setDeploymentInfo((prev) =>
        prev
          ? {
              ...prev,
              needsRedeployment: false,
              pinnedApiKeyId: apiKeyToUse ?? prev.pinnedApiKeyId ?? null,
              hasReusableApiKey: prev.hasReusableApiKey || Boolean(apiKeyToUse),
            }
          : prev
      )
    } catch (error: unknown) {
      logger.error('Error redeploying workflow:', { error })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCloseModal = () => {
    setIsSubmitting(false)
    setIsViewingActiveDeployment(false)
    setShowUndeployConfirm(false)
    onOpenChange(false)
  }

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        showUndeployConfirm ||
        isViewingActiveDeployment ||
        previewVersion !== null
      ) {
        return
      }

      event.preventDefault()
      handleCloseModal()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, showUndeployConfirm, isViewingActiveDeployment, previewVersion, onOpenChange])

  const handleFooterPrimaryAction = () => {
    if (versionToActivate === null && isWorkflowDeployed && needsRedeployment) {
      void handleRedeploy()
      return
    }

    void onDeploy({ apiKey: selectedApiKeyId })
  }

  const handleFooterUndeploy = () => {
    void handleUndeploy()
  }

  const renderTriggerTab = (tab: TriggerDeployTab) => {
    const validationState = triggerValidationStateByKey.get(tab.key)
    const visibleSubBlocks = [
      ...tab.regularRows.flat(),
      ...(tab.displayAdvancedOptions ? tab.advancedRows.flat() : []),
    ]

    if (!tab.blockId) {
      return (
        <div className='rounded-md border p-4 text-muted-foreground text-sm'>
          Trigger configuration is unavailable.
        </div>
      )
    }

    if (visibleSubBlocks.length === 0) {
      return (
        <div className='rounded-md border p-4 text-muted-foreground text-sm'>
          This trigger deploys with the workflow. No additional configuration is required.
        </div>
      )
    }

    return (
      <div className='space-y-4'>
        {validationState && (
          <div className='rounded-md border bg-muted/20 p-3 text-sm'>
            {validationState.missingRequiredFieldLabels.length > 0 ? (
              <div className='text-amber-600 dark:text-amber-400'>
                Complete required fields before deploying:{' '}
                {validationState.missingRequiredFieldLabels.join(', ')}.
              </div>
            ) : validationState.requiresSavedConfig &&
              isMissingConfigValue(validationState.webhookIdValue) ? (
              <div className='text-amber-600 dark:text-amber-400'>
                Save this trigger configuration to provision its webhook before deploying.
              </div>
            ) : validationState.hasUnsavedDeployConfig ? (
              <div className='text-amber-600 dark:text-amber-400'>
                Trigger settings changed since the last save. Save the trigger before deploying.
              </div>
            ) : (
              <div className='text-emerald-600 dark:text-emerald-400'>
                Trigger configuration looks ready. Review the values below before deploying.
              </div>
            )}
          </div>
        )}
        <div className='text-muted-foreground text-sm'>
          Trigger mode is controlled in the workflow editor. Edit the current mode's settings
          here before deployment.
        </div>
        {visibleSubBlocks.some(isConfigurableTriggerDeploySubBlock) && (
          <div className='text-muted-foreground text-sm'>
            These settings stay editable here and in the workflow editor.
          </div>
        )}
        {tab.regularRows.map((row, rowIndex) => (
          <div key={`deploy-trigger-row-${tab.blockId}-${rowIndex}`} className='flex gap-3'>
            {row.map((subBlock) => (
              <div
                key={getTriggerAwareSubBlockStableKey(
                  tab.blockId,
                  subBlock,
                  tab.stateToUse,
                  [tab.triggerId]
                )}
                className={subBlock.layout === 'half' ? 'flex-1 space-y-1' : 'w-full space-y-1'}
              >
                <SubBlock
                  blockId={tab.blockId}
                  config={subBlock}
                  isConnecting={false}
                  disabled={shouldDisableTriggerWrite}
                />
              </div>
            ))}
          </div>
        ))}
        {tab.hasAdvancedOnlyFields && !shouldDisableTriggerWrite && (
          <div className='flex items-center gap-[10px] pt-[4px]'>
            <div className='h-px flex-1 border-border border-t border-dashed' />
            <button
              type='button'
              onClick={() => collaborativeToggleBlockAdvancedMode(tab.blockId)}
              className='flex items-center gap-[6px] whitespace-nowrap font-medium text-[13px] text-muted-foreground hover:text-foreground'
            >
              {tab.displayAdvancedOptions ? 'Hide additional fields' : 'Show additional fields'}
              <ChevronDown
                className={`h-[14px] w-[14px] transition-transform duration-200 ${tab.displayAdvancedOptions ? 'rotate-180' : ''}`}
              />
            </button>
            <div className='h-px flex-1 border-border border-t border-dashed' />
          </div>
        )}
        {tab.displayAdvancedOptions &&
          tab.advancedRows.map((row, rowIndex) => (
            <div
              key={`deploy-trigger-advanced-row-${tab.blockId}-${rowIndex}`}
              className='flex gap-3'
            >
              {row.map((subBlock) => (
                <div
                  key={getTriggerAwareSubBlockStableKey(
                    tab.blockId,
                    subBlock,
                    tab.stateToUse,
                    [tab.triggerId]
                  )}
                  className={subBlock.layout === 'half' ? 'flex-1 space-y-1' : 'w-full space-y-1'}
                >
                  <SubBlock
                    blockId={tab.blockId}
                    config={subBlock}
                    isConnecting={false}
                    disabled={shouldDisableTriggerWrite}
                  />
                </div>
              ))}
            </div>
          ))}
      </div>
    )
  }

  const renderDesktopSidebarSection = (label: string, tabs: TriggerTabItem[]) => {
    if (tabs.length === 0) {
      return null
    }

    return (
      <div className='space-y-2'>
        {!isSidebarCollapsed && <div className={deployNavGroupLabelClass}>{label}</div>}
        <div className='space-y-1 px-1'>
          {tabs.map((tab) => {
            const Icon = tab.icon
            const iconTileStyle = getIconTileStyle(tab.iconAccentColor)
            const button = (
              <button
                key={tab.key}
                type='button'
                onClick={() => setActiveTab(tab.key)}
                data-active={activeTab === tab.key}
                aria-current={activeTab === tab.key ? 'page' : undefined}
                aria-label={isSidebarCollapsed ? tab.label : undefined}
                className={cn(deployNavButtonClass, isSidebarCollapsed && 'justify-center px-0')}
              >
                <div
                  className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary text-foreground'
                  style={iconTileStyle}
                >
                  {Icon ? <Icon className='h-5 w-5' /> : null}
                </div>
                {!isSidebarCollapsed && (
                  <span className='min-w-0 flex-1 truncate'>{tab.label}</span>
                )}
                {!isSidebarCollapsed && tab.isReady && (
                  <Check className='h-4 w-4 shrink-0 text-green-500' />
                )}
              </button>
            )

            if (!isSidebarCollapsed) {
              return button
            }

            return (
              <Tooltip key={tab.key}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side='right' container={overlayContainer} className='z-[1001]'>
                  {tab.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      {open &&
        overlayContainer &&
        createPortal(
          <div className='pointer-events-none absolute inset-0 z-999 flex items-center justify-center p-4 sm:p-6'>
            <div
              aria-hidden='true'
              className='pointer-events-auto absolute inset-0 bg-background/60 backdrop-blur-[1.5px]'
              onClick={handleCloseModal}
            />

            <div
              role='dialog'
              aria-modal='true'
              aria-labelledby='deploy-workflow-title'
              className='pointer-events-auto relative flex h-full max-h-full w-full max-w-[920px] flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl'
            >
              <div className='justify-center gap-3 space-y-3 border-b p-3'>
                <div className='flex flex-shrink-0 items-center justify-between'>
                  <div className='flex items-center gap-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='hidden h-8 w-8 p-0 text-muted-foreground sm:inline-flex'
                      onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
                    >
                      <PanelLeft className='h-4 w-4' />
                      <span className='sr-only'>
                        {isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                      </span>
                    </Button>
                    <h2 id='deploy-workflow-title' className='font-medium text-lg'>
                      Deploy Workflow
                    </h2>
                    {needsRedeployment && versions.length > 0 && versionToActivate === null && (
                      <span className='inline-flex items-center rounded-md bg-amber-500/10 px-2 py-1 font-medium text-amber-600 text-xs dark:text-amber-400'>
                        {versions.find((v) => v.isActive)?.name ||
                          `v${versions.find((v) => v.isActive)?.version}`}{' '}
                        active
                      </span>
                    )}
                  </div>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 p-0'
                    onClick={handleCloseModal}
                  >
                    <X className='h-4 w-4' />
                    <span className='sr-only'>Close</span>
                  </Button>
                </div>
                {apiDeployError && (
                  <div className='rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive text-sm'>
                    <div className='font-semibold'>Deployment Error</div>
                    <div>{apiDeployError}</div>
                  </div>
                )}
              </div>

              <div className='flex flex-1 overflow-hidden'>
                <div
                  className={cn(
                    'hidden flex-shrink-0 border-border border-r bg-background py-1 transition-[width] duration-200 ease-linear sm:flex',
                    isSidebarCollapsed ? 'w-12' : 'w-64'
                  )}
                >
                  <div
                    className={cn(
                      'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-1',
                      isSidebarCollapsed ? 'px-1' : 'px-2'
                    )}
                  >
                    <div className='space-y-3'>
                      {renderDesktopSidebarSection('Info', infoTabItems)}
                      {renderDesktopSidebarSection('Native', nativeTriggerTabItems)}
                      {renderDesktopSidebarSection('Integration', integrationTriggerTabItems)}
                    </div>
                  </div>
                </div>

                <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
                  <div className='flex flex-none flex-col gap-3 border-b px-6 py-4 sm:hidden'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className={cn(deployNavGroupLabelClass, 'mr-1 h-auto px-0')}>Info</span>
                      {showBillingTab && (
                        <button
                          onClick={() => setActiveTab(BILLING_TAB_KEY)}
                          data-active={activeTab === BILLING_TAB_KEY}
                          className={deployInlineNavButtonClass}
                        >
                          Billing
                        </button>
                      )}
                      <button
                        onClick={() => setActiveTab('versions')}
                        data-active={activeTab === 'versions'}
                        className={deployInlineNavButtonClass}
                      >
                        Versions
                      </button>
                    </div>

                    {nativeTriggerTabItems.length > 0 && (
                      <div className='rounded-lg border border-border bg-background p-2'>
                        <div className={cn(deployNavGroupLabelClass, 'mb-2 h-auto')}>Native</div>
                        <Tabs value={activeNativeTriggerTabValue} onValueChange={setActiveTab}>
                          <div
                            onWheel={handleTriggerTabsWheel}
                            className='overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                          >
                            <TabsList className='h-auto w-max min-w-full justify-start gap-1 rounded-md bg-transparent p-0'>
                              {nativeTriggerTabItems.map((tab) => (
                                <TabsTrigger
                                  key={tab.key}
                                  value={tab.key}
                                  className='h-8 rounded-md bg-background px-3 text-muted-foreground data-[state=active]:bg-sidebar-accent data-[state=active]:font-medium data-[state=active]:text-sidebar-accent-foreground'
                                >
                                  {tab.label}
                                </TabsTrigger>
                              ))}
                            </TabsList>
                          </div>
                        </Tabs>
                      </div>
                    )}

                    {integrationTriggerTabItems.length > 0 && (
                      <div className='rounded-lg border border-border bg-background p-2'>
                        <div className={cn(deployNavGroupLabelClass, 'mb-2 h-auto')}>
                          Integration
                        </div>
                        <Tabs value={activeIntegrationTriggerTabValue} onValueChange={setActiveTab}>
                          <div
                            onWheel={handleTriggerTabsWheel}
                            className='overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                          >
                            <TabsList className='h-auto w-max min-w-full justify-start gap-1 rounded-md bg-transparent p-0'>
                              {integrationTriggerTabItems.map((tab) => (
                                <TabsTrigger
                                  key={tab.key}
                                  value={tab.key}
                                  className='h-8 rounded-md bg-background px-3 text-muted-foreground data-[state=active]:bg-sidebar-accent data-[state=active]:font-medium data-[state=active]:text-sidebar-accent-foreground'
                                >
                                  {tab.label}
                                </TabsTrigger>
                              ))}
                            </TabsList>
                          </div>
                        </Tabs>
                      </div>
                    )}
                  </div>

                  <div className='flex-1 overflow-y-auto'>
                    <div className='p-6' key={`${activeTab}-${versionToActivate}`}>
                      {activeTabMeta && (
                        <div className='mb-5 rounded-lg border bg-muted/20 px-4 py-3'>
                          <div className='font-medium text-sm'>{activeTabMeta.title}</div>
                          <div className='mt-1 text-muted-foreground text-sm leading-6'>
                            {activeTabMeta.description}
                          </div>
                        </div>
                      )}

                      {showBillingTab && activeTab === BILLING_TAB_KEY && (
                        <>
                          {isWorkflowDeployed && (
                            <div className='mb-4'>
                              <DeploymentInfo
                                isLoading={isLoading}
                                deploymentInfo={deploymentInfo}
                                workflowId={workflowId}
                                getInputFormatExample={getInputFormatExample}
                                selectedStreamingOutputs={selectedStreamingOutputs}
                                onSelectedStreamingOutputsChange={setSelectedStreamingOutputs}
                                showApiKeyInfo={true}
                                showApiAccessInfo={false}
                              />
                            </div>
                          )}

                          <div className='-mx-1 px-1'>
                            <div className='mb-3 rounded-md border p-3 text-muted-foreground text-sm'>
                              Select the shared API key used for workflow deployment, billing
                              attribution, and API trigger authentication.
                            </div>
                            <DeployForm
                              apiKeys={apiKeys}
                              selectedApiKeyId={selectedApiKeyId}
                              onApiKeyChange={setSelectedApiKeyId}
                              onSubmit={onDeploy}
                              onApiKeyCreated={fetchApiKeys}
                              formId='deploy-api-form'
                              isDeployed={false}
                              deployedApiKeyDisplay={deploymentInfo?.apiKey}
                            />
                          </div>
                        </>
                      )}

                      {hasApiTriggerTab && activeTab === API_TRIGGER_TAB_KEY && (
                        <>
                          <div className='mb-4 rounded-md border bg-muted/20 p-4 text-sm'>
                            <div className='font-medium'>Shared API Key</div>
                            <div className='mt-1 text-muted-foreground'>
                              {apiTriggerSharedKeyMessage}
                            </div>
                            <div className='mt-3'>
                              <Button
                                type='button'
                                variant='outline'
                                size='sm'
                                onClick={() => setActiveTab(BILLING_TAB_KEY)}
                              >
                                Manage in Billing
                              </Button>
                            </div>
                          </div>

                          {versionToActivate === null && isWorkflowDeployed ? (
                            <DeploymentInfo
                              isLoading={isLoading}
                              deploymentInfo={deploymentInfo}
                              workflowId={workflowId}
                              getInputFormatExample={getInputFormatExample}
                              selectedStreamingOutputs={selectedStreamingOutputs}
                              onSelectedStreamingOutputsChange={setSelectedStreamingOutputs}
                              showApiKeyInfo={false}
                              showApiAccessInfo={true}
                            />
                          ) : (
                            <>
                              <div className='rounded-md border p-4 text-muted-foreground text-sm'>
                                {versionToActivate !== null
                                  ? 'Activate the selected deployment version to update the API trigger endpoint.'
                                  : 'Deploy the workflow to create the API trigger endpoint.'}
                              </div>
                            </>
                          )}
                        </>
                      )}

                      {activeTab === 'versions' && (
                        <>
                          {versionsLoading ? (
                            <div className='rounded-md border p-4 text-center text-muted-foreground text-sm'>
                              Loading deployments...
                            </div>
                          ) : versions.length === 0 ? (
                            <div className='rounded-md border p-4 text-center text-muted-foreground text-sm'>
                              No deployments yet
                            </div>
                          ) : (
                            <>
                              <div className='overflow-hidden rounded-md border'>
                                <table className='w-full'>
                                  <thead className='border-b bg-muted/50'>
                                    <tr>
                                      <th className='w-10' />
                                      <th className='w-[200px] whitespace-nowrap px-4 py-2 text-left font-medium text-muted-foreground text-xs'>
                                        Version
                                      </th>
                                      <th className='whitespace-nowrap px-4 py-2 text-left font-medium text-muted-foreground text-xs'>
                                        Deployed By
                                      </th>
                                      <th className='whitespace-nowrap px-4 py-2 text-left font-medium text-muted-foreground text-xs'>
                                        Created
                                      </th>
                                      <th className='w-10' />
                                    </tr>
                                  </thead>
                                  <tbody className='divide-y'>
                                    {versions
                                      .slice(
                                        (currentPage - 1) * itemsPerPage,
                                        currentPage * itemsPerPage
                                      )
                                      .map((v) => (
                                        <tr
                                          key={v.id}
                                          className='cursor-pointer transition-colors hover:bg-card/30'
                                          onClick={() => {
                                            if (editingVersion !== v.version) {
                                              openVersionPreview(v.version)
                                            }
                                          }}
                                        >
                                          <td className='px-4 py-2.5'>
                                            <div
                                              className={`h-2 w-2 rounded-full ${
                                                v.isActive
                                                  ? 'bg-green-500'
                                                  : 'bg-muted-foreground/40'
                                              }`}
                                              title={v.isActive ? 'Active' : 'Inactive'}
                                            />
                                          </td>
                                          <td className='w-[220px] max-w-[220px] px-4 py-2.5'>
                                            {editingVersion === v.version ? (
                                              <input
                                                ref={inputRef}
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    e.preventDefault()
                                                    handleSaveRename(v.version)
                                                  } else if (e.key === 'Escape') {
                                                    e.preventDefault()
                                                    handleCancelRename()
                                                  }
                                                }}
                                                onBlur={() => handleSaveRename(v.version)}
                                                className='w-full border-0 bg-transparent p-0 font-medium text-sm leading-5 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                                                maxLength={100}
                                                disabled={isRenaming}
                                                autoComplete='off'
                                                autoCorrect='off'
                                                autoCapitalize='off'
                                                spellCheck='false'
                                              />
                                            ) : (
                                              <span className='block whitespace-pre-wrap break-words break-all font-medium text-sm leading-5'>
                                                {v.name || `v${v.version}`}
                                              </span>
                                            )}
                                          </td>
                                          <td className='whitespace-nowrap px-4 py-2.5'>
                                            <span className='text-muted-foreground text-sm'>
                                              {v.deployedBy || 'Unknown'}
                                            </span>
                                          </td>
                                          <td className='whitespace-nowrap px-4 py-2.5'>
                                            <span className='text-muted-foreground text-sm'>
                                              {new Date(v.createdAt).toLocaleDateString()}{' '}
                                              {new Date(v.createdAt).toLocaleTimeString()}
                                            </span>
                                          </td>
                                          <td
                                            className='px-4 py-2.5'
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <DropdownMenu
                                              open={openDropdown === v.version}
                                              onOpenChange={(open) =>
                                                setOpenDropdown(open ? v.version : null)
                                              }
                                            >
                                              <DropdownMenuTrigger asChild>
                                                <Button
                                                  variant='ghost'
                                                  size='icon'
                                                  className='h-8 w-8'
                                                  disabled={activatingVersion === v.version}
                                                >
                                                  <MoreVertical className='h-4 w-4' />
                                                </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent
                                                align='end'
                                                onCloseAutoFocus={(event) => event.preventDefault()}
                                              >
                                                <DropdownMenuItem
                                                  onClick={() => openVersionPreview(v.version)}
                                                >
                                                  {v.isActive ? 'View Active' : 'Inspect'}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                  onClick={() =>
                                                    handleStartRename(v.version, v.name)
                                                  }
                                                >
                                                  Rename
                                                </DropdownMenuItem>
                                              </DropdownMenuContent>
                                            </DropdownMenu>
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                              {versions.length > itemsPerPage && (
                                <div className='mt-3 flex items-center justify-between'>
                                  <span className='text-muted-foreground text-sm'>
                                    Showing{' '}
                                    {Math.min(
                                      (currentPage - 1) * itemsPerPage + 1,
                                      versions.length
                                    )}{' '}
                                    - {Math.min(currentPage * itemsPerPage, versions.length)} of{' '}
                                    {versions.length}
                                  </span>
                                  <div className='flex gap-2'>
                                    <Button
                                      variant='outline'
                                      size='sm'
                                      onClick={() => setCurrentPage(currentPage - 1)}
                                      disabled={currentPage === 1}
                                    >
                                      Previous
                                    </Button>
                                    <Button
                                      variant='outline'
                                      size='sm'
                                      onClick={() => setCurrentPage(currentPage + 1)}
                                      disabled={currentPage * itemsPerPage >= versions.length}
                                    >
                                      Next
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}

                      {triggerDeployTabs
                        .filter((tab) => tab.key === activeTab)
                        .map((tab) => (
                          <div key={tab.key}>{renderTriggerTab(tab)}</div>
                        ))}

                      {hasChatTrigger && activeTab === 'chat' && chatTriggerBlock && (
                        <ChatDeploy
                          workflowId={workflowId || ''}
                          blockId={chatTriggerBlock.id}
                          publishedChat={publishedChat}
                          onBusyChange={setIsChatConfigBusy}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {showFooter && (
                <div className='flex flex-shrink-0 items-center justify-between border-t px-6 py-4'>
                  {showFooterStatus ? (
                    <DeployStatus needsRedeployment={needsRedeployment} />
                  ) : (
                    <div />
                  )}

                  <div className='flex items-center gap-2'>
                    {showViewDeploymentButton && (
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={!canViewActiveDeployment}
                        onClick={() => setIsViewingActiveDeployment(true)}
                      >
                        View Deployment
                      </Button>
                    )}
                    {showUndeployButton && (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setShowUndeployConfirm(true)}
                        disabled={isUndeploying}
                      >
                        {isUndeploying ? 'Undeploying...' : 'Undeploy'}
                      </Button>
                    )}

                    {showFooterPrimaryAction && (
                      <Button
                        type='button'
                        disabled={footerPrimaryDisabled}
                        onClick={handleFooterPrimaryAction}
                        className={cn(
                          'gap-2 font-medium',
                          'bg-primary hover:bg-primary-hover',
                          'shadow-[0_0_0_0_var(--primary-hover)]',
                          'transition-all duration-200',
                          'disabled:opacity-50 disabled:hover:bg-primary-hover disabled:hover:shadow-none'
                        )}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                            Deploying...
                          </>
                        ) : (
                          footerPrimaryLabel
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>,
          overlayContainer
        )}

      <AlertDialog open={showUndeployConfirm} onOpenChange={setShowUndeployConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasApiTriggerTab ? 'Undeploy API' : 'Undeploy Workflow'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasApiTriggerTab
                ? 'Are you sure you want to undeploy this workflow? This will remove the API endpoint and make it unavailable to external users.'
                : 'Are you sure you want to undeploy this workflow? This will stop deployed trigger processing for this workflow.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUndeploying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFooterUndeploy}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={isUndeploying}
            >
              {isUndeploying ? 'Undeploying...' : 'Undeploy'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isViewingActiveDeployment && deployedState && workflowId && (
        <DeployedWorkflowModal
          isOpen={true}
          onClose={() => setIsViewingActiveDeployment(false)}
          needsRedeployment={needsRedeployment}
          activeDeployedState={deployedState}
          workflowId={workflowId}
        />
      )}
      {previewVersion !== null && previewDeployedState && workflowId && (
        <DeployedWorkflowModal
          isOpen={true}
          onClose={() => {
            setPreviewVersion(null)
            setPreviewDeployedState(null)
          }}
          needsRedeployment={true}
          activeDeployedState={deployedState ?? undefined}
          selectedDeployedState={previewDeployedState as WorkflowState}
          selectedVersion={previewVersion}
          onActivateVersion={() => {
            handleActivateVersion(previewVersion)
            setPreviewVersion(null)
            setPreviewDeployedState(null)
          }}
          isActivating={activatingVersion === previewVersion}
          selectedVersionLabel={
            versions.find((v) => v.version === previewVersion)?.name || `v${previewVersion}`
          }
          workflowId={workflowId}
          isSelectedVersionActive={versions.find((v) => v.version === previewVersion)?.isActive}
        />
      )}
    </>
  )
}
