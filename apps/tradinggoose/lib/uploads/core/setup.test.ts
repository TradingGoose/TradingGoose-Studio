/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadSetup(env: Record<string, string | undefined>) {
  vi.resetModules()
  vi.doMock('@/lib/env', () => ({
    env,
  }))

  return import('./setup')
}

describe('uploads setup', () => {
  afterEach(() => {
    vi.unmock('@/lib/env')
  })

  it.each([
    {
      provider: 's3',
      env: {
        STORAGE_PROVIDER: 's3',
        AZURE_STORAGE_CONTAINER_NAME: 'azure-container',
        AZURE_CONNECTION_STRING:
          'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
        VERCEL_BLOB_READ_WRITE_TOKEN: 'vercel-token',
      },
      message: 'STORAGE_PROVIDER=s3 requires S3_BUCKET_NAME and AWS_REGION.',
    },
    {
      provider: 'azure',
      env: {
        STORAGE_PROVIDER: 'azure',
        S3_BUCKET_NAME: 'test-bucket',
        AWS_REGION: 'us-east-1',
        VERCEL_BLOB_READ_WRITE_TOKEN: 'vercel-token',
      },
      message:
        'STORAGE_PROVIDER=azure requires AZURE_STORAGE_CONTAINER_NAME and either AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY.',
    },
    {
      provider: 'vercel',
      env: {
        STORAGE_PROVIDER: 'vercel',
        S3_BUCKET_NAME: 'test-bucket',
        AWS_REGION: 'us-east-1',
        AZURE_STORAGE_CONTAINER_NAME: 'azure-container',
        AZURE_CONNECTION_STRING:
          'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
      },
      message:
        'STORAGE_PROVIDER=vercel requires BLOB_READ_WRITE_TOKEN or VERCEL_BLOB_READ_WRITE_TOKEN.',
    },
  ])('fails fast for explicit $provider when config is incomplete', async ({ env, message }) => {
    await expect(loadSetup(env)).rejects.toThrow(message)
  })

  it('keeps the implicit priority order when STORAGE_PROVIDER is unset', async () => {
    const setup = await loadSetup({
      AZURE_STORAGE_CONTAINER_NAME: 'azure-container',
      AZURE_CONNECTION_STRING:
        'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
      S3_BUCKET_NAME: 'test-bucket',
      AWS_REGION: 'us-east-1',
      VERCEL_BLOB_READ_WRITE_TOKEN: 'vercel-token',
    })

    expect(setup.STORAGE_PROVIDER).toBe('azure')
    expect(setup.getStorageProvider()).toBe('azure')
    expect(setup.USE_AZURE_STORAGE).toBe(true)
    expect(setup.USE_S3_STORAGE).toBe(false)
    expect(setup.USE_VERCEL_STORAGE).toBe(false)
    expect(setup.USE_LOCAL_STORAGE).toBe(false)
  })
})
