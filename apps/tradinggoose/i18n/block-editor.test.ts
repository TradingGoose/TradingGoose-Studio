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

function collectObjectOptionOverridePaths(
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
        if (
          subBlockValue &&
          typeof subBlockValue === 'object' &&
          'options' in (subBlockValue as Record<string, any>) &&
          !Array.isArray((subBlockValue as Record<string, any>).options)
        ) {
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
          if (
            paramValue &&
            typeof paramValue === 'object' &&
            'options' in (paramValue as Record<string, any>) &&
            !Array.isArray((paramValue as Record<string, any>).options)
          ) {
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
        if (
          subBlockValue &&
          typeof subBlockValue === 'object' &&
          'options' in (subBlockValue as Record<string, any>) &&
          !Array.isArray((subBlockValue as Record<string, any>).options)
        ) {
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
  it('translates tools labels and strips trailing colons before lookup', () => {
    expect(translateWorkflowLabel('zh', 'Tools')).toBe('工具')
    expect(translateWorkflowLabel('zh', 'Response Format:')).toBe('响应格式')
  })

  it('translates webhook labels from the shared workflow label namespace', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'Webhook URL:')).toBe(esLabels.webhookUrl)
    expect(translateWorkflowLabel('es', 'Payload')).toBe(esLabels.payload)
    expect(translateWorkflowLabel('zh', 'signingSecret')).toBe(zhLabels.signingSecret)
    expect(translateWorkflowLabel('zh', 'Additional Headers')).toBe(zhLabels.additionalHeaders)
  })

  it('resolves shared workflow labels through the stable resolver', () => {
    expect(translateWorkflowLabel('es', 'System Prompt')).toBe('Prompt del sistema')
    expect(translateWorkflowLabel('zh', 'System Prompt')).toBe('系统提示词')
    expect(translateWorkflowLabel('es', 'Task')).toBe('Tarea')
    expect(translateWorkflowLabel('zh', 'Variables')).toBe('变量')
  })

  it('translates shared API block labels and stable aliases', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'URL:')).toBe(esLabels.url)
    expect(translateWorkflowLabel('es', 'Method')).toBe(esLabels.method)
    expect(translateWorkflowLabel('es', 'Query Params')).toBe(esLabels.queryParams)
    expect(translateWorkflowLabel('es', 'headers')).toBe(esLabels.headers)
    expect(translateWorkflowLabel('zh', 'Body')).toBe(zhLabels.body)
    expect(translateWorkflowLabel('zh', 'params')).toBe('params')
  })

  it('translates guardrails workflow labels from the shared namespace', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'Content to Validate')).toBe(esLabels.contentToValidate)
    expect(translateWorkflowLabel('es', 'Validation Type')).toBe(esLabels.validationType)
    expect(translateWorkflowLabel('zh', 'PII Types to Detect')).toBe(zhLabels.piiTypesToDetect)
    expect(translateWorkflowLabel('zh', 'Configure PII Types')).toBe(zhLabels.configurePiiTypes)
  })

  it('translates human in the loop workflow labels from the shared namespace', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'Display Data')).toBe(esLabels.displayData)
    expect(translateWorkflowLabel('es', 'Notification (Send URL)')).toBe(
      esLabels.notificationSendUrl
    )
    expect(translateWorkflowLabel('zh', 'Resume Form')).toBe(zhLabels.resumeForm)
  })

  it('translates shared knowledge workflow labels from the shared namespace', () => {
    expect(translateWorkflowLabel('es', 'Operation')).toBe('Operación')
    expect(translateWorkflowLabel('es', 'Search Query')).toBe('Consulta de búsqueda')
    expect(translateWorkflowLabel('zh', 'Number of Results')).toBe('结果数量')
  })

  it('translates landing workflow preview labels through the shared resolver', () => {
    expect(translateWorkflowLabel('es', 'Signal Briefing')).toBe('Resumen de señales')
    expect(translateWorkflowLabel('zh', 'Risk Committee')).toBe('风险委员会')
  })

  it('translates memory workflow labels from the shared namespace', () => {
    const esLabels = getPublicCopy('es').workspace.widgets.workflowLabels
    const zhLabels = getPublicCopy('zh').workspace.widgets.workflowLabels

    expect(translateWorkflowLabel('es', 'Role')).toBe(esLabels.role)
    expect(translateWorkflowLabel('es', 'Content')).toBe(esLabels.content)
    expect(translateWorkflowLabel('zh', 'ID')).toBe(zhLabels.id)
    expect(translateWorkflowLabel('zh', 'Add Memory')).toBe(zhLabels.addMemory)
  })

  it('resolves workflow inspector key paths directly', () => {
    expect(translateWorkflowLabel('es', 'workflowInspector.workflowEditor.previewInspector')).toBe(
      'Inspector de vista previa'
    )
    expect(translateWorkflowLabel('zh', 'workflowInspector.workflowLabels.systemPrompt')).toBe(
      '系统提示词'
    )
  })

  it('falls back to the source label when no shared workflow mapping exists', () => {
    expect(translateWorkflowLabel('es', 'Unmapped Workflow Label')).toBe('Unmapped Workflow Label')
  })

  it('localizes placeholders, titles, and static options through the shared config helper', () => {
    const localizedConfig = localizeWorkflowSubBlockConfig(
      'es',
      {
        id: 'validationType',
        title: 'Validation Type',
        type: 'dropdown',
        placeholder: 'Type or select a model...',
        options: [
          { id: 'json', label: 'Valid JSON' },
          { id: 'pii', label: 'PII Detection', group: 'Common' },
        ],
      },
      'guardrails'
    )

    expect(localizedConfig.title).toBe(
      getPublicCopy('es').workspace.widgets.workflowLabels.validationType
    )
    expect(localizedConfig.placeholder).toBe('Type or select a model...')
    expect(localizedConfig.options).toEqual([
      { id: 'json', label: translateWorkflowLabel('es', 'Valid JSON') },
      {
        id: 'pii',
        label: translateWorkflowLabel('es', 'PII Detection'),
        group: translateWorkflowLabel('es', 'Common'),
      },
    ])
  })

  it('resolves localized display values for guardrails option ids', () => {
    const config = {
      id: 'piiTypes',
      options: [
        { id: 'json', label: 'Valid JSON' },
        { id: 'PERSON', label: 'Person name' },
        { id: 'EMAIL_ADDRESS', label: 'Email address' },
      ],
    }

    expect(resolveWorkflowDisplayValue('es', config, 'json')).toBe(
      translateWorkflowLabel('es', 'Valid JSON')
    )
    expect(resolveWorkflowDisplayValue('zh', config, ['PERSON', 'EMAIL_ADDRESS'])).toEqual([
      translateWorkflowLabel('zh', 'Person name'),
      translateWorkflowLabel('zh', 'Email address'),
    ])
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

  it('localizes generated default names with numeric suffixes across locales', () => {
    const zhBlockNames = getPublicCopy('zh').workspace.widgets.blockEditor.blockNames
    const esBlockNames = getPublicCopy('es').workspace.widgets.blockEditor.blockNames

    expect(getLocalizedDefaultBlockName('zh', 'human_in_the_loop', 'Human in the Loop 1')).toBe(
      `${zhBlockNames.human_in_the_loop} 1`
    )
    expect(getLocalizedDefaultBlockName('zh', 'input_trigger', 'Formulario de entrada 2')).toBe(
      `${zhBlockNames.input_trigger} 2`
    )
    expect(getLocalizedDefaultBlockName('es', 'loop', 'Loop 3')).toBe(`${esBlockNames.loop} 3`)
    expect(getLocalizedDefaultBlockName('zh', 'parallel', 'Paralelo 4')).toBe(
      `${zhBlockNames.parallel} 4`
    )
  })

  it('keeps custom numbered block names intact when they do not match generated defaults', () => {
    expect(getLocalizedDefaultBlockName('zh', 'schedule', 'Quarterly Schedule 2')).toBe(
      'Quarterly Schedule 2'
    )
    expect(getLocalizedDefaultBlockName('es', 'agent', 'Analyst Review 7')).toBe('Analyst Review 7')
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

    expect(localizedSchema.title).toBe(translateWorkflowLabel('zh', 'Output Schema'))
    expect(localizedSchema.placeholder).toBe(
      translateWorkflowLabel('zh', 'Enter JSON schema...')
    )
  })

  it('localizes trigger-capable tool metadata through the shared block catalog', () => {
    expect(getLocalizedBlockMetadata('es', GitHubBlock)).toEqual({
      name: 'GitHub',
      description: 'Interactuar con GitHub o activar flujos desde eventos de GitHub',
      longDescription: GitHubBlock.longDescription,
    })

    expect(getLocalizedBlockMetadata('zh', GmailBlock)).toEqual({
      name: 'Gmail',
      description: getPublicCopy('zh').workspace.widgets.blockEditor.blockDescriptions.gmail,
      longDescription: GmailBlock.longDescription,
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

  it('stores block editor option overrides as arrays so external ids never become locale keys', () => {
    expect([
      ...collectObjectOptionOverridePaths(enCopy as Record<string, any>, 'en'),
      ...collectObjectOptionOverridePaths(esCopy as Record<string, any>, 'es'),
      ...collectObjectOptionOverridePaths(zhCopy as Record<string, any>, 'zh'),
    ]).toEqual([])
  })

  it('localizes dotted option ids through array-based option overrides', () => {
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
    const fallbackInstruction = 'inline fallback instructions'
    const localizedIndicatorInstructions = localizeWorkflowSubBlockConfig(
      'es',
      {
        id: 'triggerInstructions',
        title: 'Setup Instructions',
        type: 'text',
        defaultValue: fallbackInstruction,
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
        defaultValue: fallbackInstruction,
      },
      undefined,
      'portfolio_state_trigger'
    )

    expect(localizedIndicatorInstructions.defaultValue).toContain(
      'gestionar los monitores de indicadores'
    )
    expect(localizedIndicatorInstructions.defaultValue).not.toContain(fallbackInstruction)
    expect(localizedPortfolioInstructions.defaultValue).toContain('投资组合监控')
    expect(localizedPortfolioInstructions.defaultValue).not.toContain(fallbackInstruction)
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
