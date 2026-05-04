import { describe, expect, it } from 'vitest'
import { formatTemplate, getPublicCopy } from './public-copy'

describe('public copy', () => {
  it('loads translated locale files directly', () => {
    expect(getPublicCopy('en').meta.landing.title).toContain('TradingGoose')
    expect(getPublicCopy('es').blog.readTimeSuffix).toBe('min de lectura')
    expect(getPublicCopy('zh-CN').meta.landing.seo.socialPreviewAlt).toContain('TradingGoose')
  })

  it('keeps zh-CN auth copy translated', () => {
    const zhCopy = getPublicCopy('zh-CN')
    const enCopy = getPublicCopy('en')

    expect(zhCopy.auth.common.signIn).toBe('登录')
    expect(zhCopy.auth.common.signUp).toBe('注册')
    expect(zhCopy.auth.login.submit).toBe('登录')
    expect(zhCopy.auth.signup.submit).toBe('创建账号')
    expect(zhCopy.auth.waitlist.submit).toBe('申请访问')
    expect(zhCopy.auth.note.waitlistApprovedEmail).toContain('等待名单')
    expect(zhCopy.auth.common.signIn).not.toBe(enCopy.auth.common.signIn)
    expect(zhCopy.auth.login.submit).not.toBe(enCopy.auth.login.submit)
  })

  it('includes translated verify-email auth copy', () => {
    expect(getPublicCopy('en').auth.common.verifyEmail).toBe('Verify email')
    expect(getPublicCopy('es').auth.common.verifyEmail).toBe('Verificar correo')
    expect(getPublicCopy('zh-CN').auth.common.verifyEmail).toBe('验证邮箱')
  })

  it('includes localized verification screen copy', () => {
    expect(getPublicCopy('en').auth.verify.pendingTitle).toBe('Verify Your Email')
    expect(getPublicCopy('en').auth.verify.resendIn).toBe('Resend in {{countdown}}s')
    expect(getPublicCopy('es').auth.verify.verifyButton).toBe('Verificar correo')
    expect(getPublicCopy('es').auth.verify.errors.resendFailed).toContain('reenviar')
    expect(getPublicCopy('zh-CN').auth.verify.instructionsWithoutService).toBe(
      '请输入 6 位验证码以验证你的账号。'
    )
    expect(getPublicCopy('zh-CN').auth.verify.yourEmail).toBe('你的邮箱')
  })

  it('includes localized workspace copy', () => {
    expect(getPublicCopy('en').workspace.defaults.defaultLayoutName).toBe('Default Layout')
    expect(getPublicCopy('zh-CN').workspace.defaults.newWorkspaceName).toBe('我的工作空间')
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
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.systemPrompt).toBe(
      '系统提示词'
    )
    expect(getPublicCopy('es').workspace.widgets.workflowLabels.systemPrompt).toBe(
      'Prompt del sistema'
    )
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.tools).toBe('Tools')
    expect(getPublicCopy('zh-CN').workspace.widgets.workflowLabels.tools).toBe('工具')
    expect(getPublicCopy('en').workspace.widgets.workflowLabels.deployedWithVersion).toBe(
      'Deployed (v{{version}})'
    )
    expect(getPublicCopy('en').workspace.knowledge.title).toBe('Knowledge')
    expect(getPublicCopy('zh-CN').workspace.logs.title.logs).toBe('日志')
    expect(getPublicCopy('en').workspace.widgets.selector.selectWidget).toBe('Select widget')
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
  })

  it('includes localized SSO callback helper copy', () => {
    expect(getPublicCopy('en').workspace.settingsModal.sso.callbackUrlHelp).toBe(
      'Use this callback URL in your identity provider settings.'
    )
    expect(getPublicCopy('es').workspace.settingsModal.sso.callbackUrlHelp).toContain(
      'URL de callback'
    )
    expect(getPublicCopy('zh-CN').workspace.settingsModal.sso.callbackUrlHelp).toContain(
      '回调 URL'
    )
  })

  it('formats template placeholders', () => {
    const copy = getPublicCopy('en')

    expect(formatTemplate(copy.blog.pageDescription, { count: 3 })).toContain('3 articles')
  })
})
