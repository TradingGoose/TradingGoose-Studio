import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

type Language = 'javascript' | 'python'
type Delivery = {
  rawBody: string
  headers: Record<string, string>
  duplicate?: boolean
  failEffect?: boolean
}
const secret = 'test-webhook-secret'
const event = {
  id: 'evt_original',
  type: 'workflow.execution.completed',
  data: { workflowId: 'workflow-1', executionId: 'execution-1' },
}
const deliveryHeaders = {
  'idempotency-key': 'delivery-1',
  'tradinggoose-delivery-id': 'delivery-1',
}

function example(locale: string, language: Language) {
  const doc = readFileSync(
    join(import.meta.dir, `../../apps/docs/content/docs/${locale}/execution/api.mdx`),
    'utf8'
  )
  const snippets = [...doc.matchAll(/^ {4}```(javascript|python)\n([\s\S]*?)^ {4}```/gm)]
  const snippet = snippets.find(
    (match) => match[1] === language && match[2].includes('Invalid signature')
  )?.[2]
  if (!snippet) throw new Error(`Missing ${locale} ${language} webhook example`)
  return snippet.replace(/^ {4}/gm, '').trim()
}

function delivery(
  body: unknown = event,
  headers: Record<string, string> = deliveryHeaders
): Delivery {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
  const signature = createHmac('sha256', secret).update(`123.${rawBody}`).digest('hex')
  return {
    rawBody,
    headers: { 'tradinggoose-signature': `t=123,v1=${signature}`, ...headers },
  }
}

async function run(language: Language, deliveries: Delivery[]) {
  const snippet = example('en', language)
  const code =
    language === 'javascript'
      ? `
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

let handler, request, calls = [];
const express = Object.assign(() => ({ post: (_path, _parser, fn) => { handler = fn; } }), { raw: () => null });
class DatabaseSync {
  isTransaction = true;
  exec(sql) { calls.push(sql.trim()); }
  prepare() {
    return { run(...args) { calls.push(args); return { changes: request.duplicate ? 0 : 1 }; } };
  }
}
function effect() {
  calls.push('effect');
  if (request.failEffect) throw new Error('Injected effect failure');
}
runInNewContext(${JSON.stringify(
          snippet
            .replace(/^import .*;$/gm, '')
            .replace(
              '// Apply your database side effects here using db, inside this transaction.',
              'effect();'
            )
        )}, { crypto, Buffer, express, DatabaseSync, effect, process: { env: { WEBHOOK_SECRET: process.env.WEBHOOK_SECRET } } });
const results = JSON.parse(readFileSync(0, 'utf8')).map(item => {
  request = item;
  calls = [];
  const res = { code: 200, status(code) { this.code = code; return this; }, send() {}, sendStatus(code) { this.code = code; } };
  handler({ headers: item.headers, body: Buffer.from(item.rawBody) }, res);
  return { status: res.code, calls };
});
console.log(JSON.stringify(results));
`
      : `
import json, sys
from unittest.mock import MagicMock

flask = sys.modules['flask'] = MagicMock()
flask.Flask.return_value.route.return_value = lambda handler: handler
sqlite = sys.modules['sqlite3'] = MagicMock()
connection = sqlite.connect.return_value
class Headers(dict):
    def get(self, key, default=None):
        return super().get(key.lower(), default)
calls = []
def execute(sql, args=None):
    calls.append(args if args is not None else sql.strip())
    return connection.cursor.return_value
connection.execute.side_effect = execute
connection.__exit__.side_effect = lambda error, *_: calls.append('ROLLBACK' if error else 'COMMIT')
def effect():
    calls.append('effect')
    if item.get('failEffect'):
        raise RuntimeError('Injected effect failure')
${snippet.replace(
  '# Apply your database side effects here using db, inside this transaction.',
  'effect()'
)}
results = []
for item in json.load(sys.stdin):
    calls = []
    connection.cursor.return_value.rowcount = 0 if item.get('duplicate') else 1
    flask.request.headers = Headers(item['headers'])
    flask.request.get_data.return_value = item['rawBody']
    flask.request.get_json.return_value = json.loads(item['rawBody'])
    results.append(dict(status=webhook()[1], calls=calls))
print(json.dumps(results))
`
  const process = Bun.spawn(
    language === 'javascript'
      ? ['node', '--input-type=module', '-e', code]
      : ['python3', '-c', code],
    {
      env: { ...Bun.env, WEBHOOK_SECRET: secret },
      stdin: new Blob([JSON.stringify(deliveries)]),
      stdout: 'pipe',
      stderr: 'pipe',
    }
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`${language} example failed: ${stderr}`)
  return JSON.parse(stdout) as { status: number; calls: (string | string[])[] }[]
}

describe.each(['javascript', 'python'] as const)('%s webhook documentation example', (language) => {
  it.each(['es', 'zh'])('keeps the %s handler identical to English', (locale) => {
    expect(example(locale, language)).toBe(example('en', language))
  })

  it('declares both receipt uniqueness constraints and a conflict-safe insert', () => {
    const sql = example('en', language).replace(/\s+/g, ' ')
    expect(sql).toContain('delivery_id TEXT PRIMARY KEY')
    expect(sql).toContain('UNIQUE (event_type, workflow_id, execution_id)')
    expect(sql).toContain(
      'INSERT INTO webhook_receipts (delivery_id, event_type, workflow_id, execution_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
    )
  })

  it('rejects invalid authentication, delivery headers, and signed event identities before writing', async () => {
    const results = await run(language, [
      delivery(event, { ...deliveryHeaders, 'tradinggoose-signature': 'invalid' }),
      delivery(event, {}),
      delivery(event, { ...deliveryHeaders, 'idempotency-key': 'different' }),
      delivery(event, { 'idempotency-key': ' ' }),
      delivery(null),
      delivery({ ...event, type: 'different' }),
      delivery({ ...event, data: { executionId: 'execution-1' } }),
      delivery({ ...event, data: { workflowId: 'workflow-1', executionId: 123 } }),
    ])
    expect(results.map(({ status }) => status)).toEqual([401, 400, 400, 400, 400, 400, 400, 400])
    for (const { calls } of results) expect(calls).toEqual([])
  })

  it('rolls back a failed effect, commits a retry and skips the effect for a duplicate receipt', async () => {
    const claim = ['delivery-1', event.type, event.data.workflowId, event.data.executionId]
    expect(
      await run(language, [
        { ...delivery(), failEffect: true },
        delivery(event, { 'idempotency-key': 'delivery-1' }),
        {
          ...delivery(
            { ...event, id: 'regenerated' },
            { 'tradinggoose-delivery-id': 'delivery-1' }
          ),
          duplicate: true,
        },
      ])
    ).toEqual([
      { status: 500, calls: ['BEGIN IMMEDIATE', claim, 'effect', 'ROLLBACK'] },
      { status: 200, calls: ['BEGIN IMMEDIATE', claim, 'effect', 'COMMIT'] },
      { status: 200, calls: ['BEGIN IMMEDIATE', claim, 'COMMIT'] },
    ])
  })
})
