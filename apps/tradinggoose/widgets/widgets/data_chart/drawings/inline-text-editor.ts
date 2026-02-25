import type {
  InlineTextEditorControllerParams,
  OpenInlineTextEditorParams,
} from '@/widgets/widgets/data_chart/drawings/adapter-types'
import { resolveInlineTextAnchorPoint } from '@/widgets/widgets/data_chart/drawings/adapter-utils'
import {
  type InlineEditorTextBoxOptions,
  type InlineEditorTextFontOptions,
  type InlineEditorTextOptions,
  type InlineEditorToolOptions,
  MINIMUM_BOX_PADDING_PIXELS,
  resolveAnchorXCoordinate,
  resolveCssBorderRadius,
  resolveCssBorderStyle,
  resolveCssBoxShadow,
  resolveNonEmptyColor,
  resolveScaledBorderRadius,
  resolveScaledBorderWidth,
  resolveThemeColorToken,
  resolveWrappedLinesMaxWidth,
} from '@/widgets/widgets/data_chart/drawings/inline-text-editor-utils'
import { setInlineEditorActiveForTool } from '@/widgets/widgets/data_chart/plugins/core/model/inline-editor-state'
import { resolveSystemFontFamily } from '@/widgets/widgets/data_chart/plugins/core/utils/theme-text-style'
import { TrendLineOptionDefaults } from '@/widgets/widgets/data_chart/plugins/shared/lines/model/LineToolTrendLine'

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
    const toolOptions = (toolToEdit.options as InlineEditorToolOptions | undefined) ?? {}
    const isInlineEditableTool = toolToEdit.toolType === 'Text' || toolToEdit.toolType === 'Callout'

    const textOptions: InlineEditorTextOptions = toolOptions.text ?? {}
    const textBoxOptions: InlineEditorTextBoxOptions = textOptions.box ?? {}
    const textBorderOptions: NonNullable<InlineEditorTextBoxOptions['border']> =
      textBoxOptions.border ?? {}
    const textBackgroundOptions: NonNullable<InlineEditorTextBoxOptions['background']> =
      textBoxOptions.background ?? {}
    const textFontOptions: InlineEditorTextFontOptions = textOptions.font ?? {}
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

    const rawX = resolveAnchorXCoordinate(chart, params.series, anchorPoint.timestamp)
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
    const boxHorizontalAlignment =
      `${textBoxOptions?.alignment?.horizontal ?? 'center'}`.toLowerCase()
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
    const resolvedBorderWidth = resolveScaledBorderWidth(
      textBorderOptions?.width,
      toolToEdit.toolType,
      clampedBoxScale
    )
    const resolvedBorderRadius = resolveCssBorderRadius(
      resolveScaledBorderRadius(textBorderOptions?.radius, clampedBoxScale)
    )

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
      (Number.isFinite(backgroundInflationX)
        ? Math.max(0, backgroundInflationX) * fontAwareScale
        : 0)
    const resolvedPaddingY =
      scaledBoxPaddingY +
      (Number.isFinite(backgroundInflationY)
        ? Math.max(0, backgroundInflationY) * fontAwareScale
        : 0)

    const rawWordWrapWidth = textOptions?.wordWrapWidth
    const numericWordWrapWidth = Number(rawWordWrapWidth)
    const hasFiniteWrapWidth = Number.isFinite(numericWordWrapWidth) && numericWordWrapWidth > 0
    const scaledWrapWidth = hasFiniteWrapWidth
      ? numericWordWrapWidth * fontAwareScale
      : rawWordWrapWidth
    const maxAllowedWidth = hasFiniteWrapWidth ? numericWordWrapWidth * fontAwareScale : null
    const forceCalculateMaxLineWidth = textOptions?.forceCalculateMaxLineWidth === true

    const fontFamily = resolveSystemFontFamily(
      typeof textFontOptions?.family === 'string' ? textFontOptions.family : undefined
    )
    const measureFont = `${textFontOptions?.bold ? 'bold ' : ''}${textFontOptions?.italic ? 'italic ' : ''}${resolvedFontSize}px ${fontFamily}`

    const resolveEditorWidth = (value: string): number => {
      const linesMaxWidth = resolveWrappedLinesMaxWidth(
        value,
        measureFont,
        scaledWrapWidth,
        maxAllowedWidth,
        forceCalculateMaxLineWidth
      )
      return Math.max(1, linesMaxWidth + resolvedPaddingX * 2 + resolvedBorderWidth * 2)
    }

    const linePadding = Number(textOptions?.padding)
    const resolvedLinePadding =
      Number.isFinite(linePadding) && linePadding > 0 ? linePadding * fontAwareScale : 0

    const fontColor =
      typeof textFontOptions?.color === 'string' && textFontOptions.color.trim()
        ? textFontOptions.color
        : typeof textOptions?.font?.color === 'string' && textOptions.font.color.trim()
          ? textOptions.font.color
          : themeTextColor

    const lineColorFallback = resolveNonEmptyColor(
      toolOptions.line?.color,
      TrendLineOptionDefaults.line.color
    )
    const borderColor = resolveNonEmptyColor(
      textBorderOptions?.color,
      toolToEdit.toolType === 'Callout' ? lineColorFallback : TrendLineOptionDefaults.line.color
    )

    const rawBackgroundColor =
      typeof textBackgroundOptions?.color === 'string' ? textBackgroundOptions.color.trim() : ''
    const backgroundColor =
      rawBackgroundColor.length > 0 && rawBackgroundColor.toLowerCase() !== 'transparent'
        ? rawBackgroundColor
        : themeBackgroundColor

    const textAlign =
      boxHorizontalAlignment === 'left'
        ? 'left'
        : boxHorizontalAlignment === 'right'
          ? 'right'
          : 'center'

    const minimumTextAreaHeight = Math.max(
      1,
      Math.ceil(resolvedFontSize + resolvedPaddingY * 2 + resolvedBorderWidth * 2)
    )

    const viewportMaxHeight = Math.max(80, chartElement.clientHeight - 16)
    const boxMaxHeight = Number(textBoxOptions?.maxHeight)
    const configuredEditorMaxHeight =
      Number.isFinite(boxMaxHeight) && boxMaxHeight > 0
        ? boxMaxHeight + resolvedPaddingY * 2 + resolvedBorderWidth * 2
        : viewportMaxHeight
    const maxEditorHeight = Math.max(
      minimumTextAreaHeight,
      Math.min(viewportMaxHeight, configuredEditorMaxHeight)
    )

    const textarea = document.createElement('textarea')
    textarea.value = currentTextValue
    textarea.spellcheck = false
    textarea.setAttribute('aria-label', 'Edit text')
    textarea.style.position = 'absolute'
    textarea.style.left = `${safeX}px`
    textarea.style.top = `${safeY}px`
    textarea.style.transformOrigin = `${transformOriginX} ${transformOriginY}`
    textarea.style.transform = `translate(${translateX}, ${translateY}) rotate(${-boxAngle}deg)`
    textarea.style.width = `${resolveEditorWidth(currentTextValue)}px`
    textarea.style.minHeight = `${minimumTextAreaHeight}px`
    textarea.style.maxHeight = `${maxEditorHeight}px`
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
    textarea.style.borderRadius = resolvedBorderRadius
    textarea.style.background = backgroundColor
    textarea.style.color = fontColor
    textarea.style.caretColor = fontColor
    textarea.style.fontFamily = fontFamily
    textarea.style.fontSize = `${resolvedFontSize}px`
    textarea.style.fontWeight = textFontOptions?.bold ? '700' : '400'
    textarea.style.fontStyle = textFontOptions?.italic ? 'italic' : 'normal'
    textarea.style.lineHeight = `${Math.max(1, resolvedFontSize + resolvedLinePadding)}px`
    textarea.style.textAlign = textAlign
    textarea.style.whiteSpace = 'pre-wrap'
    textarea.style.overflowWrap = 'anywhere'
    textarea.style.wordBreak = 'break-word'
    textarea.style.boxShadow = resolveCssBoxShadow(textBoxOptions?.shadow)
    textarea.style.zIndex = '10'
    textarea.style.boxSizing = 'border-box'

    const stopEvent = (event: Event) => {
      event.stopPropagation()
    }

    const syncLayout = () => {
      textarea.style.width = `${resolveEditorWidth(textarea.value)}px`
      textarea.style.paddingTop = `${resolvedPaddingY}px`
      textarea.style.paddingBottom = `${resolvedPaddingY}px`
      textarea.style.height = '0px'
      const targetHeight = Math.min(
        maxEditorHeight,
        Math.max(textarea.scrollHeight, minimumTextAreaHeight)
      )
      textarea.style.height = `${targetHeight}px`
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

      try {
        const latestTool = parseLineToolExports(params.plugin.getLineToolByID(params.tool.id))[0]
        if (!latestTool) return
        const latestOptions = (latestTool.options as InlineEditorToolOptions | undefined) ?? {}

        if (!commit || latestOptions.editable === false) {
          return
        }

        const nextTextValue = textarea.value
        const latestTextValue = (latestOptions as { text?: { value?: unknown } } | undefined)?.text
          ?.value
        const currentValue = typeof latestTextValue === 'string' ? latestTextValue : ''
        if (nextTextValue === currentValue) {
          return
        }

        const nextOptions = {
          ...latestOptions,
          text: {
            ...((latestOptions as { text?: Record<string, unknown> } | undefined)?.text ?? {}),
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
      } finally {
        if (isInlineEditableTool) {
          setInlineEditorActiveForTool(toolToEdit.id, false)
          params.plugin.refreshLineToolViews([toolToEdit.id])
        }
      }
    }

    const onInput = () => {
      syncLayout()
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

    if (isInlineEditableTool) {
      setInlineEditorActiveForTool(toolToEdit.id, true)
      params.plugin.refreshLineToolViews([toolToEdit.id])
    }

    chartElement.appendChild(textarea)
    syncLayout()
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
