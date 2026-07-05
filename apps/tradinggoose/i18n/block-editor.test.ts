import { describe, expect, it } from 'vitest'
import { GitHubBlock } from '@/blocks/blocks/github'
import { GmailBlock } from '@/blocks/blocks/gmail'
import { InputTriggerBlock } from '@/triggers/blocks/input_trigger'
import { PortfolioStateTriggerBlock } from '@/triggers/blocks/portfolio_state_trigger'
import { apiTrigger } from '@/triggers/core/api'
import { genericWebhookTrigger } from '@/triggers/generic/webhook'
import { scheduleTrigger } from '@/triggers/schedule/trigger'
import {
  getLocalizedBlockMetadata,
  getLocalizedDefaultBlockName,
  getLocalizedToolParametersConfig,
  getLocalizedTriggerMetadata,
  getTriggerSubBlockCopy,
  localizeToolParameter,
  localizeWorkflowSubBlockConfig,
  resolveWorkflowDisplayValue,
  translateWorkflowLabel,
} from './block-editor'
import enCopy from './messages/en.json'
import esCopy from './messages/es.json'
import zhCopy from './messages/zh.json'
import { getPublicCopy } from './public-copy'

function collectNonArrayOptionOverridePaths(
  localeCopy: Record<string, any>,
  locale: string
): string[] {
  const invalidPaths: string[] = []
  const blockEditor = localeCopy.workspace?.widgets?.blockEditor

  const visitSubBlockCollection = (
    collection: Record<string, any> | undefined,
    basePath: string
  ) => {
    if (!collection || typeof collection !== 'object') {
      return
    }

    for (const [entryId, entryValue] of Object.entries(collection)) {
      if (!entryValue || typeof entryValue !== 'object') {
        continue
      }

      for (const [subBlockId, subBlockValue] of Object.entries(entryValue as Record<string, any>)) {
        if (!subBlockValue || typeof subBlockValue !== 'object') {
          continue
        }
        const options = (subBlockValue as Record<string, any>)?.options
        if ('options' in (subBlockValue as Record<string, any>) && !Array.isArray(options)) {
          invalidPaths.push(`${locale}:${basePath}.${entryId}.${subBlockId}.options`)
        }
      }
    }
  }

  visitSubBlockCollection(blockEditor?.subBlocks, 'workspace.widgets.blockEditor.subBlocks')

  if (blockEditor?.toolParameters && typeof blockEditor.toolParameters === 'object') {
    for (const [blockType, toolCollection] of Object.entries(blockEditor.toolParameters)) {
      if (!toolCollection || typeof toolCollection !== 'object') {
        continue
      }

      for (const [toolId, parameterCollection] of Object.entries(
        toolCollection as Record<string, any>
      )) {
        if (!parameterCollection || typeof parameterCollection !== 'object') {
          continue
        }

        for (const [paramId, paramValue] of Object.entries(
          parameterCollection as Record<string, any>
        )) {
          if (!paramValue || typeof paramValue !== 'object') {
            continue
          }
          const options = (paramValue as Record<string, any>)?.options
          if ('options' in (paramValue as Record<string, any>) && !Array.isArray(options)) {
            invalidPaths.push(
              `${locale}:workspace.widgets.blockEditor.toolParameters.${blockType}.${toolId}.${paramId}.options`
            )
          }
        }
      }
    }
  }

  if (blockEditor?.triggers && typeof blockEditor.triggers === 'object') {
    for (const [triggerId, triggerValue] of Object.entries(blockEditor.triggers)) {
      const subBlocks = (triggerValue as Record<string, any>)?.subBlocks
      if (!subBlocks || typeof subBlocks !== 'object') {
        continue
      }

      for (const [subBlockId, subBlockValue] of Object.entries(subBlocks as Record<string, any>)) {
        if (!subBlockValue || typeof subBlockValue !== 'object') {
          continue
        }
        const options = (subBlockValue as Record<string, any>)?.options
        if ('options' in (subBlockValue as Record<string, any>) && !Array.isArray(options)) {
          invalidPaths.push(
            `${locale}:workspace.widgets.blockEditor.triggers.${triggerId}.subBlocks.${subBlockId}.options`
          )
        }
      }
    }
  }

  return invalidPaths
}

describe('block-editor i18n helpers', () => {
  it('translates workflow labels by canonical key', () => {
    expect(translateWorkflowLabel('zh', 'tools')).toBe('工具')
    expect(translateWorkflowLabel('zh', 'responseFormat')).toBe('响应格式')
  })

  it('translates webhook labels from the shared workflow label namespace', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'webhookUrl')).toBe(esLabels.webhookUrl)
    expect(translateWorkflowLabel('es', 'payload')).toBe(esLabels.payload)
    expect(translateWorkflowLabel('zh', 'signingSecret')).toBe(zhLabels.signingSecret)
    expect(translateWorkflowLabel('zh', 'additionalHeaders')).toBe(zhLabels.additionalHeaders)
  })

  it('resolves shared workflow labels through canonical keys', () => {
    expect(translateWorkflowLabel('es', 'systemPrompt')).toBe('Prompt del sistema')
    expect(translateWorkflowLabel('zh', 'systemPrompt')).toBe('系统提示词')
  })

  it('translates shared API block labels by canonical key', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'method')).toBe(esLabels.method)
    expect(translateWorkflowLabel('es', 'queryParams')).toBe(esLabels.queryParams)
    expect(translateWorkflowLabel('es', 'headers')).toBe(esLabels.headers)
    expect(translateWorkflowLabel('zh', 'body')).toBe(zhLabels.body)
  })

  it('keeps localized workflow watchlist block copy read-only', () => {
    const copies = [
      getPublicCopy('en').workspace.widgets.blockEditor.blockDescriptions.watchlist,
      getPublicCopy('es').workspace.widgets.blockEditor.blockDescriptions.watchlist,
      getPublicCopy('zh').workspace.widgets.blockEditor.blockDescriptions.watchlist,
    ]

    expect(copies[0]).toContain('Read')
    expect(copies[1]).toContain('Lee')
    expect(copies[2]).toContain('读取')
    for (const copy of copies) {
      expect(copy).not.toMatch(/add|remove|agrega|elimina|添加|移除/i)
    }
  })

  it('keeps guardrails block copy in the block editor catalog', () => {
    const esGuardrails = getPublicCopy('es').workspace.widgets.blockEditor.subBlocks.guardrails
    const zhGuardrails = getPublicCopy('zh').workspace.widgets.blockEditor.subBlocks.guardrails
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(esGuardrails.input.title).toBe('Contenido a validar')
    expect(esGuardrails.validationType.title).toBe('Tipo de validación')
    expect(zhGuardrails.piiEntityTypes.title).toBe('要检测的 PII 类型')
    expect(translateWorkflowLabel('zh', 'configurePiiTypes')).toBe(zhLabels.configurePiiTypes)
  })

  it('translates human in the loop workflow labels from the shared namespace', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'displayData')).toBe(esLabels.displayData)
    expect(translateWorkflowLabel('es', 'notificationSendUrl')).toBe(esLabels.notificationSendUrl)
    expect(translateWorkflowLabel('zh', 'resumeForm')).toBe(zhLabels.resumeForm)
  })

  it('translates shared knowledge workflow labels from the shared namespace', () => {
    expect(translateWorkflowLabel('es', 'operation')).toBe('Operación')
    expect(translateWorkflowLabel('es', 'searchQuery')).toBe('Consulta de búsqueda')
    expect(translateWorkflowLabel('zh', 'numberOfResults')).toBe('结果数量')
  })

  it('translates landing workflow preview labels through the shared resolver', () => {
    expect(translateWorkflowLabel('es', 'signalBriefing')).toBe('Resumen de señales')
    expect(translateWorkflowLabel('zh', 'riskCommittee')).toBe('风险委员会')
  })

  it('translates memory workflow labels from the shared namespace', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'role')).toBe(esLabels.role)
    expect(translateWorkflowLabel('es', 'content')).toBe(esLabels.content)
    expect(translateWorkflowLabel('zh', 'id')).toBe(zhLabels.id)
    expect(translateWorkflowLabel('zh', 'addMemory')).toBe(zhLabels.addMemory)
  })

  it('resolves workflow inspector key paths directly', () => {
    expect(translateWorkflowLabel('es', 'workflowInspector.workflowEditor.previewInspector')).toBe(
      'Inspector de vista previa'
    )
    expect(translateWorkflowLabel('zh', 'workflowInspector.workflowLabels.systemPrompt')).toBe(
      '系统提示词'
    )
  })

  it('throws when a workflow label key is missing', () => {
    expect(() => translateWorkflowLabel('es', 'Unmapped Workflow Label')).toThrow(
      'Missing workflow label translation'
    )
  })

  it('localizes titles and static options through block editor overrides', () => {
    const localizedConfig = localizeWorkflowSubBlockConfig(
      'es',
      {
        id: 'validationType',
        title: 'Validation Type',
        type: 'dropdown',
        placeholder: 'Type or select a model...',
        options: [
          { id: 'json', label: 'Valid JSON' },
          {
            id: 'pii',
            label: 'PII Detection',
            group: 'Common',
          },
        ],
      },
      'guardrails'
    )

    const guardrailsCopy = getPublicCopy('es').workspace.widgets.blockEditor.subBlocks.guardrails
    expect(localizedConfig.title).toBe(guardrailsCopy.validationType.title)
    expect(localizedConfig.placeholder).toBe('Type or select a model...')
    const localizedOptions =
      typeof localizedConfig.options === 'function'
        ? localizedConfig.options()
        : localizedConfig.options
    expect(
      localizedOptions?.map((option) => ({
        id: option.id,
        label: option.label,
        group: option.group,
      }))
    ).toEqual([
      { id: 'json', label: 'JSON válido', group: undefined },
      {
        id: 'pii',
        label: 'Detección de PII',
        group: 'Common',
      },
    ])
  })

  it('resolves localized display values for guardrails option ids', () => {
    const config = {
      id: 'piiEntityTypes',
      options: [
        { id: 'PERSON', label: 'Person name', group: 'Common' },
        { id: 'EMAIL_ADDRESS', label: 'Email address', group: 'Common' },
      ],
    }

    expect(
      resolveWorkflowDisplayValue('zh', config, ['PERSON', 'EMAIL_ADDRESS'], 'guardrails')
    ).toEqual(['姓名', '电子邮箱'])
  })

  it('localizes trigger and subflow names through stable block-type keys', () => {
    expect(getLocalizedDefaultBlockName('es', 'input_trigger')).toBe('Formulario de entrada')
    expect(getLocalizedDefaultBlockName('zh', 'schedule')).toBe(
      getPublicCopy('zh').workspace.widgets.blockEditor.blockNames.schedule
    )
    expect(getLocalizedDefaultBlockName('zh', 'loop')).toBe('循环')
  })

  it('keeps custom block names intact for deploy-modal tab labels when the stored name differs from the registry default', () => {
    expect(getLocalizedDefaultBlockName('es', 'schedule', 'Custom Schedule')).toBe(
      'Custom Schedule'
    )
    expect(getLocalizedDefaultBlockName('zh', 'parallel_ai', 'Parallel AI Custom')).toBe(
      'Parallel AI Custom'
    )
  })

  it('localizes canonical generated default names with numeric suffixes', () => {
    const zhBlockNames = getPublicCopy('zh').workspace.widgets.blockEditor.blockNames
    const esBlockNames = getPublicCopy('es').workspace.widgets.blockEditor.blockNames

    expect(getLocalizedDefaultBlockName('zh', 'human_in_the_loop', 'Human in the Loop 1')).toBe(
      `${zhBlockNames.human_in_the_loop} 1`
    )
    expect(getLocalizedDefaultBlockName('es', 'loop', 'Loop 3')).toBe(`${esBlockNames.loop} 3`)
  })

  it('keeps custom numbered block names intact when they do not match generated defaults', () => {
    expect(getLocalizedDefaultBlockName('zh', 'schedule', 'Quarterly Schedule 2')).toBe(
      'Quarterly Schedule 2'
    )
    expect(getLocalizedDefaultBlockName('es', 'agent', 'Analyst Review 7')).toBe('Analyst Review 7')
    expect(getLocalizedDefaultBlockName('zh', 'input_trigger', 'Formulario de entrada 2')).toBe(
      'Formulario de entrada 2'
    )
    expect(getLocalizedDefaultBlockName('zh', 'parallel', 'Paralelo 4')).toBe('Paralelo 4')
  })

  it('localizes block metadata and stagehand editor copy through the shared catalog', () => {
    expect(
      getLocalizedBlockMetadata('es', {
        type: 'api_trigger',
        name: 'API',
        description: 'Expose as HTTP API endpoint',
      })
    ).toEqual({
      name: 'API',
      description: 'Expone el flujo como un endpoint HTTP API',
      longDescription: undefined,
    })

    const agentMetadata = getLocalizedBlockMetadata('es', {
      type: 'agent',
      name: 'Agent',
      description: 'Build an agent',
      longDescription:
        'The Agent block is a core workflow block that is a wrapper around an LLM. It takes in system/user prompts and calls an LLM provider. It can also make tool calls by directly containing tools inside of its tool input. It can additionally return structured output.',
    })

    expect(agentMetadata.name).toBe('Agente')
    expect(agentMetadata.description).toBe('Crear un agente')
    expect(agentMetadata.longDescription).toContain('envoltorio para un LLM')
    expect(agentMetadata.longDescription).toContain('salida estructurada')

    const stagehandMetadata = getLocalizedBlockMetadata('es', {
      type: 'stagehand',
      name: 'Stagehand Extract',
      description: 'Extract data from websites',
      longDescription:
        'Integrate Stagehand into the workflow. Can extract structured data from webpages.',
    })

    expect(stagehandMetadata.name).toBe('Extracción de Stagehand')
    expect(stagehandMetadata.description).toBe('Extraer datos de sitios web')
    expect(stagehandMetadata.longDescription).toContain('datos estructurados de páginas web')

    const stagehandAgentMetadata = getLocalizedBlockMetadata('zh', {
      type: 'stagehand_agent',
      name: 'Stagehand Agent',
      description: 'Autonomous web browsing agent',
      longDescription:
        'Integrate Stagehand Agent into the workflow. Can navigate the web and perform tasks.',
    })

    expect(stagehandAgentMetadata.name).toBe(
      getPublicCopy('zh').workspace.widgets.blockEditor.blockNames.stagehand_agent
    )
    expect(stagehandAgentMetadata.description).toBe('自主网页浏览代理')
    expect(stagehandAgentMetadata.longDescription).toContain('浏览网页并执行任务')
  })

  it('localizes the previously uncovered toolbar block and trigger entries through block metadata overrides', () => {
    const previouslyUncoveredTypes = [
      'api',
      'condition',
      'function',
      'guardrails',
      'human_in_the_loop',
      'knowledge',
      'memory',
      'note',
      'router',
      'webhook_request',
      'indicator_trigger',
      'imap',
      'rss',
    ] as const

    for (const locale of ['es', 'zh'] as const) {
      const blockEditorCopy = getPublicCopy(locale).workspace.widgets.blockEditor

      for (const type of previouslyUncoveredTypes) {
        expect(getLocalizedDefaultBlockName(locale, type)).toBe(blockEditorCopy.blockNames[type])

        expect(
          getLocalizedBlockMetadata(locale, {
            type,
            name: `Fallback ${type}`,
            description: `Fallback description ${type}`,
            longDescription: '',
          })
        ).toMatchObject({
          name: blockEditorCopy.blockNames[type],
          description: blockEditorCopy.blockDescriptions[type],
        })
      }
    }
  })

  it('localizes stagehand agent sub-block copy through the shared config helper', () => {
    const localizedTask = localizeWorkflowSubBlockConfig(
      'es',
      {
        id: 'task',
        title: 'Task',
        type: 'long-input',
        placeholder:
          'Enter the task or goal for the agent to achieve. Reference variables using %key% syntax.',
      },
      'stagehand_agent'
    )

    expect(localizedTask.title).toBe('Tarea')
    expect(localizedTask.placeholder).toBe(
      'Introduce la tarea u objetivo que el agente debe lograr. Haz referencia a variables usando la sintaxis %key%.'
    )

    const localizedVariables = localizeWorkflowSubBlockConfig(
      'zh',
      {
        id: 'variables',
        title: 'Variables',
        type: 'table',
        columns: ['Key', 'Value'],
      },
      'stagehand_agent'
    )

    expect(localizedVariables.title).toBe('变量')
    expect(localizedVariables.columns).toEqual(['键', '值'])

    const localizedStartUrl = localizeWorkflowSubBlockConfig(
      'es',
      {
        id: 'startUrl',
        title: 'Starting URL',
        type: 'short-input',
        placeholder: 'Enter the starting URL for the agent',
      },
      'stagehand_agent'
    )

    expect(localizedStartUrl.title).toBe('URL de inicio')
    expect(localizedStartUrl.placeholder).toBe('Introduce la URL de inicio del agente')

    const localizedApiKey = localizeWorkflowSubBlockConfig(
      'es',
      {
        id: 'apiKey',
        title: 'Anthropic API Key',
        type: 'short-input',
        placeholder: 'Enter your Anthropic API key',
      },
      'stagehand_agent'
    )

    expect(localizedApiKey.title).toBe('Clave de API de Anthropic')
    expect(localizedApiKey.placeholder).toBe('Introduce tu clave de API de Anthropic')

    const localizedSchema = localizeWorkflowSubBlockConfig(
      'zh',
      {
        id: 'outputSchema',
        title: 'Output Schema',
        type: 'code',
        placeholder: 'Enter JSON schema...',
      },
      'stagehand_agent'
    )

    expect(localizedSchema.title).toBe('输出架构')
    expect(localizedSchema.placeholder).toBe('输入 JSON 模式...')
  })

  it('localizes trigger-capable tool metadata through the shared block catalog', () => {
    expect(getLocalizedBlockMetadata('es', GitHubBlock)).toEqual({
      name: 'GitHub',
      description: 'Interactuar con GitHub o activar flujos desde eventos de GitHub',
      longDescription: undefined,
    })

    expect(getLocalizedBlockMetadata('zh', GmailBlock)).toEqual({
      name: 'Gmail',
      description: getPublicCopy('zh').workspace.widgets.blockEditor.blockDescriptions.gmail,
      longDescription: undefined,
    })
  })

  it('localizes Gmail tool parameter overrides through the centralized toolParameters catalog', () => {
    const esReadConfig = getLocalizedToolParametersConfig('es', 'gmail_read', GmailBlock)
    const esFolderParam = esReadConfig?.userInputParameters.find((param) => param.id === 'folder')
    const esMessageIdParam = esReadConfig?.userInputParameters.find(
      (param) => param.id === 'messageId'
    )

    expect(esFolderParam?.uiComponent?.title).toBe('Etiqueta')
    expect(esFolderParam?.uiComponent?.placeholder).toBe('Selecciona la etiqueta/carpeta de Gmail')
    expect(esMessageIdParam?.uiComponent?.title).toBe('ID del mensaje')
    expect(esMessageIdParam?.uiComponent?.placeholder).toBe(
      'Introduce el ID del mensaje que quieres leer (opcional)'
    )

    const zhSendConfig = getLocalizedToolParametersConfig('zh', 'gmail_send', GmailBlock)
    const zhToParam = zhSendConfig?.userInputParameters.find((param) => param.id === 'to')
    const zhBodyParam = zhSendConfig?.userInputParameters.find((param) => param.id === 'body')

    expect(zhToParam?.uiComponent?.title).toBe('收件人')
    expect(zhToParam?.uiComponent?.placeholder).toBe('收件人邮箱地址')
    expect(zhBodyParam?.uiComponent?.title).toBe('正文')
    expect(zhBodyParam?.uiComponent?.placeholder).toBe('邮件内容')
  })

  it('localizes built-in tool parameters through shared block subBlock overrides', () => {
    const localizedApifyInput = localizeToolParameter(
      'es',
      {
        id: 'input',
        type: 'string',
        description: 'Actor input as JSON string',
        uiComponent: {
          type: 'code',
          subBlockId: 'input',
          title: 'Actor Input',
          placeholder: '{\n  "startUrl": "https://example.com",\n  "maxPages": 10\n}',
        },
      },
      'apify'
    )
    const localizedApifyBuild = localizeToolParameter(
      'es',
      {
        id: 'build',
        type: 'string',
        description: 'Actor build version',
        uiComponent: {
          type: 'short-input',
          subBlockId: 'build',
          title: 'Build',
          placeholder: 'Actor build (e.g., "latest", "beta", or build tag)',
        },
      },
      'apify'
    )

    expect(localizedApifyInput.uiComponent?.title).toBe('Entrada del actor')
    expect(localizedApifyInput.uiComponent?.placeholder).toContain('https://example.com')
    expect(localizedApifyBuild.uiComponent?.title).toBe('Compilación')
    expect(localizedApifyBuild.uiComponent?.placeholder).toContain('latest')
  })

  it('stores block editor option overrides as arrays so arbitrary ids remain message values', () => {
    expect([
      ...collectNonArrayOptionOverridePaths(enCopy as Record<string, any>, 'en'),
      ...collectNonArrayOptionOverridePaths(esCopy as Record<string, any>, 'es'),
      ...collectNonArrayOptionOverridePaths(zhCopy as Record<string, any>, 'zh'),
    ]).toEqual([])
  })

  it('localizes dotted option ids through array option overrides', () => {
    const localizedBrowserModel = localizeWorkflowSubBlockConfig(
      'en',
      {
        id: 'model',
        title: 'Model',
        type: 'dropdown',
        options: [{ id: 'gpt-4.1', label: 'Fallback model label' }],
      },
      'browser_use'
    )

    expect(localizedBrowserModel.options).toContainEqual({
      id: 'gpt-4.1',
      label: 'GPT-4.1',
    })

    const localizedStripeEvents = localizeWorkflowSubBlockConfig(
      'en',
      {
        id: 'eventTypes',
        title: 'Event Types',
        type: 'dropdown',
        options: [{ id: 'payment_intent.succeeded', label: 'Fallback event label' }],
      },
      'stripe',
      'stripe_webhook'
    )

    expect(localizedStripeEvents.options).toContainEqual({
      id: 'payment_intent.succeeded',
      label: 'payment_intent.succeeded',
    })
  })

  it('localizes trigger metadata through the centralized trigger catalog', () => {
    expect(
      getLocalizedTriggerMetadata('en', {
        id: 'calendly_webhook',
        name: 'Fallback Calendly Trigger',
        description: 'Fallback description',
      })
    ).toEqual({
      name: 'Calendly Webhook',
      description: 'Trigger workflow from any Calendly webhook event',
    })
  })

  it('formats trigger instruction content from locale-defined steps', () => {
    const localizedInstructions = localizeWorkflowSubBlockConfig(
      'en',
      {
        id: 'triggerInstructions',
        title: 'Setup Instructions',
        type: 'text',
        defaultValue: 'inline fallback instructions',
      },
      'github',
      'github_webhook'
    )

    expect(typeof localizedInstructions.defaultValue).toBe('string')
    expect(localizedInstructions.defaultValue).toContain('Go to your GitHub Repository')
    expect(localizedInstructions.defaultValue).toContain('Payload URL')
    expect(
      getTriggerSubBlockCopy('en', 'github_webhook', 'triggerInstructions')?.steps?.length
    ).toBeGreaterThan(0)
  })

  it('localizes monitor trigger instructions through centralized trigger override entries', () => {
    const inlineInstruction = 'inline instructions'
    const localizedIndicatorInstructions = localizeWorkflowSubBlockConfig(
      'es',
      {
        id: 'triggerInstructions',
        title: 'Setup Instructions',
        type: 'text',
        defaultValue: inlineInstruction,
      },
      undefined,
      'indicator_trigger'
    )
    const localizedPortfolioInstructions = localizeWorkflowSubBlockConfig(
      'zh',
      {
        id: 'triggerInstructions',
        title: 'Setup Instructions',
        type: 'text',
        defaultValue: inlineInstruction,
      },
      undefined,
      'portfolio_state_trigger'
    )

    expect(localizedIndicatorInstructions.defaultValue).toContain(
      'gestionar los monitores de indicadores'
    )
    expect(localizedIndicatorInstructions.defaultValue).not.toContain(inlineInstruction)
    expect(localizedPortfolioInstructions.defaultValue).toContain('投资组合监控')
    expect(localizedPortfolioInstructions.defaultValue).not.toContain(inlineInstruction)
  })

  it('prefers trigger metadata names over inline selectedTriggerId labels', () => {
    const localizedTriggerSelector = localizeWorkflowSubBlockConfig(
      'en',
      {
        id: 'selectedTriggerId',
        title: 'Trigger Type',
        type: 'dropdown',
        options: [{ id: 'calendly_webhook', label: 'General Webhook (All Events)' }],
      },
      'calendly'
    )

    expect(localizedTriggerSelector.options).toEqual([
      { id: 'calendly_webhook', label: 'Calendly Webhook' },
    ])
  })

  it('localizes portfolio trigger block metadata through centralized block editor copy', () => {
    expect(getLocalizedBlockMetadata('es', PortfolioStateTriggerBlock)).toEqual({
      name: 'Monitor de portafolio',
      description:
        'Activa el flujo de trabajo desde eventos del monitor de portafolio gestionados en el espacio de monitoreo.',
      longDescription: undefined,
    })
  })

  it('localizes trigger-only block copy through trigger override entries', () => {
    const localizedApiInputFormat = localizeWorkflowSubBlockConfig(
      'es',
      apiTrigger.subBlocks[0]!,
      undefined,
      'api'
    )
    const localizedGenericWebhookUrl = localizeWorkflowSubBlockConfig(
      'es',
      genericWebhookTrigger.subBlocks[0]!,
      undefined,
      'generic_webhook'
    )
    const localizedScheduleType = localizeWorkflowSubBlockConfig(
      'zh',
      scheduleTrigger.subBlocks[0]!,
      undefined,
      'schedule'
    )
    const localizedInputTriggerFormat = localizeWorkflowSubBlockConfig(
      'es',
      InputTriggerBlock.subBlocks.find((subBlock) => subBlock.id === 'inputFormat')!,
      'input_trigger'
    )

    expect(localizedApiInputFormat.title).toBe('Formato de entrada')
    expect(localizedApiInputFormat.description).toContain('endpoint de la API')
    expect(localizedGenericWebhookUrl.title).toBe('URL del webhook')
    expect(localizedGenericWebhookUrl.placeholder).toBe('Se generará la URL del webhook')
    expect(localizedScheduleType.title).toBe('运行频率')
    const localizedScheduleTypeOptions =
      typeof localizedScheduleType.options === 'function'
        ? localizedScheduleType.options()
        : localizedScheduleType.options

    expect(localizedScheduleTypeOptions?.map((option) => option.label)).toEqual([
      '每隔 X 分钟',
      '每小时',
      '每天',
      '每周',
      '每月',
      '自定义 Cron',
    ])
    expect(localizedInputTriggerFormat.title).toBe('Formato de entrada')
    expect(localizedInputTriggerFormat.description).toContain('se ejecuta manualmente')
  })
})
