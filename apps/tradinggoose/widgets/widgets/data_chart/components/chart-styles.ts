import type { Chart } from 'klinecharts'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { resolveAxisName } from '@/widgets/widgets/data_chart/utils'

type ChartSettings = DataChartWidgetParams['chart']

type ApplyChartStylesOptions = {
  chart: Chart
  chartContainer: HTMLDivElement | null
  chartSettings?: ChartSettings
  seriesTimezone: string | null
}

export const applyChartStyles = ({
  chart,
  chartContainer,
  chartSettings,
  seriesTimezone,
}: ApplyChartStylesOptions) => {
  if (typeof window === 'undefined') return

  const settings = chartSettings ?? {}

  if (settings.locale) {
    chart.setLocale(settings.locale)
  }
  if (settings.timezone) {
    chart.setTimezone(settings.timezone)
  } else if (seriesTimezone) {
    chart.setTimezone(seriesTimezone)
  }

  const computedStyles = chartContainer ? window.getComputedStyle(chartContainer) : null
  const appFontFamily = computedStyles?.fontFamily?.trim() ?? ''
  const appTextColor = computedStyles?.color?.trim() ?? ''
  const hasFont = Boolean(appFontFamily)
  const hasTextColor = Boolean(appTextColor)

  if (hasFont || hasTextColor) {
    const axisTickText = {
      ...(hasFont ? { family: appFontFamily } : {}),
      ...(hasTextColor ? { color: appTextColor } : {}),
    }
    const tooltipText = {
      ...(hasFont ? { family: appFontFamily } : {}),
      ...(hasTextColor ? { color: appTextColor } : {}),
    }
    const tooltipTitleText = {
      ...tooltipText,
      size: 20,
      marginTop: 10,
      marginBottom: 10,
    }
    const priceMarkText = {
      ...(hasFont ? { textFamily: appFontFamily } : {}),
      ...(hasTextColor ? { color: appTextColor } : {}),
    }
    const priceMarkLastText = {
      ...(hasFont ? { family: appFontFamily } : {}),
      ...(hasTextColor ? { color: appTextColor } : {}),
    }
    chart.setStyles({
      xAxis: { tickText: axisTickText },
      yAxis: { tickText: axisTickText },
      crosshair: {
        horizontal: { text: { ...tooltipText } },
        vertical: { text: { ...tooltipText } },
      },
      candle: {
        tooltip: {
          title: tooltipTitleText,
          legend: tooltipText,
        },
        priceMark: {
          high: priceMarkText,
          low: priceMarkText,
          last: { text: priceMarkLastText },
        },
      },
      indicator: {
        tooltip: {
          title: tooltipText,
          legend: tooltipText,
        },
        lastValueMark: { text: tooltipText },
      },
      overlay: { text: tooltipText },
    })
  }

  const stylesOverride = settings.stylesOverride ?? {}
  const candleType = settings.candleType
  const gridOverride = {
    ...(stylesOverride as { grid?: Record<string, unknown> }).grid,
    horizontal: {
      ...((stylesOverride as { grid?: { horizontal?: Record<string, unknown> } }).grid
        ?.horizontal ?? {}),
      color: '#88888825',
    },
    vertical: {
      ...((stylesOverride as { grid?: { vertical?: Record<string, unknown> } }).grid?.vertical ??
        {}),
      color: '#88888825',
    },
  }
  const stylePatch = {
    ...stylesOverride,
    grid: gridOverride,
    ...(candleType ? { candle: { type: candleType } } : null),
  }
  if (Object.keys(stylePatch).length > 0) {
    chart.setStyles(stylePatch)
  }

  const axisName = resolveAxisName(settings.priceAxisType)
  if (axisName) {
    chart.setPaneOptions({
      id: 'candle_pane',
      axis: { name: axisName },
    })
  }
}

export const resetChartTooltipTitle = (chart: Chart) => {
  chart.setStyles({
    candle: {
      tooltip: {
        title: {
          show: true,
          template: '',
        },
      },
    },
  })
}
