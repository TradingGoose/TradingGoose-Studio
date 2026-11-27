import type { WorkflowObservation } from './contract'

export class ObserveWorkflowExecution extends Error {
  constructor(public readonly handle: WorkflowObservation['handle']) {
    super('The workflow still has active work')
  }
}

export class NativeTargetError extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message)
    this.name = 'NativeTargetError'
  }
}

export class CopilotRunCancelled extends NativeTargetError {
  constructor() {
    super('Copilot generation was cancelled; completed effects remain', 409)
  }
}
