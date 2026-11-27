import { parentPort } from 'node:worker_threads'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })
const owners = new Map()
let renewing

async function renew() {
  const attempts = Array.from(owners, ([nonce, id]) => ({ nonce, id }))
  if (!attempts.length) return
  await sql`
    with live as (
      select p.id from pending_execution p
      join jsonb_to_recordset(${sql.json(attempts)}::jsonb) as a(id text, nonce text)
        on a.id = p.id and p.payload->>'localDocumentNonce' = a.nonce
      where p.billing_scope_type = 'local' and p.execution_type = 'document'
        and p.source = 'document_processing' and p.status = 'processing'
        and p.updated_at > (clock_timestamp() at time zone 'UTC') - interval '90 seconds'
      for update of p skip locked
    )
    update pending_execution p set updated_at = clock_timestamp() at time zone 'UTC'
    from live where p.id = live.id
  `
}

const timer = setInterval(() => {
  renewing ??= renew()
    .catch((error) => console.error('Document lease renewal failed', error.message))
    .finally(() => {
      renewing = undefined
    })
}, 30_000)

parentPort.on('message', async ({ type, id, nonce }) => {
  if (type === 'arm') {
    owners.set(nonce, id)
    parentPort.postMessage(nonce)
  } else if (type === 'disarm') {
    owners.delete(nonce)
  } else if (type === 'close') {
    clearInterval(timer)
    await renewing
    await sql.end()
    process.exit(0)
  }
})

parentPort.postMessage('ready')
