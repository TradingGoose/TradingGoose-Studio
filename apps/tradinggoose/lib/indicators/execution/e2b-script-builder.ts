import type { DefaultIndicatorRuntimeEntry } from '@/lib/indicators/default/runtime'
import type { BarMs } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'
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
const __tg_indicator_trigger_sentinel = '__tg_indicator_trigger__';
const __tg_trigger_event_pattern = /^[a-z][a-z0-9_]{0,63}$/;
const __tg_valid_trigger_signals = new Set(['long', 'short', 'flat']);
const __tg_valid_trigger_positions = new Set(['aboveBar', 'belowBar', 'inBar']);
const __tg_context_call_patch_flag = '__tg_indicator_trigger_call_patched__';
const __tg_trigger_call_id_pattern = /(^|[.$])trigger$/i;

const __tg_push_trigger_warning = (collector, code, message) => {
  collector.warnings.push({ code, message });
};

const __tg_is_record = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const __tg_resolve_current_value = (context, value) => {
  try {
    if (context && typeof context.get === 'function') {
      return context.get(value, 0);
    }
  } catch {
    return undefined;
  }
  return value;
};

const __tg_resolve_time_seconds = (context) => {
  const primary = __tg_resolve_current_value(context, context?.data?.openTime);
  if (typeof primary === 'number' && Number.isFinite(primary)) {
    return Math.floor(primary / 1000);
  }
  const fallback = __tg_resolve_current_value(context, context?.data?.time);
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return Math.floor(fallback / 1000);
  }
  return null;
};

const __tg_capture_trigger_call = (collector, context, args) => {
  const eventArg = args[0];
  const optionsArg = args[1];

  const resolvedEvent = __tg_resolve_current_value(context, eventArg);
  const event = typeof resolvedEvent === 'string' ? resolvedEvent.trim() : '';
  if (!event || !__tg_trigger_event_pattern.test(event)) {
    __tg_push_trigger_warning(
      collector,
      'indicator_trigger_invalid_event',
      'trigger(event, options) requires event to match /^[a-z][a-z0-9_]{0,63}$/'
    );
    return;
  }

  const resolvedOptions = __tg_resolve_current_value(context, optionsArg);
  if (!__tg_is_record(resolvedOptions)) {
    __tg_push_trigger_warning(
      collector,
      'indicator_trigger_invalid_options',
      'trigger(event, options) requires an options object.'
    );
    return;
  }

  let conditionValue;
  try {
    conditionValue = __tg_resolve_current_value(context, resolvedOptions.condition);
  } catch {
    __tg_push_trigger_warning(
      collector,
      'indicator_trigger_condition_unresolved',
      'trigger options.condition could not be resolved for current bar.'
    );
    return;
  }
  if (!Boolean(conditionValue)) {
    return;
  }

  const resolvedInput = __tg_resolve_current_value(context, resolvedOptions.input);
  const input = typeof resolvedInput === 'string' ? resolvedInput.trim() : '';
  if (!input) {
    __tg_push_trigger_warning(
      collector,
      'indicator_trigger_invalid_input',
      'trigger options.input is required and must be a non-empty string.'
    );
    return;
  }

  const resolvedSignal = __tg_resolve_current_value(context, resolvedOptions.signal);
  const signal = typeof resolvedSignal === 'string' ? resolvedSignal.trim() : '';
  if (!__tg_valid_trigger_signals.has(signal)) {
    __tg_push_trigger_warning(
      collector,
      'indicator_trigger_invalid_signal',
      'trigger options.signal must be one of long | short | flat.'
    );
    return;
  }

  const time = __tg_resolve_time_seconds(context);
  if (time === null) {
    __tg_push_trigger_warning(
      collector,
      'indicator_trigger_invalid_time',
      'trigger call dropped because current bar open time is unavailable.'
    );
    return;
  }

  const resolvedPosition = __tg_resolve_current_value(context, resolvedOptions.position);
  const position = typeof resolvedPosition === 'string' && __tg_valid_trigger_positions.has(resolvedPosition.trim())
    ? resolvedPosition.trim()
    : 'aboveBar';

  const resolvedColor = __tg_resolve_current_value(context, resolvedOptions.color);
  const color = typeof resolvedColor === 'string' && resolvedColor.trim().length > 0
    ? resolvedColor.trim()
    : undefined;

  const barIndex = Number.isFinite(context?.idx) ? Number(context.idx) : 0;

  collector.events.push({
    event,
    input,
    signal,
    position,
    color,
    time,
    barIndex,
  });
};

const __tg_install_trigger_sentinel = (target) => {
  const existing = target?.trigger;
  if (typeof existing === 'function' && existing?.[__tg_indicator_trigger_sentinel] === true) {
    return existing;
  }

  const sentinel = function __tg_indicator_trigger_noop() {
    return undefined;
  };

  Object.defineProperty(sentinel, __tg_indicator_trigger_sentinel, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  Object.defineProperty(target, 'trigger', {
    value: sentinel,
    writable: true,
    enumerable: false,
    configurable: true,
  });

  return sentinel;
};

const __tg_patch_context_call = (ContextCtor, collector) => {
  const contextPrototype = ContextCtor?.prototype;
  if (!contextPrototype || contextPrototype[__tg_context_call_patch_flag]) {
    return;
  }

  const originalCall = contextPrototype.call;
  if (typeof originalCall !== 'function') {
    throw new Error('PineTS Context.call is unavailable for trigger bridge patching.');
  }

  contextPrototype.call = function __tg_patched_context_call(fn, id, ...args) {
    const globalTrigger = globalThis?.trigger;
    const isSentinel =
      typeof fn === 'function' &&
      (fn === globalTrigger || fn?.[__tg_indicator_trigger_sentinel] === true);
    const triggerById = typeof id === 'string' && __tg_trigger_call_id_pattern.test(id.trim());

    if (isSentinel || triggerById) {
      __tg_capture_trigger_call(collector, this, args);
      return undefined;
    }

    return originalCall.apply(this, [fn, id, ...args]);
  };

  Object.defineProperty(contextPrototype, __tg_context_call_patch_flag, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });
};

const __tg_resolve_listing_symbol = (listing) => {
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return undefined;
  const listingType = typeof listing.listing_type === 'string' ? listing.listing_type.trim().toLowerCase() : '';
  if (listingType === 'default') {
    const listingId = typeof listing.listing_id === 'string' ? listing.listing_id.trim() : '';
    return listingId || undefined;
  }
  const baseId = typeof listing.base_id === 'string' ? listing.base_id.trim() : '';
  const quoteId = typeof listing.quote_id === 'string' ? listing.quote_id.trim() : '';
  return baseId && quoteId ? baseId + ':' + quoteId : undefined;
};

const __tg_run_pinets_indicator = async ({ bars, listing, interval, indicatorCode, inputs }) => {
  const { Indicator, PineTS, Context } = await import('pinets');
  if (typeof Indicator !== 'function' || typeof PineTS !== 'function' || typeof Context !== 'function') {
    throw new Error('Failed to initialize PineTS runtime in E2B sandbox');
  }

  const collector = { events: [], warnings: [] };
  __tg_install_trigger_sentinel(globalThis);
  __tg_patch_context_call(Context, collector);

  const pine = new PineTS(bars, __tg_resolve_listing_symbol(listing), interval ?? undefined);
  await pine.ready();
  const context = await pine.run(new Indicator(indicatorCode, inputs));
  return {
    context,
    transpiledCode: typeof pine.transpiledCode === 'string' ? pine.transpiledCode : null,
    triggerSignals: collector.events,
    triggerWarnings: collector.warnings,
  };
};
`.trim()

export const buildPineTSE2BSingleIndicatorScript = ({
  normalizedCode,
  barsMs,
  inputsMap,
  listing,
  interval,
}: {
  normalizedCode: string
  barsMs: BarMs[]
  inputsMap?: Record<string, unknown>
  listing?: ListingIdentity | null
  interval?: string
}) =>
  `
;(async () => {
  const __tg_bars = JSON.parse(${encodeJsonParse(barsMs)});
  const __tg_inputs = JSON.parse(${encodeJsonParse(inputsMap ?? {})});
  const __tg_listing = JSON.parse(${encodeJsonParse(listing ?? null)});
  const __tg_interval = JSON.parse(${encodeJsonParse(interval ?? null)});
  const __tg_indicator = (${normalizedCode});
  ${buildPineTSE2BExecutorCoreSource()}
  try {
    const { context, transpiledCode, triggerSignals, triggerWarnings } = await __tg_run_pinets_indicator({
      bars: __tg_bars,
      listing: __tg_listing,
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
      triggerSignals: Array.isArray(triggerSignals) ? triggerSignals : [],
      triggerWarnings: Array.isArray(triggerWarnings) ? triggerWarnings : [],
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
  const resolveListing = (series) => {
    const listing = series?.listing;
    if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return undefined;
    const listingType = toTrimmedString(listing.listing_type).toLowerCase();
    if (listingType !== 'default' && listingType !== 'crypto' && listingType !== 'currency') return undefined;
    const listingId = toTrimmedString(listing.listing_id);
    const baseId = toTrimmedString(listing.base_id);
    const quoteId = toTrimmedString(listing.quote_id);
    if (listingType === 'default' && listingId) {
      return { listing_id: listingId, base_id: '', quote_id: '', listing_type: listingType };
    }
    if (baseId && quoteId) {
      return { listing_id: '', base_id: baseId, quote_id: quoteId, listing_type: listingType };
    }
    return undefined;
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
      const listing = resolveListing(marketSeries) || undefined;
      const inputsMap = buildInputsMap(indicatorEntry, inputOverrides);
      const { context } = await __tg_run_pinets_indicator({
        bars: barsMs,
        listing,
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
