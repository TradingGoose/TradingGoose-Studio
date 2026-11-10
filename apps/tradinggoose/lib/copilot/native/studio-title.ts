import type { CopilotRuntimeModel } from '../runtime-models'
import type { CompletionFailureResponse, CompletionResponse, Input, Scope } from './contract'

export interface StudioNativeTitleRequest {
  workspaceId: Scope['workspaceId']
  threadId: string
  model: CopilotRuntimeModel
  originalInput: Extract<Input['content'], string>
}
export interface StudioNativeTitleResult {
  title: string | null
  outcome?: CompletionResponse | CompletionFailureResponse
}
