import * as Y from 'yjs'

/**
 * Decodes a base64-encoded Yjs state update and applies it to the given doc.
 * This is the only allowed browser helper for applying snapshot data from the
 * same-origin snapshot route.
 */
export function applySnapshotToDoc(doc: Y.Doc, snapshotBase64: string): void {
  const binaryString = atob(snapshotBase64)
  const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0))
  Y.applyUpdate(doc, bytes)
}

/**
 * Encodes a Yjs doc state as a base64 string.
 */
export function encodeDocAsBase64(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc)
  const binaryString = Array.from(update, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binaryString)
}
