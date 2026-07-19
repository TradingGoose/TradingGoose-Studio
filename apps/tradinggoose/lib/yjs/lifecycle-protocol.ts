import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as Y from 'yjs'

export const YJS_MESSAGE_LIFECYCLE = 4
const CHECKPOINT = 0
const PERSIST_REQUEST = 1
const PERSIST_ERROR = 2

export type YjsLifecycleMessage =
  | { type: 'checkpoint'; lineageId: string; snapshot: Y.Snapshot; requestId?: string }
  | { type: 'persist-request'; requestId: string; identityName?: string }
  | { type: 'persist-error'; requestId: string; error: string }

function lifecycleEncoder(type: number): encoding.Encoder {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, YJS_MESSAGE_LIFECYCLE)
  encoding.writeVarUint(encoder, type)
  return encoder
}

export function encodeYjsDurableCheckpoint(
  lineageId: string,
  snapshot: Y.Snapshot,
  requestId = ''
): Uint8Array {
  const encoder = lifecycleEncoder(CHECKPOINT)
  encoding.writeVarString(encoder, lineageId)
  encoding.writeVarUint8Array(encoder, Y.encodeSnapshot(snapshot))
  encoding.writeVarString(encoder, requestId)
  return encoding.toUint8Array(encoder)
}

export function encodeYjsPersistRequest(requestId: string, identityName?: string): Uint8Array {
  const encoder = lifecycleEncoder(PERSIST_REQUEST)
  encoding.writeVarString(encoder, requestId)
  encoding.writeVarString(encoder, identityName ?? '')
  return encoding.toUint8Array(encoder)
}

export function encodeYjsPersistError(requestId: string, error: string): Uint8Array {
  const encoder = lifecycleEncoder(PERSIST_ERROR)
  encoding.writeVarString(encoder, requestId)
  encoding.writeVarString(encoder, error)
  return encoding.toUint8Array(encoder)
}

export function decodeYjsLifecycleMessage(decoder: decoding.Decoder): YjsLifecycleMessage {
  const type = decoding.readVarUint(decoder)
  if (type === CHECKPOINT) {
    const lineageId = decoding.readVarString(decoder)
    const snapshot = Y.decodeSnapshot(decoding.readVarUint8Array(decoder))
    const requestId = decoding.readVarString(decoder)
    return { type: 'checkpoint', lineageId, snapshot, ...(requestId ? { requestId } : {}) }
  }
  const requestId = decoding.readVarString(decoder)
  const value = decoding.readVarString(decoder)
  if (type === PERSIST_REQUEST) {
    return { type: 'persist-request', requestId, ...(value ? { identityName: value } : {}) }
  }
  if (type === PERSIST_ERROR) return { type: 'persist-error', requestId, error: value }
  throw new Error(`Unsupported Yjs lifecycle message: ${type}`)
}
