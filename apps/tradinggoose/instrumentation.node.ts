import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { env } from './lib/env'
import { createLogger } from './lib/logs/console/logger'

const logger = createLogger('OTelInstrumentation')

const TELEMETRY_ENDPOINT = 'https://telemetry.tradinggoose.ai/v1/traces'
const SERVICE_NAME = 'tradinggoose-studio'
const SERVICE_VERSION = '0.1.0'
const SAMPLE_RATE = 0.1

const batchSettings = {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 30000,
}

const telemetryState = globalThis as typeof globalThis & {
  __TRADINGGOOSE_OTEL__?: {
    initialized: boolean
    shutdownRegistered: boolean
    shutdown?: () => Promise<void>
  }
}

export async function register() {
  if (env.NEXT_TELEMETRY_DISABLED === '1') {
    logger.info('OpenTelemetry disabled via NEXT_TELEMETRY_DISABLED=1')
    return
  }

  const state = (telemetryState.__TRADINGGOOSE_OTEL__ ??= {
    initialized: false,
    shutdownRegistered: false,
  })

  if (state.initialized) {
    return
  }

  try {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

    const [
      { OTLPTraceExporter },
      { resourceFromAttributes },
      { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler },
      { NodeTracerProvider },
    ] = await Promise.all([
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/sdk-trace-node'),
    ])

    const exporter = new OTLPTraceExporter({
      url: env.TELEMETRY_ENDPOINT || TELEMETRY_ENDPOINT,
      timeoutMillis: batchSettings.exportTimeoutMillis,
    })

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': SERVICE_NAME,
        'service.version': SERVICE_VERSION,
        'service.namespace': 'tradinggoose-ai-platform',
        'deployment.environment': env.NODE_ENV || 'development',
        'telemetry.sdk.name': 'opentelemetry',
        'telemetry.sdk.language': 'nodejs',
      }),
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(SAMPLE_RATE),
      }),
      spanProcessors: [new BatchSpanProcessor(exporter, batchSettings)],
    })

    provider.register()

    state.initialized = true
    state.shutdown = async () => {
      try {
        await provider.shutdown()
        logger.info('OpenTelemetry SDK shut down successfully')
      } catch (error) {
        logger.error('Error shutting down OpenTelemetry SDK', error)
      } finally {
        state.initialized = false
      }
    }

    if (!state.shutdownRegistered) {
      process.once('SIGTERM', () => void state.shutdown?.())
      process.once('SIGINT', () => void state.shutdown?.())
      state.shutdownRegistered = true
    }

    logger.info('OpenTelemetry instrumentation initialized')
  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry instrumentation', error)
  }
}
