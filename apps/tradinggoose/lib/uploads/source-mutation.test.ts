/** @vitest-environment node */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  provider: 'vercel',
  copilotBucket: 'shared-private',
  generalBucket: 'shared-private',
  copilotContainer: 'shared',
  generalContainer: 'shared',
  send: vi.fn(),
  azureDelete: vi.fn(),
  vercelDelete: vi.fn(),
  vercelRead: vi.fn(),
  unlink: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: {
    get STORAGE_PROVIDER() {
      return state.provider
    },
    get S3_BUCKET_NAME() {
      return state.generalBucket
    },
    get S3_COPILOT_BUCKET_NAME() {
      return state.copilotBucket
    },
    get S3_KB_BUCKET_NAME() {
      return state.generalBucket
    },
    get S3_CHAT_BUCKET_NAME() {
      return state.generalBucket
    },
    get S3_EXECUTION_FILES_BUCKET_NAME() {
      return state.generalBucket
    },
    get S3_PROFILE_PICTURES_BUCKET_NAME() {
      return state.generalBucket
    },
    AWS_REGION: 'fixture-region',
    get AZURE_STORAGE_CONTAINER_NAME() {
      return state.generalContainer
    },
    get AZURE_STORAGE_COPILOT_CONTAINER_NAME() {
      return state.copilotContainer
    },
    get AZURE_STORAGE_KB_CONTAINER_NAME() {
      return state.generalContainer
    },
    get AZURE_STORAGE_CHAT_CONTAINER_NAME() {
      return state.generalContainer
    },
    get AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME() {
      return state.generalContainer
    },
    get AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME() {
      return state.generalContainer
    },
    AZURE_ACCOUNT_NAME: 'fixtureaccount',
    AZURE_CONNECTION_STRING:
      'DefaultEndpointsProtocol=https;AccountName=fixtureaccount;AccountKey=dGVzdC1vbmx5LWtleQ==;EndpointSuffix=core.windows.net',
    AZURE_ACCOUNT_KEY: 'dGVzdC1vbmx5LWtleQ==',
    VERCEL_BLOB_READ_WRITE_TOKEN: 'synthetic-token',
    VERCEL_BLOB_ACCESS: 'private',
  },
}))
vi.mock('@vercel/blob', () => ({ del: state.vercelDelete, get: state.vercelRead, put: vi.fn() }))
vi.mock('@aws-sdk/client-s3', async (original) => {
  const actual = await original<typeof import('@aws-sdk/client-s3')>()
  return {
    ...actual,
    S3Client: class {
      send(command: unknown) {
        return state.send(command)
      }
    },
  }
})
vi.mock('@azure/storage-blob', async (original) => {
  const actual = await original<typeof import('@azure/storage-blob')>()
  class DeleteTransportFixture extends actual.BlobServiceClient {
    static fromConnectionString(
      ...args: Parameters<typeof actual.BlobServiceClient.fromConnectionString>
    ) {
      const client = actual.BlobServiceClient.fromConnectionString(...args)
      Object.setPrototypeOf(client, DeleteTransportFixture.prototype)
      return client
    }
    getContainerClient(name: string) {
      const container = super.getContainerClient(name)
      const getBlob = container.getBlockBlobClient.bind(container)
      container.getBlockBlobClient = (key) => {
        const blob = getBlob(key)
        blob.delete = state.azureDelete
        return blob
      }
      return container
    }
  }
  return { ...actual, BlobServiceClient: DeleteTransportFixture }
})
vi.mock('fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  unlink: state.unlink,
}))
const applicationCwd = process.cwd()
let localRoot: string | undefined
beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  state.provider = 'vercel'
  state.copilotBucket = 'shared-private'
  state.generalBucket = 'shared-private'
  state.copilotContainer = 'shared'
  state.generalContainer = 'shared'
  state.send.mockResolvedValue({})
  state.azureDelete.mockResolvedValue({})
  state.vercelDelete.mockResolvedValue(undefined)
  state.unlink.mockResolvedValue(undefined)
})
afterEach(async () => {
  process.chdir(applicationCwd)
  if (localRoot) await rm(localRoot, { recursive: true, force: true })
  localRoot = undefined
})
const noContacts = () => {
  expect(state.send).not.toHaveBeenCalled()
  expect(state.azureDelete).not.toHaveBeenCalled()
  expect(state.vercelDelete).not.toHaveBeenCalled()
  expect(state.unlink).not.toHaveBeenCalled()
}

describe('actual exact-purpose storage mutation boundary', () => {
  it.each(['common', 'provider'])(
    'does not let a DELETE cap for decoded spelling delete a distinct encoded SDK key through %s',
    async (lane) => {
      const { withAuthorizedStorageDelete } = await import('./source-read-boundary')
      const outcome = await Promise.allSettled([
        withAuthorizedStorageDelete('owned/file.txt', 'workspace', async () => {
          if (lane === 'common') {
            const { deleteFile } = await import('./core/storage-service')
            await deleteFile({ key: 'owned%2Ffile.txt', context: 'workspace' })
          } else {
            const { deleteFromVercel } = await import('./providers/vercel/vercel-client')
            await deleteFromVercel('owned%2Ffile.txt')
          }
        }),
      ])
      noContacts()
      expect(outcome[0].status).toBe('rejected')
    }
  )
})

async function profile(provider: string) {
  state.provider = provider
  if (provider === 'local') {
    localRoot = await mkdtemp(join(tmpdir(), 'tradinggoose-delete-purpose-'))
    process.chdir(localRoot)
  }
  const boundary = await import('./source-read-boundary')
  const common = await import('./core/storage-service')
  const defaults = await import('./core/storage-client')
  const direct =
    provider === 's3'
      ? (await import('./providers/s3/s3-client')).deleteFromS3
      : provider === 'azure'
        ? (await import('./providers/azure/azure-client')).deleteFromAzure
        : provider === 'vercel'
          ? (await import('./providers/vercel/vercel-client')).deleteFromVercel
          : defaults.deleteFile
  return { ...boundary, common, defaults, direct }
}

describe('actual common/provider/local protected mutation calls', () => {
  it.each(['s3', 'azure', 'vercel', 'local'])(
    'refuses all unproved protected contexts before %s delete/unlink',
    async (provider) => {
      const api = await profile(provider)
      for (const context of [
        'general',
        'workspace',
        'chat',
        'knowledge-base',
        'copilot',
        'execution',
        'profile-pictures',
      ] as const)
        await expect(api.common.deleteFile({ key: 'old-flat-key.png', context })).rejects.toThrow()
      await expect(api.defaults.deleteFile('old-flat-key.png')).rejects.toThrow()
      await expect(api.direct('old-flat-key.png')).rejects.toThrow()
      noContacts()
    }
  )
  it.each(['s3', 'azure', 'vercel', 'local'])(
    'does not promote a real READ capability into DELETE through %s common/default/provider calls',
    async (provider) => {
      const api = await profile(provider)
      await api.withAuthorizedStorageRead('owned/file.txt', 'workspace', async () => {
        await expect(
          api.common.deleteFile({ key: 'owned/file.txt', context: 'workspace' })
        ).rejects.toThrow('File deletion is unavailable')
        await expect(api.defaults.deleteFile('owned/file.txt')).rejects.toThrow(
          'File deletion is unavailable'
        )
        await expect(api.direct('owned/file.txt')).rejects.toThrow('File deletion is unavailable')
      })
      noContacts()
    }
  )
  it.each(['s3', 'azure', 'vercel', 'local'])(
    'allows only the exact DELETE-purpose key through actual %s common and provider transport',
    async (provider) => {
      const api = await profile(provider)
      await api.withAuthorizedStorageDelete('owned/file.txt', 'workspace', async () => {
        await api.common.deleteFile({ key: 'owned/file.txt', context: 'workspace' })
        await api.direct('owned/file.txt')
      })
      if (provider === 's3') {
        expect(state.send).toHaveBeenCalledTimes(2)
        for (const [command] of state.send.mock.calls)
          expect(command.input).toEqual({ Bucket: 'shared-private', Key: 'owned/file.txt' })
      } else if (provider === 'azure') {
        expect(state.azureDelete).toHaveBeenCalledTimes(2)
        for (const context of state.azureDelete.mock.contexts)
          expect(context).toHaveProperty(
            'url',
            'https://fixtureaccount.blob.core.windows.net/shared/owned/file.txt'
          )
      } else if (provider === 'vercel') {
        expect(state.vercelDelete).toHaveBeenCalledTimes(2)
        expect(state.vercelDelete).toHaveBeenCalledWith('owned/file.txt', {
          token: 'synthetic-token',
        })
      } else {
        expect(state.unlink).toHaveBeenCalledTimes(2)
        expect(state.unlink).toHaveBeenCalledWith(join(localRoot!, 'uploads', 'owned/file.txt'))
      }
      await expect(
        api.common.deleteFile({ key: 'owned/file.txt', context: 'workspace' })
      ).rejects.toThrow('File deletion is unavailable')
    }
  )
  it.each(['s3', 'azure', 'vercel', 'local'])(
    'rejects a different key inside an otherwise genuine DELETE scope for %s',
    async (provider) => {
      const api = await profile(provider)
      await api.withAuthorizedStorageDelete('owned/file.txt', 'workspace', async () => {
        await expect(
          api.common.deleteFile({ key: 'other/file.txt', context: 'workspace' })
        ).rejects.toThrow()
        await expect(api.direct('other/file.txt')).rejects.toThrow()
      })
      noContacts()
    }
  )
  it.each(['s3', 'azure', 'vercel'])(
    'retains literal encoded SDK key identity rather than decoding an exact %s capability',
    async (provider) => {
      const api = await profile(provider)
      await api.withAuthorizedStorageDelete('owned%2Ffile.txt', 'workspace', () =>
        api.direct('owned%2Ffile.txt')
      )
      if (provider === 's3') expect(state.send.mock.calls[0][0].input.Key).toBe('owned%2Ffile.txt')
      else if (provider === 'azure')
        expect(state.azureDelete.mock.contexts[0]).toHaveProperty(
          'url',
          'https://fixtureaccount.blob.core.windows.net/shared/owned%252Ffile.txt'
        )
      else
        expect(state.vercelDelete).toHaveBeenCalledExactlyOnceWith('owned%2Ffile.txt', {
          token: 'synthetic-token',
        })
    }
  )
  it.each(['s3', 'azure'])(
    'fails closed with an unknown Copilot physical destination before %s transport',
    async (provider) => {
      if (provider === 's3') state.copilotBucket = ''
      else state.copilotContainer = ''
      const api = await profile(provider)
      await expect(
        api.common.deleteFile({ key: 'old-flat-key.png', context: 'workspace' })
      ).rejects.toThrow('File deletion is unavailable')
      await expect(api.direct('old-flat-key.png')).rejects.toThrow('File deletion is unavailable')
      noContacts()
    }
  )
  it.each(['s3', 'azure'])(
    'does not move an exact server DELETE cap across %s physical destinations',
    async (provider) => {
      if (provider === 's3') {
        state.generalBucket = 'disjoint-general'
        state.copilotBucket = 'protected-private'
      } else {
        state.generalContainer = 'disjoint'
        state.copilotContainer = 'protected'
      }
      const api = await profile(provider)
      await api.withAuthorizedStorageDelete('owned.txt', 'workspace', async () => {
        if (provider === 's3')
          await expect(
            (await import('./providers/s3/s3-client')).deleteFromS3('owned.txt', {
              bucket: 'protected-private',
              region: 'fixture-region',
            })
          ).rejects.toThrow('File deletion is unavailable')
        else
          await expect(
            (await import('./providers/azure/azure-client')).deleteFromAzure('owned.txt', {
              containerName: 'protected',
              accountName: 'fixtureaccount',
              accountKey: 'dGVzdC1vbmx5LWtleQ==',
            })
          ).rejects.toThrow('File deletion is unavailable')
      })
      noContacts()
    }
  )
  it.each(['s3', 'azure', 'vercel', 'local'])(
    'refuses encoded/traversal/archive object spellings before %s normalization or IO',
    async (provider) => {
      const api = await profile(provider)
      for (const key of [
        'owned%2Ffile.txt',
        'owned%252Ffile.txt',
        '../owned.png',
        'owned\\file.txt',
        'archived-enhanced-logs/private',
        '%61rchived-enhanced-logs/private',
      ])
        await expect(api.common.deleteFile({ key, context: 'workspace' })).rejects.toThrow()
      expect(() =>
        api.withAuthorizedStorageDelete('archived-enhanced-logs/private', 'workspace', () =>
          api.direct('archived-enhanced-logs/private')
        )
      ).toThrow()
      noContacts()
    }
  )
  it.each([
    ['s3', 'https://shared-private.s3.us-east-1.amazonaws.com/flat.png'],
    ['s3', 'https://s3.amazonaws.com/shared-private/flat.png'],
    ['s3', 's3://shared-private/flat.png'],
    ['azure', 'https://fixtureaccount.blob.core.windows.net/shared/flat.png'],
    ['vercel', 'https://store.public.blob.vercel-storage.com/flat.png'],
    ['local', '/uploads/flat.png'],
    ['local', 'file:///uploads/flat.png'],
  ])(
    'refuses protected %s cloud/local references independently of caller context: %s',
    async (provider, reference) => {
      const api = await profile(provider)
      expect(() => api.assertStorageDeleteReferenceAccess(reference, 'general')).toThrow()
      noContacts()
    }
  )
  it('does not let a source-proof query or a READ scope grant deletion through encoded serve aliases', async () => {
    const api = await profile('vercel')
    await api.withAuthorizedStorageRead('owned/file.png', 'copilot', async () => {
      for (const reference of [
        '/api/files/serve/vercel/owned%2Ffile.png?context=workspace&sourceProof=ingress-only',
        'https://studio.example/api/files/serve/vercel/owned%2Ffile.png?context=general',
        '/api/files/serve/owned%252Ffile.png?context=copilot',
      ])
        expect(() => api.assertStorageDeleteReferenceAccess(reference)).toThrow()
    })
    noContacts()
  })
})

describe('raw SDK key identity for READ purpose', () => {
  it.each(['common', 'provider'])(
    'does not let a READ cap for decoded spelling access an encoded literal through %s',
    async (lane) => {
      const api = await profile('vercel')
      const outcome = await Promise.allSettled([
        api.withAuthorizedStorageRead('owned/file.png', 'workspace', async () => {
          if (lane === 'common')
            await api.common.downloadFile({ key: 'owned%2Ffile.png', context: 'workspace' })
          else
            await (await import('./providers/vercel/vercel-client')).downloadFromVercel(
              'owned%2Ffile.png'
            )
        }),
      ])
      expect(state.vercelRead).not.toHaveBeenCalled()
      noContacts()
      expect(outcome[0].status).toBe('rejected')
    }
  )
})
