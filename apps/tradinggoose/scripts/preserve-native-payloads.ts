import { lstat, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'
import { z } from 'zod'
import { workflowMessageDigest } from '../lib/mastra/messages'
import { closeNativeRuntime } from '../lib/mastra/runtime'
import { transferWorkflowMemory } from '../lib/mastra/workflow-memory'
import { preserveHistoricalWorkflowPayload } from '../lib/workflow-archive/lifecycle'

// Offline preservation only. This command never deletes source rows, migrates native DDL or runs work.
if (process.env.WORKFLOW_ADMISSIONS_CLOSED !== 'true' || !process.argv.includes('--execute'))
  throw new Error(
    'Require --execute with admissions/writers closed and operational quiescence established'
  )
const mode = process.argv[2]
const sourceUrl = process.env.PRESERVATION_SOURCE_DATABASE_URL
if (!sourceUrl) throw new Error('Explicit protected source database URL is required')
if (mode === 'records' && sourceUrl !== process.env.DATABASE_URL)
  throw new Error(
    'Records preservation source must be the explicitly selected application database'
  )
const source = postgres(sourceUrl, { max: 1, prepare: false })
const evidence: unknown[] = []
const backupPath = process.env.PRESERVATION_BACKUP_PATH
if (!backupPath) throw new Error('Explicit protected source backup path is required')
if (
  !path.isAbsolute(backupPath) ||
  [path.resolve('/uploads'), path.resolve(process.cwd(), 'uploads')].some(
    (root) => backupPath === root || backupPath.startsWith(root + path.sep)
  )
)
  throw new Error('Protected source backup must be absolute and outside public uploads')
async function backupSource(id: string, record: unknown) {
  const filename = `${backupPath}.${encodeURIComponent(id)}.json`
  const bytes = JSON.stringify(record)
  try {
    const file = await open(filename, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await lstat(filename)
    if (!existing.isFile() || (existing.mode & 0o077) !== 0)
      throw new Error('Existing protected source backup is not an owner-only regular file')
    if ((await readFile(filename, 'utf8')) !== bytes) throw error
  }
}
const messageSchema = z
  .object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })
  .strict()
try {
  if (mode === 'memory') {
    let offset = 0
    for (;;) {
      // Source is the retired application table, never a SQL reader of native Mastra tables.
      const rows =
        await source`select m.id, m.key, m.type, m.data, m.created_at, m.workflow_id, w.user_id from memory m join workflow w on w.id = m.workflow_id where m.deleted_at is null order by m.id limit 50 offset ${offset}`
      if (!rows.length) break
      for (const row of rows) {
        await backupSource(row.id, row)
        if (row.type !== 'agent' || !row.user_id)
          throw new Error(`Classify unsupported Memory source ${row.id}; source remains intact`)
        const messages = z.array(messageSchema).parse(row.data)
        const result = await transferWorkflowMemory(
          { success: true, userId: row.user_id },
          row.workflow_id,
          row.key,
          messages,
          { id: row.id, createdAt: new Date(row.created_at) }
        )
        evidence.push({
          sourceId: row.id,
          workflowId: row.workflow_id,
          key: row.key,
          count: messages.length,
          semanticDigest: workflowMessageDigest(result.data),
          nativeId: result.id,
        })
      }
      offset += rows.length
    }
  } else if (mode === 'records') {
    let offset = 0
    for (;;) {
      const rows =
        await source`select * from workflow_execution_logs order by id limit 50 offset ${offset}`
      if (!rows.length) break
      for (const row of rows) {
        evidence.push({
          sourceId: row.id,
          reference: await preserveHistoricalWorkflowPayload(row.id, (currentSource) =>
            backupSource(row.id, currentSource)
          ),
        })
      }
      offset += rows.length
    }
  } else throw new Error('Select memory or records preservation mode')
  const destination = process.env.PRESERVATION_EVIDENCE_PATH
  if (!destination) throw new Error('Explicit protected preservation evidence path is required')
  await writeFile(destination, JSON.stringify(evidence, null, 2), { mode: 0o600, flag: 'wx' })
} finally {
  await source.end()
  await closeNativeRuntime()
}
