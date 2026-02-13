import type { DefaultIndicatorRuntimeEntry } from '@/lib/indicators/default/runtime'
import type { BarMs } from '@/lib/indicators/types'
import {
  FUNCTION_INDICATOR_INVALID_OPTIONS_MESSAGE,
  FUNCTION_INDICATOR_MARKET_SERIES_ERROR_PREFIX,
} from './function-indicator-runtime'

type IndicatorRuntimeManifest = {
  indicators: DefaultIndicatorRuntimeEntry[]
}

const encodeJsonParse = (value: unknown) => JSON.stringify(JSON.stringify(value))

const buildPineTSE2BExecutorCoreSource = () =>
  `
const __tg_run_pinets_indicator = async ({ bars, listingKey, interval, indicatorCode, inputs }) => {
  const { Indicator, PineTS } = await import('pinets');
  if (typeof Indicator !== 'function' || typeof PineTS !== 'function') {
    throw new Error('Failed to initialize PineTS runtime in E2B sandbox');
  }
  const pine = new PineTS(bars, listingKey ?? undefined, interval ?? undefined);
  await pine.ready();
  const context = await pine.run(new Indicator(indicatorCode, inputs));
  return {
    context,
    transpiledCode: typeof pine.transpiledCode === 'string' ? pine.transpiledCode : null,
  };
};
`.trim()

export const buildPineTSE2BSingleIndicatorScript = ({
  normalizedCode,
  barsMs,
  inputsMap,
  listingKey,
  interval,
}: {
  normalizedCode: string
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listingKey?: string
  interval?: string
}) =>
  `
;(async () => {
  const __tg_bars = JSON.parse(${encodeJsonParse(barsMs)});
  const __tg_inputs = JSON.parse(${encodeJsonParse(inputsMap ?? {})});
  const __tg_listing_key = JSON.parse(${encodeJsonParse(listingKey ?? null)});
  const __tg_interval = JSON.parse(${encodeJsonParse(interval ?? null)});
  const __tg_indicator = (${normalizedCode});
  ${buildPineTSE2BExecutorCoreSource()}
  try {
    const { context, transpiledCode } = await __tg_run_pinets_indicator({
      bars: __tg_bars,
      listingKey: __tg_listing_key,
      interval: __tg_interval,
      indicatorCode: __tg_indicator,
      inputs: __tg_inputs,
    });
    const payload = {
      context: {
        plots: context?.plots ?? {},
        indicator: context?.indicator ?? {},
      },
      transpiledCode,
    };
    console.log('__TG_RESULT__=' + JSON.stringify(payload));
  } catch (error) {
    console.log(String((error && (error.stack || error.message)) || error));
    throw error;
  }
})();
`.trim()

export const buildPineTSFunctionIndicatorRuntimePrologue = ({
  manifest,
  usageHint,
}: {
  manifest: IndicatorRuntimeManifest
  usageHint: string
}) => {
  const manifestPayload = encodeJsonParse(manifest)
  const usageHintPayload = JSON.stringify(usageHint)
  const invalidOptionsMessagePayload = JSON.stringify(FUNCTION_INDICATOR_INVALID_OPTIONS_MESSAGE)
  const marketSeriesErrorPrefixPayload = JSON.stringify(
    FUNCTION_INDICATOR_MARKET_SERIES_ERROR_PREFIX
  )

  return `
const __tg_indicator_manifest = JSON.parse(${manifestPayload});
const __tg_indicator_usage_hint = ${usageHintPayload};
${buildPineTSE2BExecutorCoreSource()}
const indicator = (() => {
  const indicators = Array.isArray(__tg_indicator_manifest?.indicators) ? __tg_indicator_manifest.indicators : [];
  const indicatorById = new Map(indicators.map((entry) => [entry.id, entry]));
  const indicatorIds = indicators.map((entry) => entry.id);
  const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');
  const resolveEntry = (alias) => {
    const key = toTrimmedString(alias);
    if (!key) return null;
    return indicatorById.get(key) ?? null;
  };
  const readInputs = (rawOptions) => {
    if (rawOptions === undefined || rawOptions === null) return undefined;
    if (typeof rawOptions !== 'object' || Array.isArray(rawOptions)) throw new Error(${invalidOptionsMessagePayload});
    if (!Object.prototype.hasOwnProperty.call(rawOptions, 'inputs')) return rawOptions;
    if (rawOptions.inputs === undefined || rawOptions.inputs === null) return undefined;
    if (typeof rawOptions.inputs !== 'object' || Array.isArray(rawOptions.inputs)) throw new Error(${invalidOptionsMessagePayload});
    return rawOptions.inputs;
  };
  const assertSeries = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.bars) || value.bars.length === 0) throw new Error(${marketSeriesErrorPrefixPayload} + ' ' + __tg_indicator_usage_hint);
    return value;
  };
  const resolveListingKey = (series) => {
    const listing = series?.listing;
    if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return undefined;
    if (toTrimmedString(listing.listing_type).toLowerCase() === 'default') return toTrimmedString(listing.listing_id) || undefined;
    const baseId = toTrimmedString(listing.base_id); const quoteId = toTrimmedString(listing.quote_id);
    return baseId && quoteId ? baseId + ':' + quoteId : undefined;
  };
  const mapBars = (series) => {
    const map = new Map();
    series.bars.forEach((bar) => {
      if (!bar || typeof bar !== 'object') return;
      const openTime = Date.parse(bar.timeStamp);
      if (!Number.isFinite(openTime)) return;
      const close = Number.isFinite(Number(bar.close)) ? Number(bar.close) : Number.isFinite(Number(bar.open)) ? Number(bar.open) : 0;
      map.set(openTime, {
        openTime,
        closeTime: openTime,
        open: Number.isFinite(Number(bar.open)) ? Number(bar.open) : close,
        high: Number.isFinite(Number(bar.high)) ? Number(bar.high) : close,
        low: Number.isFinite(Number(bar.low)) ? Number(bar.low) : close,
        close,
        volume: Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : undefined,
      });
    });
    const bars = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
    for (let i = 0; i < bars.length; i += 1) {
      const current = bars[i]; const next = bars[i + 1];
      if (next) current.closeTime = next.openTime;
      else current.closeTime = current.openTime;
    }
    return bars;
  };
  const buildInputsMap = (entry, overrides) => {
    const defaults = {}; const inputMeta = entry?.inputMeta && typeof entry.inputMeta === 'object' ? entry.inputMeta : {};
    Object.entries(inputMeta).forEach(([title, meta]) => {
      if (!title || title.trim().length === 0 || !meta || typeof meta !== 'object') return;
      if (meta.defval !== undefined) defaults[title] = meta.defval;
    });
    const safeOverrides = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
    return { ...defaults, ...safeOverrides };
  };
  const runIndicator = async (alias, marketSeriesInput, rawOptions) => {
    const aliasKey = typeof alias === 'string' ? alias : String(alias ?? '');
    const indicatorEntry = resolveEntry(aliasKey);
    if (!indicatorEntry) throw new Error('Unknown indicator "' + aliasKey + '".');
    try {
      const marketSeries = assertSeries(marketSeriesInput);
      const inputOverrides = readInputs(rawOptions);
      const barsMs = mapBars(marketSeries);
      if (barsMs.length === 0) throw new Error('MarketSeries has no valid bars after normalization.');
      const listingKey = resolveListingKey(marketSeries) || undefined;
      const inputsMap = buildInputsMap(indicatorEntry, inputOverrides);
      const { context } = await __tg_run_pinets_indicator({
        bars: barsMs,
        listingKey,
        indicatorCode: indicatorEntry.pineCode,
        inputs: inputsMap,
      });
      const plots = context?.plots && typeof context.plots === 'object' ? context.plots : {};
      const indicatorState = context?.indicator && typeof context.indicator === 'object' ? context.indicator : {};
      return {
        indicatorId: indicatorEntry.id,
        indicatorName: indicatorEntry.name,
        plots,
        indicator: indicatorState,
      };
    } catch (error) {
      const message = error && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error);
      throw new Error('indicator.' + indicatorEntry.id + ' failed: ' + message);
    }
  };
  const api = { list: () => [...indicatorIds] };
  return new Proxy(api, {
    get(target, prop) {
      if (prop === 'list') return target.list;
      if (typeof prop !== 'string') return undefined;
      return (marketSeriesInput, rawOptions) => runIndicator(prop, marketSeriesInput, rawOptions);
    },
  });
})();
`.trim()
}
