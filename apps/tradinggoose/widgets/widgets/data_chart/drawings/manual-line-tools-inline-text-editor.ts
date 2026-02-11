import type {
  InlineTextEditorControllerParams,
  OpenInlineTextEditorParams,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-types'
import { resolveInlineTextAnchorPoint } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-utils'

const resolveCssBorderStyle = (borderStyle: unknown) => {
  if (typeof borderStyle === 'string') {
    const normalized = borderStyle.toLowerCase()
    if (normalized.includes('dot')) return 'dotted'
    if (normalized.includes('dash')) return 'dashed'
    if (normalized === 'none') return 'none'
  }

  const numericStyle = Number(borderStyle)
  if (Number.isFinite(numericStyle)) {
    if (numericStyle === 1 || numericStyle === 4) return 'dotted'
    if (numericStyle === 2 || numericStyle === 3) return 'dashed'
  }

  return 'solid'
}

const resolveCssBorderRadius = (radius: unknown) => {
  if (typeof radius === 'number' && Number.isFinite(radius)) {
    return `${Math.max(0, radius)}px`
  }

  if (Array.isArray(radius) && radius.length > 0) {
    const resolved = radius
      .slice(0, 4)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => `${Math.max(0, value)}px`)
    if (resolved.length > 0) {
      return resolved.join(' ')
    }
  }

  return '4px'
}

const resolveCssBoxShadow = (shadowOptions: unknown) => {
  if (!shadowOptions || typeof shadowOptions !== 'object') return 'none'

  const shadow = shadowOptions as {
    color?: unknown
    blur?: unknown
    offset?: { x?: unknown; y?: unknown } | undefined
  }

  if (typeof shadow.color !== 'string' || shadow.color.trim().length === 0) return 'none'

  const blur = Number(shadow.blur)
  const offsetX = Number(shadow.offset?.x)
  const offsetY = Number(shadow.offset?.y)
  const resolvedBlur = Number.isFinite(blur) ? Math.max(0, blur) : 0
  const resolvedOffsetX = Number.isFinite(offsetX) ? offsetX : 0
  const resolvedOffsetY = Number.isFinite(offsetY) ? offsetY : 0

  return `${resolvedOffsetX}px ${resolvedOffsetY}px ${resolvedBlur}px ${shadow.color}`
}

const isCssColorLike = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith('#') ||
    normalized.startsWith('rgb(') ||
    normalized.startsWith('rgba(') ||
    normalized.startsWith('hsl(') ||
    normalized.startsWith('hsla(') ||
    normalized.startsWith('oklab(') ||
    normalized.startsWith('oklch(') ||
    normalized.startsWith('color(') ||
    normalized.startsWith('var(') ||
    normalized === 'transparent'
  )
}

const resolveThemeColorToken = (styles: CSSStyleDeclaration, tokenName: string): string => {
  const rawValue = styles.getPropertyValue(tokenName).trim()
  if (!rawValue) return ''
  if (isCssColorLike(rawValue)) return rawValue
  return `hsl(${rawValue})`
}

const MINIMUM_BOX_PADDING_PIXELS = 5

export const createInlineTextEditorController = ({
  chartRef,
  activeInlineTextEditorRef,
  parseLineToolExports,
  reconcileSelection,
  bumpVersion,
}: InlineTextEditorControllerParams) => {
  const closeInlineTextEditor = (commit: boolean) => {
    const activeEditor = activeInlineTextEditorRef.current
    if (!activeEditor) return
    activeEditor.finalize(commit)
  }

  const openInlineTextEditor = (params: OpenInlineTextEditorParams) => {
    closeInlineTextEditor(true)

    const chart = chartRef.current
    if (!chart) return

    const latestTool = parseLineToolExports(params.plugin.getLineToolByID(params.tool.id))[0]
    const toolToEdit = latestTool ?? params.tool
    const toolOptions = (toolToEdit.options as { text?: any } | undefined) ?? {}
    const textOptions = toolOptions.text ?? {}
    const textBoxOptions = textOptions.box ?? {}
    const textBorderOptions = textBoxOptions.border ?? {}
    const textBackgroundOptions = textBoxOptions.background ?? {}
    const textFontOptions = textOptions.font ?? {}
    const currentTextValue = typeof textOptions.value === 'string' ? textOptions.value : ''
    const anchorPoint = resolveInlineTextAnchorPoint(toolToEdit)
    if (!anchorPoint) return

    const chartElement = chart.chartElement()
    const chartStyles = window.getComputedStyle(chartElement)
    const rootStyles = window.getComputedStyle(document.documentElement)
    const previousChartPosition = chartElement.style.position
    const computedChartPosition = chartStyles.position
    const shouldRestoreChartPosition = computedChartPosition === 'static'
    if (shouldRestoreChartPosition) {
      chartElement.style.position = 'relative'
    }

    const themeTextColor =
      resolveThemeColorToken(rootStyles, '--foreground') ||
      chartStyles.color.trim() ||
      rootStyles.color.trim()
    const themeBackgroundColor =
      resolveThemeColorToken(rootStyles, '--background') ||
      chartStyles.backgroundColor.trim() ||
      rootStyles.backgroundColor.trim() ||
      '#0f172a'
    const themeFontFamily = chartStyles.fontFamily.trim() || rootStyles.fontFamily.trim()

    const rawX = chart.timeScale().timeToCoordinate(anchorPoint.timestamp as any)
    const rawY = params.series.priceToCoordinate(anchorPoint.price)
    const fallbackX = chartElement.clientWidth / 2
    const fallbackY = chartElement.clientHeight / 2
    const x = Number.isFinite(rawX) ? (rawX as number) : fallbackX
    const y = Number.isFinite(rawY) ? (rawY as number) : fallbackY

    const safeX = Math.min(Math.max(8, x), Math.max(8, chartElement.clientWidth - 8))
    const safeY = Math.min(Math.max(8, y), Math.max(8, chartElement.clientHeight - 8))

    const textFontSize = Number(textOptions?.font?.size)
    const normalizedTextFontSize =
      Number.isFinite(textFontSize) && textFontSize > 0 ? textFontSize : 30
    const requestedBoxScale = Number(textBoxOptions?.scale)
    const normalizedBoxScale =
      Number.isFinite(requestedBoxScale) && requestedBoxScale > 0 ? requestedBoxScale : 1
    const clampedBoxScale = Math.max(0.01, normalizedBoxScale)
    const fontAwareScale =
      clampedBoxScale === 1
        ? 1
        : Math.ceil(clampedBoxScale * normalizedTextFontSize) / normalizedTextFontSize
    const requestedBoxAngle = Number(textBoxOptions?.angle)
    const boxAngle = Number.isFinite(requestedBoxAngle) ? requestedBoxAngle : 0
    const boxHorizontalAlignment = `${textBoxOptions?.alignment?.horizontal ?? 'center'}`.toLowerCase()
    const boxVerticalAlignment = `${textBoxOptions?.alignment?.vertical ?? 'middle'}`.toLowerCase()
    const translateX =
      boxHorizontalAlignment === 'right' || boxHorizontalAlignment === 'end'
        ? '-100%'
        : boxHorizontalAlignment === 'center' || boxHorizontalAlignment === 'middle'
          ? '-50%'
          : '0'
    const translateY =
      boxVerticalAlignment === 'top' || boxVerticalAlignment === 'start'
        ? '-100%'
        : boxVerticalAlignment === 'middle' || boxVerticalAlignment === 'center'
          ? '-50%'
          : '0'
    const transformOriginX =
      boxHorizontalAlignment === 'right' || boxHorizontalAlignment === 'end'
        ? '100%'
        : boxHorizontalAlignment === 'center' || boxHorizontalAlignment === 'middle'
          ? '50%'
          : '0%'
    const transformOriginY =
      boxVerticalAlignment === 'top' || boxVerticalAlignment === 'start'
        ? '100%'
        : boxVerticalAlignment === 'middle' || boxVerticalAlignment === 'center'
          ? '50%'
          : '0%'

    const resolvedFontSize = Math.max(1, Math.ceil(normalizedTextFontSize * fontAwareScale))
    const borderWidthValue = Number(textBorderOptions?.width)
    const resolvedBorderWidth = Number.isFinite(borderWidthValue) ? Math.max(0, borderWidthValue) : 0
    const boxPaddingX = Number(textBoxOptions?.padding?.x)
    const boxPaddingY = Number(textBoxOptions?.padding?.y)
    const backgroundInflationX = Number(textBackgroundOptions?.inflation?.x)
    const backgroundInflationY = Number(textBackgroundOptions?.inflation?.y)
    const scaledBoxPaddingX =
      (Number.isFinite(boxPaddingX) ? Math.max(0, boxPaddingX) : 0) * fontAwareScale +
      MINIMUM_BOX_PADDING_PIXELS
    const scaledBoxPaddingY =
      (Number.isFinite(boxPaddingY) ? Math.max(0, boxPaddingY) : 0) * fontAwareScale +
      MINIMUM_BOX_PADDING_PIXELS
    const resolvedPaddingX =
      scaledBoxPaddingX +
      (Number.isFinite(backgroundInflationX) ? Math.max(0, backgroundInflationX) * fontAwareScale : 0)
    const resolvedPaddingY =
      scaledBoxPaddingY +
      (Number.isFinite(backgroundInflationY) ? Math.max(0, backgroundInflationY) * fontAwareScale : 0)
    const wordWrapWidth = Number(textOptions?.wordWrapWidth)
    const wrapWidth =
      Number.isFinite(wordWrapWidth) && wordWrapWidth > 0
        ? wordWrapWidth * fontAwareScale
        : 120 * fontAwareScale
    const measurementCanvas = document.createElement('canvas')
    const measurementContext = measurementCanvas.getContext('2d')
    const fontFamily =
      typeof textFontOptions?.family === 'string' && textFontOptions.family.trim()
        ? textFontOptions.family
        : themeFontFamily
    const measureFont =
      `${textFontOptions?.bold ? 'bold ' : ''}${textFontOptions?.italic ? 'italic ' : ''}${resolvedFontSize}px ${fontFamily}`
    const measuredContentWidth = (() => {
      if (!measurementContext) return 0
      measurementContext.font = measureFont
      let maxMeasuredWidth = 0
      for (const line of currentTextValue.split(/\r\n|\r|\n/)) {
        maxMeasuredWidth = Math.max(maxMeasuredWidth, measurementContext.measureText(line).width)
      }
      return maxMeasuredWidth
    })()
    const resolvedContentWidth = measuredContentWidth > 0 ? Math.min(measuredContentWidth, wrapWidth) : wrapWidth
    const requestedWidth = resolvedContentWidth + resolvedPaddingX * 2 + resolvedBorderWidth * 2
    const minWidth = Math.max(48, resolvedPaddingX * 2 + resolvedBorderWidth * 2 + 1)
    const maxWidth = Math.max(minWidth, chartElement.clientWidth - 16)
    const width = Math.max(minWidth, Math.min(requestedWidth, maxWidth))
    const linePadding = Number(textOptions?.padding)
    const resolvedLinePadding =
      Number.isFinite(linePadding) && linePadding > 0 ? linePadding * fontAwareScale : 0
    const fontColor =
      typeof textFontOptions?.color === 'string' && textFontOptions.color.trim()
        ? textFontOptions.color
        : typeof textOptions?.font?.color === 'string' && textOptions.font.color.trim()
          ? textOptions.font.color
          : themeTextColor
    const borderColor =
      typeof textBorderOptions?.color === 'string' && textBorderOptions.color.trim()
        ? textBorderOptions.color
        : 'transparent'
    const rawBackgroundColor =
      typeof textBackgroundOptions?.color === 'string' ? textBackgroundOptions.color.trim() : ''
    const backgroundColor =
      rawBackgroundColor.length > 0 && rawBackgroundColor.toLowerCase() !== 'transparent'
        ? textBackgroundOptions.color
        : themeBackgroundColor
    const textAlign =
      boxHorizontalAlignment === 'left'
        ? 'left'
        : boxHorizontalAlignment === 'right'
          ? 'right'
          : 'center'

    const textarea = document.createElement('textarea')
    textarea.value = currentTextValue
    textarea.spellcheck = false
    textarea.setAttribute('aria-label', 'Edit text')
    textarea.style.position = 'absolute'
    textarea.style.left = `${safeX}px`
    textarea.style.top = `${safeY}px`
    textarea.style.transformOrigin = `${transformOriginX} ${transformOriginY}`
    textarea.style.transform = `translate(${translateX}, ${translateY}) rotate(${-boxAngle}deg)`
    textarea.style.width = `${width}px`
    textarea.style.minHeight = `${Math.max(30, Math.round(resolvedFontSize * 1.8))}px`
    textarea.style.maxHeight = `${Math.max(80, chartElement.clientHeight - 16)}px`
    textarea.style.paddingLeft = `${resolvedPaddingX}px`
    textarea.style.paddingRight = `${resolvedPaddingX}px`
    textarea.style.paddingTop = `${resolvedPaddingY}px`
    textarea.style.paddingBottom = `${resolvedPaddingY}px`
    textarea.style.margin = '0'
    textarea.style.resize = 'none'
    textarea.style.overflow = 'hidden'
    textarea.style.outline = 'none'
    textarea.style.borderStyle =
      resolvedBorderWidth === 0 ? 'none' : resolveCssBorderStyle(textBorderOptions?.style)
    textarea.style.borderWidth = `${resolvedBorderWidth}px`
    textarea.style.borderColor = borderColor
    textarea.style.borderRadius = resolveCssBorderRadius(textBorderOptions?.radius)
    textarea.style.background = backgroundColor
    textarea.style.color = fontColor
    textarea.style.caretColor = fontColor
    textarea.style.fontFamily = fontFamily
    textarea.style.fontSize = `${resolvedFontSize}px`
    textarea.style.fontWeight = textFontOptions?.bold ? '700' : '400'
    textarea.style.fontStyle = textFontOptions?.italic
      ? 'italic'
      : 'normal'
    textarea.style.lineHeight = `${Math.max(1, resolvedFontSize + resolvedLinePadding)}px`
    textarea.style.textAlign = textAlign
    textarea.style.whiteSpace = 'pre-wrap'
    textarea.style.boxShadow = resolveCssBoxShadow(textBoxOptions?.shadow)
    textarea.style.zIndex = '10'
    textarea.style.boxSizing = 'border-box'

    const stopEvent = (event: Event) => {
      event.stopPropagation()
    }
    const syncHeight = () => {
      const maxHeight = Math.max(80, chartElement.clientHeight - 16)
      const minHeight = Number.parseFloat(textarea.style.minHeight)

      textarea.style.paddingTop = `${resolvedPaddingY}px`
      textarea.style.paddingBottom = `${resolvedPaddingY}px`
      textarea.style.height = '0px'
      const contentHeight = textarea.scrollHeight
      const targetHeight = Math.min(maxHeight, Math.max(contentHeight, minHeight))

      const extraVerticalSpace = Math.max(0, targetHeight - contentHeight)
      const topInset = Math.floor(extraVerticalSpace / 2)
      const bottomInset = extraVerticalSpace - topInset
      textarea.style.paddingTop = `${resolvedPaddingY + topInset}px`
      textarea.style.paddingBottom = `${resolvedPaddingY + bottomInset}px`

      textarea.style.height = '0px'
      const centeredHeight = Math.min(maxHeight, Math.max(textarea.scrollHeight, minHeight))
      textarea.style.height = `${centeredHeight}px`
    }

    let finalized = false
    const finalize = (commit: boolean) => {
      if (finalized) return
      finalized = true

      textarea.removeEventListener('pointerdown', stopEvent)
      textarea.removeEventListener('mousedown', stopEvent)
      textarea.removeEventListener('dblclick', stopEvent)
      textarea.removeEventListener('keydown', onKeyDown)
      textarea.removeEventListener('input', onInput)
      textarea.removeEventListener('blur', onBlur)

      if (activeInlineTextEditorRef.current?.element === textarea) {
        activeInlineTextEditorRef.current = null
      }

      textarea.remove()
      if (shouldRestoreChartPosition) {
        chartElement.style.position = previousChartPosition
      }

      if (!commit) return

      const nextTextValue = textarea.value
      const latestTool = parseLineToolExports(params.plugin.getLineToolByID(params.tool.id))[0]
      if (!latestTool) return
      if ((latestTool.options as { editable?: boolean } | undefined)?.editable === false) return

      const latestTextValue = (latestTool.options as { text?: { value?: unknown } } | undefined)
        ?.text?.value
      const currentValue = typeof latestTextValue === 'string' ? latestTextValue : ''
      if (nextTextValue === currentValue) return

      const nextOptions = {
        ...(latestTool.options ?? {}),
        text: {
          ...((latestTool.options as { text?: Record<string, unknown> } | undefined)?.text ?? {}),
          value: nextTextValue,
        },
      }

      params.plugin.createOrUpdateLineTool(
        latestTool.toolType as any,
        latestTool.points,
        nextOptions as any,
        latestTool.id
      )

      reconcileSelection(params.ownerId)
      bumpVersion()
    }

    const onInput = () => {
      syncHeight()
    }
    const onBlur = () => {
      finalize(true)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finalize(false)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        finalize(true)
      }
    }

    textarea.addEventListener('pointerdown', stopEvent)
    textarea.addEventListener('mousedown', stopEvent)
    textarea.addEventListener('dblclick', stopEvent)
    textarea.addEventListener('keydown', onKeyDown)
    textarea.addEventListener('input', onInput)
    textarea.addEventListener('blur', onBlur)

    chartElement.appendChild(textarea)
    syncHeight()
    textarea.focus()
    textarea.select()

    activeInlineTextEditorRef.current = {
      ownerId: params.ownerId,
      seriesAttachmentKey: params.seriesAttachmentKey,
      toolId: toolToEdit.id,
      element: textarea,
      finalize,
    }
  }

  return {
    openInlineTextEditor,
    closeInlineTextEditor,
  }
}
