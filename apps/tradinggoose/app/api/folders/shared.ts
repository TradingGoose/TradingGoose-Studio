import type { db } from '@tradinggoose/db'
import { workflowFolder } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'

type FolderTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const FOLDER_WRITE_LOCK_NAMESPACE = 1_904_202_621

export const lockFolderWrites = (tx: FolderTransaction, workspaceId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(${FOLDER_WRITE_LOCK_NAMESPACE}, hashtext(${workspaceId}))`
  )

export async function isRootFolderInWorkspace(
  tx: FolderTransaction,
  folderId: string,
  workspaceId: string
) {
  const [folder] = await tx
    .select({
      workspaceId: workflowFolder.workspaceId,
      parentId: workflowFolder.parentId,
    })
    .from(workflowFolder)
    .where(eq(workflowFolder.id, folderId))
    .limit(1)

  return folder?.workspaceId === workspaceId && folder.parentId === null
}
