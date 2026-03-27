import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@tradinggoose/db/schema', () => ({}))

let getToolContract: typeof import('@/lib/copilot/registry').getToolContract
let isToolId: typeof import('@/lib/copilot/registry').isToolId
let routeExecution: typeof import('@/lib/copilot/tools/server/router').routeExecution

beforeAll(async () => {
  ;({ getToolContract, isToolId } = await import('@/lib/copilot/registry'))
  ;({ routeExecution } = await import('@/lib/copilot/tools/server/router'))
})

describe('copilot contract registry', () => {
  it('only exposes supported tool ids', () => {
    expect(isToolId('get_blocks_and_tools')).toBe(true)
    expect(isToolId('get_block_best_practices')).toBe(false)
    expect(isToolId('get_edit_workflow_examples')).toBe(false)
    expect(getToolContract('get_block_best_practices')).toBeUndefined()
  })

  it('reuses the shared block schemas in the central contract', () => {
    const contract = getToolContract('get_blocks_and_tools')

    expect(contract?.args.parse({})).toEqual({})
    expect(contract?.result.parse({ blocks: [] })).toEqual({ blocks: [] })
  })
})

describe('routeExecution', () => {
  it('validates request payloads through the central contract before execution', async () => {
    await expect(routeExecution('get_blocks_metadata', {})).rejects.toThrow()
  })

  it('validates server tool results through the central contract', async () => {
    await expect(routeExecution('get_blocks_and_tools', {})).resolves.toMatchObject({
      blocks: expect.any(Array),
    })
  })
})
