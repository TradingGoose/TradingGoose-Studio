#!/usr/bin/env bun

import { db } from '@tradinggoose/db'
import { workflowCheckpoints } from '@tradinggoose/db/schema'
import { sql } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CleanupWorkflowCheckpoints')

function parseArgs() {
  const args = process.argv.slice(2)
  return {
    apply: args.includes('--apply'),
    help: args.includes('--help') || args.includes('-h'),
  }
}

async function main() {
  const { apply, help } = parseArgs()
  if (help) {
    console.log(`Usage: bun run apps/tradinggoose/scripts/cleanup-workflow-checkpoints.ts [--apply]

Runs a report-only count by default. Use --apply to delete all workflow_checkpoints rows after the checkpoint feature is retired.
`)
    return
  }

  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(workflowCheckpoints)
  const count = Number(countRow?.count ?? 0)

  if (!apply) {
    console.log(JSON.stringify({ mode: 'report-only', checkpointCount: count }, null, 2))
    return
  }

  await db.delete(workflowCheckpoints)
  console.log(JSON.stringify({ mode: 'apply', deletedCheckpointCount: count }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Failed to clean up workflow checkpoints', error)
    process.exitCode = 1
  })
}
