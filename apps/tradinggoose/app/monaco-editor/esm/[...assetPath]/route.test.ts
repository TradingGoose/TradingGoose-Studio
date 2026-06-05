/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

describe('Monaco asset route', () => {
  it('serves Monaco ESM assets from the external subtree used by workers', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/monaco-editor/esm/external/vscode-uri/lib/esm/index.js'),
      {
        params: Promise.resolve({
          assetPath: ['external', 'vscode-uri', 'lib', 'esm', 'index.js'],
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
    expect(await response.text()).toContain('export')
  })

  it('continues to serve Monaco VS assets used by the editor runtime', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('http://localhost/monaco-editor/esm/vs/common/initialize.js'),
      {
        params: Promise.resolve({
          assetPath: ['vs', 'common', 'initialize.js'],
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
    expect(await response.text()).toContain('initialize')
  })
})
