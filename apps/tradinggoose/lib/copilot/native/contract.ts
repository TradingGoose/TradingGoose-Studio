import type {
  CopilotRequest,
  CopilotResponse,
  ErrorResponse,
  NativeContractDefinitions,
} from './contract.generated'
import { nativeParsers } from './parsers.generated'
import { COPILOT_NATIVE_COMMAND_STATUSES, COPILOT_NATIVE_REVISION } from './version.generated'

export type * from './contract.generated'
export { COPILOT_NATIVE_API_VERSION, COPILOT_NATIVE_REVISION } from './version.generated'

export function isNativeContractDefinition(name: string): name is keyof NativeContractDefinitions {
  return Object.hasOwn(nativeParsers, name)
}

/** Validate the unchanged service-owned schema, including its conditional constraints. */
export async function parseNativeContract<K extends keyof NativeContractDefinitions>(
  name: K,
  value: unknown
): Promise<NativeContractDefinitions[K]> {
  if (!isNativeContractDefinition(name)) throw new Error('Unknown native contract definition')
  return nativeParsers[name](value)
}

export function assertNativeCorrelation(
  value: { protocolRevision: string; requestId: string },
  requestId: string
) {
  if (value.protocolRevision !== COPILOT_NATIVE_REVISION || value.requestId !== requestId) {
    throw new Error('Native Copilot response does not match the requested revision and request')
  }
}

/** A valid envelope is not a response to every command. The allowed kinds are owner-derived. */
export class NativeCommandResponseError extends Error {
  readonly nativeOutcome: ErrorResponse

  constructor(value: CopilotResponse) {
    super('Native Copilot response does not match the requested command')
    this.name = 'NativeCommandResponseError'
    this.nativeOutcome = {
      protocolRevision: value.protocolRevision,
      requestId: value.requestId,
      status: 'failed',
      error: {
        code: 'UNCERTAIN',
        message: this.message,
        retryable: false,
        uncertain: true,
      },
      ...('financial' in value && value.financial ? { financial: value.financial } : {}),
      ...('usage' in value && value.usage ? { usage: value.usage } : {}),
    }
  }
}

export function assertNativeCommandResponse(
  command: CopilotRequest['command'],
  value: CopilotResponse
) {
  const statuses: readonly string[] = COPILOT_NATIVE_COMMAND_STATUSES[command]
  if (!statuses?.includes(value.status)) throw new NativeCommandResponseError(value)
}
