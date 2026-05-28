import { describe, expect, it } from 'vitest'
import { registry } from '@/blocks/registry'
import {
  DRAW_ACTION_ICONS,
  DRAW_TOOL_ICONS,
} from '@/widgets/widgets/data_chart/components/draw-tool-icon-registry'
import { CANDLE_TYPE_OPTIONS } from '@/widgets/widgets/data_chart/options'
import { DEFAULT_RANGE_PRESETS } from '@/widgets/widgets/data_chart/series-data'
import { formatTemplate, getPublicCopy, getScopedPublicMessages } from './public-copy'

function normalizeShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeShape(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, normalizeShape((value as Record<string, unknown>)[key])])
    )
  }

  return null
}

const toolbarVisibleBlockTypes = [...new Set(
  Object.values(registry)
    .filter((block) => !block.hideFromToolbar)
    .map((block) => block.type)
    .filter((type): type is string => typeof type === 'string')
)].sort()

describe('public copy', () => {
  it('loads translated locale files directly', () => {
    expect(getPublicCopy('en').meta.landing.title).toContain('TradingGoose')
    expect(getPublicCopy('es').blog.readTimeSuffix).toBe('min de lectura')
    expect(getPublicCopy('zh-CN').meta.landing.seo.socialPreviewAlt).toContain('TradingGoose')
  })

  it('scopes public messages to the requested namespaces', () => {
    const fullCopy = getPublicCopy('en')
    const scopedCopy = getScopedPublicMessages('en', ['nav', 'registration'] as const)
    const serializedCopy = JSON.parse(JSON.stringify(scopedCopy)) as Record<string, unknown>

    expect(Object.keys(scopedCopy).sort()).toEqual(['nav', 'registration'])
    expect(scopedCopy.nav).toBe(fullCopy.nav)
    expect(scopedCopy.registration).toBe(fullCopy.registration)
    expect('auth' in serializedCopy).toBe(false)
  })

  it('keeps zh-CN auth copy translated', () => {
    const zhCopy = getPublicCopy('zh-CN')
    const enCopy = getPublicCopy('en')

    expect(zhCopy.auth.common.signIn).toBe('登录')
    expect(zhCopy.auth.common.signUp).toBe('注册')
    expect(zhCopy.auth.login.submit).toBe('登录')
    expect(zhCopy.auth.signup.submit).toBe('创建账户')
    expect(zhCopy.auth.waitlist.submit).not.toBe(enCopy.auth.waitlist.submit)
    expect(zhCopy.auth.note.waitlistApprovedEmail).not.toBe(enCopy.auth.note.waitlistApprovedEmail)
    expect(zhCopy.auth.common.signIn).not.toBe(enCopy.auth.common.signIn)
    expect(zhCopy.auth.login.submit).not.toBe(enCopy.auth.login.submit)
  })

  it('includes localized public navigation and landing pricing copy', () => {
    expect(getPublicCopy('en').nav.primaryNavigation).toBe('Primary navigation')
    expect(getPublicCopy('es').nav.homeAriaLabel).toContain('Inicio')
    expect(getPublicCopy('zh-CN').nav.githubRepositoryAriaLabel).toContain('星')
    expect(getPublicCopy('en').landing.hero.logoAlt).toBe('TradingGoose logo')
    expect(getPublicCopy('es').landing.pricing.contactSales).toBe('Contactar ventas')
    expect(getPublicCopy('en').landing.preview.indicatorDropdown.tooltip).toBe('Select indicators')
    expect(getPublicCopy('es').landing.pricing.customPrice).toBe('Personalizado')
    expect(getPublicCopy('zh-CN').landing.pricing.ariaLabel).toBe('定价')
  })

  it('includes localized landing workflow preview demo copy', () => {
    expect(
      getPublicCopy('en').landing.preview.workflow.demoCopy.signalBriefing.triggerInstructions
    ).toContain('NVDA')
    expect(getPublicCopy('es').landing.preview.workflow.demoCopy.investmentDebate.notionTitle).toBe(
      'Memorando del comité de inversión'
    )
    expect(
      getPublicCopy('zh-CN').landing.preview.workflow.demoCopy.riskRouting.webhookNote
    ).toContain('风险系统')
  })

  it('includes localized blog and not found copy', () => {
    expect(getPublicCopy('en').blog.shareTitle).toBe('Share This Article')
    expect(getPublicCopy('es').blog.tableOfContents).toBe('En esta página')
    expect(getPublicCopy('zh-CN').blog.readTimeSuffix).toBe('分钟阅读')
    expect(getPublicCopy('en').notFound.returnHome).toBe('Return to Home')
    expect(getPublicCopy('zh-CN').notFound.supportLinkLabel).toBe('联系支持')
  })

  it('includes localized chat and admin copy', () => {
    expect(getPublicCopy('en').chat.header.titleFallback).toBe('TradingGoose Chat')
    expect(getPublicCopy('es').chat.errors.chatUnavailable).toBe('Este chat no está disponible.')
    expect(getPublicCopy('zh-CN').chat.auth.email.submit).toBe('发送验证码')
    expect(getPublicCopy('en').admin.home.badge).toBe('Admin')
    expect(getPublicCopy('es').admin.systemSettings.save).toBe('Guardar configuración del sistema')
    expect(getPublicCopy('zh-CN').admin.home.cards.registration.action).toBe('打开')
    expect(getPublicCopy('en').admin.systemSettings.errors.triggerNotReady).toContain(
      'TRIGGER_PROJECT_ID'
    )
    expect(getPublicCopy('en').admin.registration.loading).toBe('Loading registration settings...')
    expect(getPublicCopy('es').admin.services.footer.ready).toContain('guardan')
    expect(getPublicCopy('zh-CN').admin.integrations.title).toBe('系统管理的 OAuth')
  })

  it('includes localized legal copy', () => {
    expect(getPublicCopy('en').meta.terms.title).toBe('Terms of Service | TradingGoose')
    expect(getPublicCopy('es').meta.licenses.title).toBe('Licencias y avisos | TradingGoose')
    expect(getPublicCopy('zh-CN').meta.careers.title).toBe('招聘 | TradingGoose')
    expect(getPublicCopy('en').legal.common.lastUpdatedLabel).toBe('Last updated:')
    expect(getPublicCopy('es').legal.terms.title).toBe('Términos del servicio')
    expect(getPublicCopy('zh-CN').legal.privacy.title).toBe('隐私政策')
  })

  it('includes localized careers and changelog copy', () => {
    expect(getPublicCopy('en').careers.pageTitle).toBe('Join Our Team')
    expect(getPublicCopy('es').careers.form.actions.submit).toBe('Enviar solicitud')
    expect(getPublicCopy('zh-CN').careers.form.helpers.contactPrefix).toContain('邮件至')
    expect(getPublicCopy('en').careers.form.helpers.contactEmail).toBe('careers@tradinggoose.ai')
    expect(getPublicCopy('en').changelog.pageTitle).toBe('Changelog')
    expect(getPublicCopy('en').changelog.showMore).toBe('Show more')
    expect(getPublicCopy('es').changelog.viewOnGitHub).toBe('Ver en GitHub')
    expect(getPublicCopy('zh-CN').changelog.rssFeed).toContain('RSS')
  })

  it('includes translated verify-email auth copy', () => {
    expect(getPublicCopy('en').auth.common.verifyEmail).toBe('Verify email')
    expect(getPublicCopy('es').auth.common.verifyEmail).toBe('Verificar correo electrónico')
    expect(getPublicCopy('zh-CN').auth.common.verifyEmail).not.toBe(
      getPublicCopy('en').auth.common.verifyEmail
    )
    expect(getPublicCopy('en').auth.common.loading).toBe('Loading...')
  })

  it('includes localized verification screen copy', () => {
    expect(getPublicCopy('en').auth.verify.pendingTitle).toBe('Verify Your Email')
    expect(getPublicCopy('en').auth.verify.resendIn).toBe('Resend in {{countdown}}s')
    expect(getPublicCopy('es').auth.verify.verifyButton).toBe('Verificar correo')
    expect(getPublicCopy('es').auth.verify.errors.resendFailed).toContain('reenviar')
    expect(getPublicCopy('zh-CN').auth.verify.instructionsWithoutService).toBe(
      '输入6位验证码以验证您的账户。'
    )
    expect(getPublicCopy('zh-CN').auth.verify.yourEmail).toBe('您的邮箱')
  })

  it('includes localized workspace copy', () => {
    expect(getPublicCopy('en').workspace.defaults.defaultLayoutName).toBe('Default Layout')
    expect(getPublicCopy('zh-CN').workspace.defaults.newWorkspaceName).toBe('我的工作区')
    expect(getPublicCopy('en').workspace.naming.workspacePrefix).toBe('Workspace')
    expect(getPublicCopy('es').workspace.naming.folderPrefix).toBe('Carpeta')
    expect(getPublicCopy('en').workspace.nav.groups.workspace).toBe('Workspace')
    expect(getPublicCopy('zh-CN').workspace.nav.groups.system).toBe('系统')
    expect(getPublicCopy('en').workspace.userMenu.accountDetail).toBe('Account Detail')
    expect(getPublicCopy('en').workspace.userMenu.helpSupport).toBe('Help & Support')
    expect(getPublicCopy('es').workspace.userMenu.accountDetail).toBe('Detalles de la cuenta')
    expect(getPublicCopy('es').workspace.userMenu.helpSupport).toBe('Ayuda y soporte')
    expect(getPublicCopy('zh-CN').workspace.userMenu.accountDetail).toBe('账户详情')
    expect(getPublicCopy('zh-CN').workspace.userMenu.helpSupport).toBe('帮助与支持')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.systemPrompt).toBe('系统提示词')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.systemPrompt).toBe(
      'Prompt del sistema'
    )
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.tools).toBe('Tools')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.tools).toBe('工具')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.deployedWithVersion).toBe(
      'Deployed (v{{version}})'
    )
    const enWidgets = getPublicCopy('en').workspace.widgets
    const esWidgets = getPublicCopy('es').workspace.widgets
    const zhWidgets = getPublicCopy('zh-CN').workspace.widgets
    expect(enWidgets.workflowInspector.workflowEditor).toBe(enWidgets.workflowEditor)
    expect(esWidgets.workflowInspector.blockEditor).toBe(esWidgets.blockEditor)
    expect(zhWidgets.workflowInspector.workflowLabels).toBe(zhWidgets.workflowLabels)
    expect(enWidgets.workflowInspector.workflowEditor.previewInspector).toBe(
      'Preview Inspector'
    )
    expect(esWidgets.workflowInspector.workflowEditor.previewInspector).toBe(
      'Inspector de vista previa'
    )
    expect(zhWidgets.workflowInspector.workflowLabels.systemPrompt).toBe('系统提示词')
    expect(getPublicCopy('es').workspace.widgets.blockEditor.blockNames.stagehand).toBe(
      'Extracción de Stagehand'
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.blockEditor.blockNames.stagehand_agent).not.toBe(
      getPublicCopy('en').workspace.widgets.blockEditor.blockNames.stagehand_agent
    )
    expect(getPublicCopy('es').workspace.widgets.blockEditor.blockDescriptions.stagehand).toBe(
      'Extraer datos de sitios web'
    )
    expect(
      getPublicCopy('zh-CN').workspace.widgets.blockEditor.blockLongDescriptions.stagehand_agent
    ).toContain('浏览网页并执行任务')
    expect(getPublicCopy('en').workspace.knowledge.title).toBe('Knowledge')
    expect(getPublicCopy('en').workspace.templates.title).toBe('Templates')
    expect(getPublicCopy('es').workspace.templates.sections.your).toBe('Tus plantillas')
    expect(getPublicCopy('zh-CN').workspace.layoutTabs.renameAriaLabel).toContain('{{name}}')
    expect(getPublicCopy('zh-CN').workspace.logs.title.logs).toBe('日志')
    expect(getPublicCopy('en').workspace.widgets.selector.selectWidget).toBe('Select widget')
    expect(getPublicCopy('en').workspace.widgets.selector.categories.trading).toBe('Trading')
    expect(getPublicCopy('es').workspace.widgets.selector.categories.trading).toBe('Trading')
    expect(getPublicCopy('zh-CN').workspace.widgets.selector.categories.trading).toBe('交易')
    expect(getPublicCopy('en').workspace.widgets.titles.portfolio_snapshot).toBe(
      'Portfolio Snapshot'
    )
    expect(getPublicCopy('es').workspace.widgets.titles.quick_order).toBe('Orden rápida')
    expect(getPublicCopy('zh-CN').workspace.widgets.titles.heatmap).toBe('热力图')
    expect(getPublicCopy('en').workspace.widgets.webhook.common.configureButton).toBe(
      'Configure Webhook'
    )
    expect(
      getPublicCopy('es').workspace.widgets.webhook.providers.generic.sections.authentication
    ).toBe('Autenticación')
    expect(
      getPublicCopy('zh-CN').workspace.widgets.webhook.providers.slack.notice.payloadTitle
    ).toBe('Slack 事件负载示例')
    expect(getPublicCopy('en').workspace.widgets.webhook.providers.gmail.fallbackLabels.inbox).toBe(
      'Inbox'
    )
    expect(
      getPublicCopy('zh-CN').workspace.widgets.webhook.providers.outlook.fallbackFolders.sentItems
    ).toBe('已发送邮件')
    expect(getPublicCopy('es').workspace.widgets.workflowCreateMenu.createWorkflow).toBe(
      'Nuevo flujo'
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowEditor.previewInspector).toBe(
      '预览检查器'
    )
    expect(getPublicCopy('en').workspace.widgets.pairColor.selectWidgetColor).toBe(
      'Select widget color'
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.apiKey.selectApiKey).toBe('选择 API 密钥')
    expect(getPublicCopy('en').workspace.widgets.console.showMore).toBe('Show more')
    expect(getPublicCopy('es').workspace.widgets.workflowChat.attachFiles).toBe('Adjuntar archivos')
    expect(getPublicCopy('es').workspace.widgets.workflowChat.attach).toBe('Adjuntar')
    expect(getPublicCopy('en').workspace.widgets.workflowChat.maximumFilesAllowed).toContain(
      '{{maxFiles}}'
    )
    expect(getPublicCopy('en').workspace.widgets.workflowVariables.unableToLoadWorkflows).toBe(
      'Unable to load workflows'
    )
    expect(
      getPublicCopy('es').workspace.widgets.workflowVariables.authenticationRequiredToLoadWorkflows
    ).toContain('autenticación')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowEditor.whileConditionPlaceholder).toBe(
      '<counter.value> < 10'
    )
    expect(
      getPublicCopy('en').workspace.widgets.workflowEditor.collectionItemsPlaceholder
    ).toBe("['item1', 'item2', 'item3']")
    expect(
      getPublicCopy('en').workspace.widgets.blockEditor.googleCalendarSelector.accessLabel
    ).toBe('Access:')
    expect(
      getPublicCopy('es').workspace.widgets.blockEditor.knowledgeBaseSelector.groupLabel
    ).toBe('Bases de conocimiento')
    expect(
      getPublicCopy('zh-CN').workspace.widgets.blockEditor.documentSelector.chunkCountPlural
    ).toBe('{{count}} 个分块')
    expect(getPublicCopy('en').workspace.widgets.blockEditor.documentTagEntry.tagSlotsUsed).toBe(
      '{{used}} of {{total}} tag slots used'
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowVariables.addVariable).toBe('添加变量')
    expect(getPublicCopy('en').workspace.widgets.blockEditor.templateModal.title.publish).toBe(
      'Publish Template'
    )
    expect(getPublicCopy('en').workspace.widgets.blockEditor.dropdown.failedToFetchOptions).toBe(
      'Failed to fetch options'
    )
    expect(getPublicCopy('es').workspace.widgets.blockEditor.wandPromptBar.generating).toBe(
      'Generando...'
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.blockEditor.orderIdSelector.buy).toBe('买入')
    expect(getPublicCopy('en').workspace.widgets.deployment.failedToDeployWorkflow).toBe(
      'Failed to deploy workflow'
    )
    expect(getPublicCopy('es').workspace.widgets.deployment.chat.failedToSavePassword).toBe(
      'No se pudo guardar la contraseña del chat'
    )
    expect(
      getPublicCopy('en').workspace.widgets.blockEditor.webhookSettings.errors.validationFailed
    ).toBe('Validation failed. Review the webhook settings and try again.')
    expect(getPublicCopy('zh-CN').workspace.widgets.blockEditor.webhookSettings.testStatus.failure).toBe(
      '测试 Webhook 失败。'
    )
    expect(getPublicCopy('es').workspace.widgets.blockEditor.webhookSettings.actions.add).toBe(
      'Agregar webhook'
    )
    expect(
      getPublicCopy('zh-CN').workspace.widgets.blockEditor.webhookSettings.form.payloadTitle
    ).toBe('包含在负载中')
  })

  it('includes localized webhook workflow labels', () => {
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.url).toBe('URL')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.method).toBe('Method')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.queryParams).toBe('Query Params')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.headers).toBe('Headers')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.body).toBe('Body')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.webhookUrl).toBe('Webhook URL')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.payload).toBe('Payload')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.signingSecret).toBe(
      'Signing Secret'
    )
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.additionalHeaders).toBe(
      'Additional Headers'
    )
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.operation).toBe('Operation')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.searchQuery).toBe('Search Query')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.numberOfResults).toBe(
      'Number of Results'
    )

    expect(getPublicCopy('es').workspace.widgets.workflowLabels.url).toBe('URL')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.method).toBe('Método')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.queryParams).toBe(
      'Parámetros de consulta'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.headers).toBe('Encabezados')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.body).toBe('Cuerpo')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.webhookUrl).toBe('URL del webhook')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.payload).toBe('Carga útil')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.signingSecret).toBe(
      'Secreto de firma'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.additionalHeaders).toBe(
      'Encabezados adicionales'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.operation).toBe('Operación')
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.searchQuery).toBe(
      'Consulta de búsqueda'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.numberOfResults).toBe(
      'Número de resultados'
    )

    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.url).toBe('URL')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.method).toBe('方法')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.queryParams).toBe('查询参数')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.headers).not.toBe(
      getPublicCopy('en').workspace.widgets.workflowLabels.headers
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.body).not.toBe(
      getPublicCopy('en').workspace.widgets.workflowLabels.body
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.webhookUrl).toContain('Webhook')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.payload).toBe('有效负载')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.signingSecret).toBe('签名密钥')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.additionalHeaders).not.toBe(
      getPublicCopy('en').workspace.widgets.workflowLabels.additionalHeaders
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.operation).toBe('操作')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.searchQuery).toBe('搜索查询')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.numberOfResults).toBe('结果数量')
  })

  it('includes localized guardrails workflow labels', () => {
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.contentToValidate).toBe(
      'Content to Validate'
    )
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.validationType).toBe(
      'Validation Type'
    )
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.configurePiiTypes).toBe(
      'Configure PII Types'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.contentToValidate).toBe(
      'Contenido a validar'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.blockRequest).toBe(
      'Bloquear solicitud'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.common).toBe('Comunes')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.validationType).toBe('验证类型')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.maskPii).not.toBe(
      getPublicCopy('en').workspace.widgets.workflowLabels.maskPii
    )
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.personName).not.toBe(
      getPublicCopy('en').workspace.widgets.workflowLabels.personName
    )
  })

  it('includes localized SSO callback helper copy', () => {
    expect(getPublicCopy('en').workspace.settingsModal.sso.callbackUrlHelp).toBe(
      'Use this callback URL in your identity provider settings.'
    )
    expect(getPublicCopy('es').workspace.settingsModal.sso.callbackUrlHelp).toContain(
      'URL de callback'
    )
    expect(getPublicCopy('zh-CN').workspace.settingsModal.sso.callbackUrlHelp).toContain('回调 URL')
  })

  it('includes localized deployment and block-editor copy for workflow editor surfaces', () => {
    const enWidgets = getPublicCopy('en').workspace.widgets
    const esWidgets = getPublicCopy('es').workspace.widgets
    const zhWidgets = getPublicCopy('zh-CN').workspace.widgets

    expect(enWidgets.deployment.triggerConfigurationUnavailable).toBe(
      'Trigger configuration is unavailable.'
    )
    expect(esWidgets.deployment.triggerConfigurationUnavailable).toBe(
      'La configuración del disparador no está disponible.'
    )
    expect(zhWidgets.deployment.chat.publishedChatTitle).toBe('已发布聊天')
    expect(esWidgets.blockEditor.inputFormat.deleteField).toBe('Eliminar campo')
    expect(zhWidgets.blockEditor.scheduleConfig.saveSchedule).toBe('保存计划')
    expect(enWidgets.blockEditor.oauthRequiredModal.connectNow).toBe('Connect Now')
  })

  it('keeps audited workflow editor namespaces structurally aligned across locales', () => {
    const enWidgets = getPublicCopy('en').workspace.widgets
    const esWidgets = getPublicCopy('es').workspace.widgets
    const zhWidgets = getPublicCopy('zh-CN').workspace.widgets

    expect(normalizeShape(esWidgets.workflowLabels)).toEqual(normalizeShape(enWidgets.workflowLabels))
    expect(normalizeShape(zhWidgets.workflowLabels)).toEqual(normalizeShape(enWidgets.workflowLabels))
    expect(normalizeShape(esWidgets.blockEditor)).toEqual(normalizeShape(enWidgets.blockEditor))
    expect(normalizeShape(zhWidgets.blockEditor)).toEqual(normalizeShape(enWidgets.blockEditor))
  })

  it('covers toolbar-visible block names and descriptions in every locale', () => {
    for (const locale of ['en', 'es', 'zh-CN'] as const) {
      const blockEditor = getPublicCopy(locale).workspace.widgets.blockEditor
      const blockNames = blockEditor.blockNames as Partial<Record<string, string>>
      const blockDescriptions = blockEditor.blockDescriptions as Partial<Record<string, string>>
      const missingNames = toolbarVisibleBlockTypes.filter(
        (type) => typeof blockNames[type] !== 'string'
      )
      const missingDescriptions = toolbarVisibleBlockTypes.filter(
        (type) => typeof blockDescriptions[type] !== 'string'
      )

      expect(missingNames).toEqual([])
      expect(missingDescriptions).toEqual([])
    }
  })

  it('keeps chart widget copy structurally aligned across locales', () => {
    const enWidgets = getPublicCopy('en').workspace.widgets
    const esWidgets = getPublicCopy('es').workspace.widgets
    const zhWidgets = getPublicCopy('zh-CN').workspace.widgets

    expect(normalizeShape(esWidgets.dataChart)).toEqual(normalizeShape(enWidgets.dataChart))
    expect(normalizeShape(zhWidgets.dataChart)).toEqual(normalizeShape(enWidgets.dataChart))
    expect(normalizeShape(esWidgets.listingSelector)).toEqual(
      normalizeShape(enWidgets.listingSelector)
    )
    expect(normalizeShape(zhWidgets.listingSelector)).toEqual(
      normalizeShape(enWidgets.listingSelector)
    )
  })

  it('covers current chart ids with localized copy keys', () => {
    const locales = ['en', 'es', 'zh-CN'] as const
    const normalizationModes = ['raw', 'adjusted', 'split_adjusted', 'total_return']

    for (const locale of locales) {
      const widgets = getPublicCopy(locale).workspace.widgets
      const candleTypes = widgets.dataChart.controls.candleTypes as Record<string, string>
      const rangePresets = widgets.dataChart.footer.range.presets as Record<string, string>
      const drawTools = widgets.dataChart.drawTools.tools as Record<string, string>
      const drawActions = widgets.dataChart.drawTools.actions as Record<string, string>
      const normalizationLabels = widgets.dataChart.footer.normalization.modes as Record<
        string,
        string
      >

      CANDLE_TYPE_OPTIONS.forEach((option) => {
        expect(candleTypes[option.id]).toEqual(expect.any(String))
      })
      DEFAULT_RANGE_PRESETS.forEach((preset) => {
        expect(rangePresets[preset.id]).toEqual(expect.any(String))
      })
      Object.keys(DRAW_TOOL_ICONS).forEach((tool) => {
        expect(drawTools[tool]).toEqual(expect.any(String))
      })
      Object.keys(DRAW_ACTION_ICONS).forEach((action) => {
        expect(drawActions[action]).toEqual(expect.any(String))
      })
      normalizationModes.forEach((mode) => {
        expect(normalizationLabels[mode]).toEqual(expect.any(String))
      })
    }
  })

  it('includes non-English chart widget copy for high-visibility strings', () => {
    const enWidgets = getPublicCopy('en').workspace.widgets
    const esWidgets = getPublicCopy('es').workspace.widgets
    const zhWidgets = getPublicCopy('zh-CN').workspace.widgets

    expect(esWidgets.dataChart.body.selectWorkspace).not.toBe(
      enWidgets.dataChart.body.selectWorkspace
    )
    expect(zhWidgets.dataChart.body.errorTitle).not.toBe(enWidgets.dataChart.body.errorTitle)
    expect(esWidgets.listingSelector.searchPlaceholder).not.toBe(
      enWidgets.listingSelector.searchPlaceholder
    )
  })

  it('keeps workflow label keys dot-free across locales', () => {
    for (const locale of ['en', 'es', 'zh-CN'] as const) {
      const widgets = getPublicCopy(locale).workspace.widgets

      expect(Object.keys(widgets.workflowLabels).every((key) => !key.includes('.'))).toBe(true)
      expect(
        Object.keys(widgets.workflowInspector.workflowLabels).every((key) => !key.includes('.'))
      ).toBe(true)
    }
  })

  it('formats template placeholders', () => {
    const copy = getPublicCopy('en')

    expect(formatTemplate(copy.blog.pageDescription, { count: 3 })).toContain('3 articles')
  })
})
