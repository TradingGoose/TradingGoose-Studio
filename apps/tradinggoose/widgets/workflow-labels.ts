import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

type WorkflowToolbarCopy = ReturnType<typeof getPublicCopy>['workspace']['widgets']['workflowToolbar']
type WorkflowLabelCopy = ReturnType<typeof getPublicCopy>['workspace']['widgets']['workflowLabels']

const TEMPERATURE_LABEL_PATTERN = /^Temperature/
const TRAILING_COLON_PATTERN = /:\s*$/

function normalizeWorkflowLabel(label: string) {
  return label.replace(TRAILING_COLON_PATTERN, '')
}

export function getWorkflowToolbarCopy(locale: LocaleCode): WorkflowToolbarCopy {
  return getPublicCopy(locale).workspace.widgets.workflowToolbar
}

export function getWorkflowLabelCopy(locale: LocaleCode): WorkflowLabelCopy {
  return getPublicCopy(locale).workspace.widgets.workflowLabels
}

export function translateWorkflowToolbarLabel(locale: LocaleCode, label: string): string {
  const copy = getWorkflowToolbarCopy(locale)

  switch (label) {
    case 'Blocks':
      return copy.blocks
    case 'Tools':
      return copy.tools
    case 'Triggers':
      return copy.triggers
    case 'Special':
      return copy.special
    default:
      return label
  }
}

export function translateWorkflowLabel(locale: LocaleCode, label: string): string {
  const copy = getWorkflowLabelCopy(locale)
  const normalizedLabel = normalizeWorkflowLabel(label)

  switch (normalizedLabel) {
    case 'System Prompt':
    case 'systemPrompt':
      return copy.systemPrompt
    case 'User Prompt':
    case 'userPrompt':
      return copy.userPrompt
    case 'Model':
    case 'model':
      return copy.model
    case 'API Key':
    case 'apiKey':
      return copy.apiKey
    case 'Tools':
    case 'tools':
      return copy.tools
    case 'Skills':
    case 'skills':
      return copy.skills
    case 'Response Format':
    case 'responseFormat':
      return copy.responseFormat
    case 'Reasoning Effort':
    case 'reasoningEffort':
      return copy.reasoningEffort
    case 'Verbosity':
    case 'verbosity':
      return copy.verbosity
    case 'Configured':
      return copy.configured
    case 'value':
      return copy.value
    case 'items':
      return copy.items
    case 'fields':
      return copy.fields
    case 'object':
      return copy.object
    case 'Block':
      return copy.block
    case 'Type':
      return copy.type
    case 'None':
      return copy.none
    case 'No values to display.':
      return copy.noValuesToDisplay
    case 'error':
      return copy.error
    case 'if':
      return copy.if
    case 'else':
      return copy.else
    case 'else if':
      return copy.elseIf
    case 'Add Skill':
      return copy.addSkill
    case 'Search skills...':
      return copy.searchSkills
    case 'Choose model':
      return copy.chooseModel
    case 'Lite':
      return copy.lite
    case 'Anthropic':
      return copy.anthropic
    case 'OpenAI':
      return copy.openai
    case 'Current Workflow':
      return copy.currentWorkflow
    case 'Current Skill':
      return copy.currentSkill
    case 'Current Tool':
      return copy.currentTool
    case 'Current Indicator':
      return copy.currentIndicator
    case 'Current MCP Server':
      return copy.currentMcpServer
    case 'Workflows':
      return copy.workflows
    case 'Custom Tools':
      return copy.customTools
    case 'Indicators':
      return copy.indicators
    case 'MCP Servers':
      return copy.mcpServers
    case 'All workflows':
      return copy.allWorkflows
    case 'Next Step':
      return copy.nextStep
    case 'Locked':
      return copy.locked
    case 'Deployed':
      return copy.deployed
    case 'Not Deployed':
      return copy.notDeployed
    case 'Disabled':
      return copy.disabled
    default:
      if (TEMPERATURE_LABEL_PATTERN.test(normalizedLabel)) {
        return normalizedLabel.replace(TEMPERATURE_LABEL_PATTERN, copy.temperature)
      }

      return label
  }
}

export function formatWorkflowTemplate(
  template: string,
  values: Record<string, string | number>
): string {
  return formatTemplate(template, values)
}
