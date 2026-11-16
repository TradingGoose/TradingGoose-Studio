import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo, LookupFunction } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { assertStorageReferenceAccess, fetchPublicStorageUrl } from './utils/file-utils'

const fixture = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetch: vi.fn(),
  nativeFetch: undefined as unknown as typeof import('undici/index.js').fetch,
  connectorLookup: undefined as unknown as LookupFunction,
}))
vi.mock('node:dns', async (original) => {
  const actual = await original<typeof import('node:dns')>()
  return { ...actual, default: { ...actual, lookup: fixture.lookup } }
})
vi.mock('undici/index.js', async (original) => {
  const actual = await original<typeof import('undici/index.js')>()
  fixture.nativeFetch = actual.fetch
  return {
    ...actual,
    fetch: fixture.fetch,
    Agent: class extends actual.Agent {
      constructor(options: ConstructorParameters<typeof actual.Agent>[0]) {
        super(options)
        fixture.connectorLookup = (options?.connect as { lookup: LookupFunction }).lookup
      }
    },
  }
})

let requests = 0
const server = createServer((_request, response) => {
  requests++
  response.end('internal service')
})
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
beforeEach(() => {
  requests = 0
  fixture.lookup.mockReset()
  fixture.fetch.mockReset().mockImplementation(fixture.nativeFetch)
})

it.each(['folder/../private', 'broken%zz'])('rejects inaccessible file reference %s', (value) => {
  expect(() => assertStorageReferenceAccess(value)).toThrow()
})
it.each([
  '127.0.0.1',
  '2130706433',
  '10.1.2.3',
  '169.254.169.254',
  '[::1]',
  '[::ffff:127.0.0.1]',
  '[64:ff9b::a9fe:a9fe]',
  'localhost.',
])('blocks private URL %s before sending a request', async (host) => {
  const { port } = server.address() as AddressInfo
  await expect(fetchPublicStorageUrl(`http://${host}:${port}/private`)).rejects.toMatchObject({
    status: 403,
  })
  expect(fixture.fetch).not.toHaveBeenCalled()
  expect(requests).toBe(0)
})
it.each([
  [{ address: '127.0.0.1', family: 4 }],
  [{ address: '169.254.169.254', family: 4 }],
  [{ address: '::ffff:7f00:1', family: 6 }],
  [
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ],
])('blocks private DNS results through the actual HTTP connector: %j', async (...addresses) => {
  fixture.lookup.mockImplementation((_hostname, options, callback) => {
    expect(options.all).toBe(true)
    callback(null, addresses)
  })
  const { port } = server.address() as AddressInfo
  await expect(
    fetchPublicStorageUrl(`http://media.fixture:${port}/private`, {
      signal: AbortSignal.timeout(1000),
    })
  ).rejects.toMatchObject({ status: 403 })
  expect(fixture.lookup).toHaveBeenCalledOnce()
  expect(requests).toBe(0)
})
it('returns the checked public DNS records directly to the connector without another lookup', async () => {
  const addresses = [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]
  fixture.lookup.mockImplementation((_hostname, _options, callback) => callback(null, addresses))
  const result = await new Promise((resolve, reject) => {
    fixture.connectorLookup('media.fixture', { all: true }, (error, records) => {
      if (error) reject(error)
      else resolve(records)
    })
  })
  expect(result).toBe(addresses)
  expect(fixture.lookup).toHaveBeenCalledOnce()
})
it.each(['file:///private.png', 'http://127.0.0.1/private', 'http://169.254.169.254/latest'])(
  'checks redirect target %s before another request',
  async (location) => {
    fixture.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
    await expect(fetchPublicStorageUrl('https://files.example/ordinary')).rejects.toThrow()
    expect(fixture.fetch).toHaveBeenCalledOnce()
    expect(requests).toBe(0)
  }
)
it('checks resolved addresses after a public redirect', async () => {
  fixture.fetch.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: {
        location: `http://redirect.fixture:${(server.address() as AddressInfo).port}/private`,
      },
    })
  )
  fixture.lookup.mockImplementation((_hostname, _options, callback) =>
    callback(null, [{ address: '127.0.0.1', family: 4 }])
  )
  await expect(fetchPublicStorageUrl('https://files.example/ordinary')).rejects.toMatchObject({
    status: 403,
  })
  expect(fixture.fetch).toHaveBeenCalledTimes(2)
  expect(fixture.lookup).toHaveBeenCalledOnce()
  expect(requests).toBe(0)
})
it('returns public media without changing body or cancellation options', async () => {
  const response = new Response('image bytes', { headers: { 'content-type': 'image/png' } })
  fixture.fetch.mockResolvedValueOnce(response)
  const signal = new AbortController().signal
  expect(await fetchPublicStorageUrl('https://files.example/image.png', { signal })).toBe(response)
  expect(fixture.fetch).toHaveBeenCalledWith(
    'https://files.example/image.png',
    expect.objectContaining({ signal, redirect: 'manual', dispatcher: expect.anything() })
  )
})
it('pins private DNS validation under the actual Bun runtime', async () => {
  const source = fileURLToPath(new URL('./utils/file-utils.ts', import.meta.url))
  const port = (server.address() as AddressInfo).port
  await promisify(execFile)(
    'bun',
    [
      '-e',
      `
        import assert from 'node:assert/strict';
        import dns from 'node:dns';
        let lookups = 0;
        dns.lookup = (_hostname, options, callback) => {
          lookups++;
          assert.equal(options.all, true);
          callback(null, [{ address: '127.0.0.1', family: 4 }]);
        };
        const { fetchPublicStorageUrl } = await import(${JSON.stringify(source)});
        try {
          await assert.rejects(
            fetchPublicStorageUrl('http://media.fixture:${port}/private'),
            { status: 403 }
          );
          assert.equal(lookups, 1);
          process.exit(0);
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      `,
    ],
    { timeout: 4000 }
  )
  expect(requests).toBe(0)
})
