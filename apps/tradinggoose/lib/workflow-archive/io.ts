import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'
import { get, put } from '@vercel/blob'
import { env, isTruthy } from '@/lib/env'
import {
  type ArchiveReference,
  type ArchiveScope,
  byteDigest,
  createArchiveBytes,
  readArchiveBytes,
} from './format'

function configuration() {
  if (!isTruthy(env.WORKFLOW_ARCHIVE_PRIVATE_VERIFIED))
    throw new Error(
      'Private archive destination and prior URL revocation must be verified before archival handoff'
    )
  const provider = env.WORKFLOW_ARCHIVE_PROVIDER
  if (!provider) throw new Error('Explicit private workflow archive provider is required')
  if (provider === 's3') {
    const bucket = env.WORKFLOW_ARCHIVE_S3_BUCKET
    if (
      !bucket ||
      !env.WORKFLOW_ARCHIVE_S3_REGION ||
      [
        env.S3_BUCKET_NAME,
        env.S3_KB_BUCKET_NAME,
        env.S3_EXECUTION_FILES_BUCKET_NAME ?? 'tradinggoose-execution-files',
        env.S3_CHAT_BUCKET_NAME,
        env.S3_COPILOT_BUCKET_NAME,
        env.S3_PROFILE_PICTURES_BUCKET_NAME,
      ].includes(bucket)
    )
      throw new Error(
        'Archive S3 bucket must be explicit and distinct from public file destinations'
      )
  }
  if (provider === 'azure') {
    const container = env.WORKFLOW_ARCHIVE_AZURE_CONTAINER
    if (
      !container ||
      [
        env.AZURE_STORAGE_CONTAINER_NAME,
        env.AZURE_STORAGE_KB_CONTAINER_NAME,
        env.AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME ?? 'tradinggoose-execution-files',
        env.AZURE_STORAGE_CHAT_CONTAINER_NAME,
        env.AZURE_STORAGE_COPILOT_CONTAINER_NAME,
        env.AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME,
      ].includes(container) ||
      !(
        env.WORKFLOW_ARCHIVE_AZURE_CONNECTION_STRING ||
        (env.WORKFLOW_ARCHIVE_AZURE_ACCOUNT && env.WORKFLOW_ARCHIVE_AZURE_KEY)
      )
    )
      throw new Error('Explicit separate private Azure archive destination is required')
  }
  if (
    provider === 'vercel' &&
    (!env.WORKFLOW_ARCHIVE_VERCEL_TOKEN ||
      !env.WORKFLOW_ARCHIVE_VERCEL_ORIGIN ||
      [env.BLOB_READ_WRITE_TOKEN, env.VERCEL_BLOB_READ_WRITE_TOKEN].includes(
        env.WORKFLOW_ARCHIVE_VERCEL_TOKEN
      ))
  )
    throw new Error('A separate private Vercel archive store is required')
  return provider
}

function azureContainer() {
  const client = env.WORKFLOW_ARCHIVE_AZURE_CONNECTION_STRING
    ? BlobServiceClient.fromConnectionString(env.WORKFLOW_ARCHIVE_AZURE_CONNECTION_STRING)
    : new BlobServiceClient(
        `https://${env.WORKFLOW_ARCHIVE_AZURE_ACCOUNT}.blob.core.windows.net`,
        new StorageSharedKeyCredential(
          env.WORKFLOW_ARCHIVE_AZURE_ACCOUNT!,
          env.WORKFLOW_ARCHIVE_AZURE_KEY!
        )
      )
  return client.getContainerClient(env.WORKFLOW_ARCHIVE_AZURE_CONTAINER!)
}

async function localPath(key: string, create: boolean) {
  const root = env.WORKFLOW_ARCHIVE_LOCAL_ROOT
  if (!root || !path.isAbsolute(root))
    throw new Error('An absolute private archive root is required')
  const resolved = path.resolve(root)
  for (const publicRoot of [path.resolve('/uploads'), path.resolve(process.cwd(), 'uploads')])
    if (resolved === publicRoot || resolved.startsWith(publicRoot + path.sep))
      throw new Error('Archive root must be outside public uploads')
  if (create) await mkdir(resolved, { recursive: true, mode: 0o700 })
  if ((await realpath(resolved)) !== resolved || (await lstat(resolved)).isSymbolicLink())
    throw new Error('Archive root cannot be a symlink')
  if ((await lstat(resolved)).mode & 0o077)
    throw new Error('Archive root must have private owner-only permissions')
  const filename = path.resolve(resolved, key)
  if (!filename.startsWith(resolved + path.sep))
    throw new Error('Archive path escapes private root')
  const parent = path.dirname(filename)
  if (create) await mkdir(parent, { recursive: true, mode: 0o700 })
  if ((await realpath(parent)) !== parent) throw new Error('Archive path cannot traverse symlinks')
  return filename
}

function validateReference(reference: ArchiveReference) {
  if (
    reference.version !== 1 ||
    reference.purpose !== 'workflow-archive' ||
    !/^[a-f0-9]{64}$/.test(reference.digest) ||
    reference.key !==
      `archived-enhanced-logs/${reference.digest.slice(0, 2)}/${reference.digest}.json`
  )
    throw new Error('Invalid internal archive reference')
  if (configuration() !== reference.provider)
    throw new Error('Archive provider configuration does not match retained reference')
}

/** Internal provider dispatch only. No general context, signer, token or user-serving URL. */
export async function readPrivateArchive(reference: ArchiveReference): Promise<any> {
  validateReference(reference)
  let bytes: Buffer
  if (reference.provider === 'local') {
    const filename = await localPath(reference.key, false)
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      bytes = await file.readFile()
    } finally {
      await file.close()
    }
  } else if (reference.provider === 's3') {
    const client = new S3Client({ region: env.WORKFLOW_ARCHIVE_S3_REGION, maxAttempts: 1 })
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: env.WORKFLOW_ARCHIVE_S3_BUCKET, Key: reference.key })
      )
      if (!result.Body) throw new Error('Private archive body is missing')
      bytes = Buffer.from(await result.Body.transformToByteArray())
    } finally {
      client.destroy()
    }
  } else if (reference.provider === 'azure') {
    bytes = await azureContainer().getBlockBlobClient(reference.key).downloadToBuffer()
  } else {
    const result = await get(reference.key, {
      access: 'private',
      token: env.WORKFLOW_ARCHIVE_VERCEL_TOKEN,
      useCache: false,
    })
    if (
      !result ||
      result.statusCode !== 200 ||
      new URL(result.blob.url).origin !== new URL(env.WORKFLOW_ARCHIVE_VERCEL_ORIGIN!).origin
    )
      throw new Error('Private archive store or body mismatch')
    bytes = Buffer.from(await new Response(result.stream).arrayBuffer())
  }
  return readArchiveBytes(reference, bytes)
}

export async function writePrivateArchive(
  scope: ArchiveScope,
  payload: unknown
): Promise<ArchiveReference> {
  const provider = configuration()
  const bytes = createArchiveBytes(scope, payload)
  const digest = byteDigest(bytes)
  const reference: ArchiveReference = {
    version: 1,
    purpose: 'workflow-archive',
    ...scope,
    provider,
    digest,
    key: `archived-enhanced-logs/${digest.slice(0, 2)}/${digest}.json`,
  }
  if (provider === 'local') {
    const filename = await localPath(reference.key, true)
    try {
      const file = await open(
        filename,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      )
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  } else if (provider === 's3') {
    const client = new S3Client({ region: env.WORKFLOW_ARCHIVE_S3_REGION, maxAttempts: 1 })
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: env.WORKFLOW_ARCHIVE_S3_BUCKET,
          Key: reference.key,
          Body: bytes,
          ContentType: 'application/json',
          IfNoneMatch: '*',
        })
      )
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
        throw error
    } finally {
      client.destroy()
    }
  } else if (provider === 'azure') {
    try {
      await azureContainer()
        .getBlockBlobClient(reference.key)
        .uploadData(bytes, {
          conditions: { ifNoneMatch: '*' },
          blobHTTPHeaders: { blobContentType: 'application/json' },
        })
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 412) throw error
    }
  } else {
    try {
      const result = await put(reference.key, bytes, {
        access: 'private',
        token: env.WORKFLOW_ARCHIVE_VERCEL_TOKEN,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: false,
      })
      if (new URL(result.url).origin !== new URL(env.WORKFLOW_ARCHIVE_VERCEL_ORIGIN!).origin)
        throw new Error('Archive Vercel store identity mismatch')
    } catch (error) {
      await readPrivateArchive(reference).catch(() => {
        throw error
      })
    }
  }
  const returned = await readPrivateArchive(reference)
  if (JSON.stringify(createArchiveBytes(scope, returned)) !== JSON.stringify(bytes))
    throw new Error('Private workflow archive readback mismatch')
  return reference
}
