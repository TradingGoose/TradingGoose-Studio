import { z } from 'zod'
import { parseNativeContract, type Scope, type Target } from './contract'

const targetEnvelope = z
  .object({ workspaceId: z.string().min(1).nullable(), target: z.unknown() })
  .strict()
export type StudioNativeTarget = { workspaceId: Scope['workspaceId']; target: Target }
export async function parseStudioNativeTarget(value: unknown): Promise<StudioNativeTarget> {
  const input = targetEnvelope.parse(value)
  return { ...input, target: await parseNativeContract('Target', input.target) }
}
