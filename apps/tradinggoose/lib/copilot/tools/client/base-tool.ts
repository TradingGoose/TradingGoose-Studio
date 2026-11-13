import type { LucideIcon } from 'lucide-react'
import type { BrowserAssertion } from '@/lib/copilot/native/contract'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'
import { syncToolState } from './manager'

const DEFAULT_TOOL_TIMEOUT_MS = 2 * 60 * 1000
export const WORKFLOW_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

// Client tool call states used by the new runtime
export enum ClientToolCallState {
  generating = 'generating',
  pending = 'pending',
  executing = 'executing',
  aborted = 'aborted',
  rejected = 'rejected',
  success = 'success',
  error = 'error',
  review = 'review',
}

// Display configuration for a given state
export interface ClientToolDisplay {
  text: string
  icon: LucideIcon
}

/**
 * Function to generate dynamic display text based on tool parameters and state
 * @param params - The tool call parameters
 * @param state - The current tool call state
 * @returns The dynamic text to display, or undefined to use the default text
 */
export type DynamicTextFormatter = (
  params: Record<string, any>,
  state: ClientToolCallState
) => string | undefined

export interface BaseClientToolMetadata {
  displayNames: Partial<Record<ClientToolCallState, ClientToolDisplay>>
  interrupt?: {
    accept: ClientToolDisplay
    reject: ClientToolDisplay
  }
  /**
   * Optional function to generate dynamic display text based on parameters
   * If provided, this will override the default text in displayNames
   */
  getDynamicText?: DynamicTextFormatter
}

export interface ClientToolExecutionContext {
  toolCallId: string
  toolName: string
  contextEntityKind?: ReviewEntityKind
  contextEntityId?: string
  workspaceId?: string
}

export abstract class BaseClientTool {
  readonly toolCallId: string
  readonly name: string
  protected state = ClientToolCallState.generating
  protected metadata: BaseClientToolMetadata
  private disposed = false
  private resultSubmitted = false
  private executionContext: ClientToolExecutionContext | null = null
  private toolCall: Record<string, any> | undefined
  constructor(id: string, name: string, metadata: BaseClientToolMetadata) {
    this.toolCallId = id
    this.name = name
    this.metadata = metadata
  }
  hasSubmittedResult() {
    return this.resultSubmitted
  }
  async executeWithTimeout(execute: () => Promise<void>, timeoutMs = DEFAULT_TOOL_TIMEOUT_MS) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        execute(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Tool request timed out; its effect outcome was not verified')),
            timeoutMs
          )
        }),
      ])
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Tool execution failed')
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  abstract execute(args?: Record<string, any>): Promise<void>
  setExecutionContext(context: ClientToolExecutionContext) {
    if (!this.disposed) this.executionContext = context
  }
  protected requireExecutionContext() {
    if (!this.executionContext)
      throw new Error(`Missing execution context for tool call ${this.toolCallId}`)
    return this.executionContext
  }
  protected getAbortSignal() {
    return this.disposed
      ? AbortSignal.abort()
      : getCopilotStoreForToolCall(this.toolCallId).getState().abortController?.signal
  }
  hydrateToolCall(call?: Record<string, any>) {
    if (!this.disposed) this.toolCall = call
  }
  protected resolveResult<T = unknown>() {
    return this.toolCall?.result as T | undefined
  }
  protected async requireNativeTarget() {
    if (this.disposed) throw new Error('Client tool is no longer active')
    const store = getCopilotStoreForToolCall(this.toolCallId).getState()
    const pending = await store.readPendingTool(this.toolCallId)
    if (pending.stage !== 'result')
      throw new Error('Native approval is required before business execution')
    if (!store.currentChat) throw new Error('Native conversation scope is missing')
    return { workspaceId: store.currentChat.workspaceId, target: pending.target }
  }
  protected async completeBrowserAssertion(assertion: BrowserAssertion) {
    if (this.disposed || this.resultSubmitted) return
    await getCopilotStoreForToolCall(this.toolCallId)
      .getState()
      .submitBrowserAssertion(this.toolCallId, assertion)
    this.resultSubmitted = true
  }
  protected async completeAuthoritativeReadback(readback?: { credentialId: string }) {
    if (this.disposed || this.resultSubmitted) return
    await getCopilotStoreForToolCall(this.toolCallId)
      .getState()
      .readbackCopilotToolCall(this.toolCallId, readback)
    this.resultSubmitted = true
  }
  protected fail(message: string) {
    if (this.disposed) return
    this.setState(ClientToolCallState.error)
    getCopilotStoreForToolCall(this.toolCallId)
      .getState()
      .recordToolFailure(this.toolCallId, message)
  }
  async handleUserAction(args?: Record<string, any>) {
    if (this.disposed || this.resultSubmitted) return
    await this.execute(args)
  }
  getInterruptDisplays() {
    return this.metadata.interrupt
  }
  setState(state: ClientToolCallState, options?: { result?: unknown }) {
    if (this.disposed) return
    this.state = state
    this.toolCall = {
      ...this.toolCall,
      state,
      ...(options?.result !== undefined ? { result: options.result } : {}),
    }
    syncToolState(this.toolCallId, state, options)
  }
  getState() {
    return this.state
  }
  dispose() {
    this.disposed = true
    this.state = ClientToolCallState.aborted
    this.executionContext = null
    this.toolCall = undefined
  }
}
