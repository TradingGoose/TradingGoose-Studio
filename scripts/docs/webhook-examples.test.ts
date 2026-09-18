import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

type Language = 'javascript' | 'python'
type Delivery = { rawBody: string; headers: Record<string, string> }
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

async function withDatabase(test: (path: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'webhook-docs-'))
  try {
    await test(join(directory, 'receipts.sqlite'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function run(language: Language, database: string, deliveries: Delivery[]) {
  const snippet = example('en', language)
  const code =
    language === 'javascript'
      ? `
      let handler;
      const express = Object.assign(() => ({ post: (_path, _parser, callback) => { handler = callback; } }), { raw: () => null });
      ${snippet.replace("import express from 'express';", '').replace(
        '// Apply your database side effects here using db, inside this transaction.',
        `db.exec('INSERT INTO effects DEFAULT VALUES');
        if (req.headers['test-delay']) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        if (req.headers['test-fail']) throw new Error('Injected effect failure');`
      )}
      db.exec('CREATE TABLE IF NOT EXISTS effects (id INTEGER PRIMARY KEY)');
      const requests = JSON.parse((await import('node:fs')).readFileSync(0, 'utf8'));
      const statuses = requests.map(({ rawBody, headers }) => {
        const res = { code: 200, status(code) { this.code = code; return this; }, send() {}, sendStatus(code) { this.code = code; } };
        handler({ headers, body: Buffer.from(rawBody) }, res);
        return res.code;
      });
      const count = (table) => db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count;
      console.log(JSON.stringify({ statuses, receipts: count('webhook_receipts'), effects: count('effects') }));
      db.close();
    `
      : `
import json, sys, types, time
flask = types.ModuleType('flask')
flask.request = types.SimpleNamespace()
class Flask:
    def __init__(self, name):
        self.logger = types.SimpleNamespace(exception=lambda message: None)
    def route(self, *args, **kwargs):
        return lambda handler: handler
flask.Flask = Flask
sys.modules['flask'] = flask
class Headers(dict):
    def get(self, key, default=None):
        return super().get(key.lower(), default)
${snippet.replace(
  '# Apply your database side effects here using db, inside this transaction.',
  `db.execute('INSERT INTO effects DEFAULT VALUES')
            if request.headers.get('test-delay'): time.sleep(0.1)
            if request.headers.get('test-fail'): raise RuntimeError('Injected effect failure')`
)}
with closing(sqlite3.connect(database_path)) as connection, connection:
    connection.execute('CREATE TABLE IF NOT EXISTS effects (id INTEGER PRIMARY KEY)')
statuses = []
for item in json.load(sys.stdin):
    flask.request.headers = Headers(item['headers'])
    flask.request.get_data = lambda as_text: item['rawBody']
    flask.request.get_json = lambda: json.loads(item['rawBody'])
    statuses.append(webhook()[1])
with closing(sqlite3.connect(database_path)) as connection:
    counts = {table: connection.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] for table in ('webhook_receipts', 'effects')}
print(json.dumps(dict(statuses=statuses, receipts=counts['webhook_receipts'], effects=counts['effects'])))
`
  const process = Bun.spawn(
    language === 'javascript'
      ? ['node', '--input-type=module', '-e', code]
      : ['python3', '-c', code],
    {
      env: { ...Bun.env, WEBHOOK_SECRET: secret, WEBHOOK_DB_PATH: database },
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
  return JSON.parse(stdout) as { statuses: number[]; receipts: number; effects: number }
}

describe.each(['javascript', 'python'] as const)('%s webhook documentation example', (language) => {
  it.each(['es', 'zh'])('keeps the %s handler identical to English', (locale) => {
    expect(example(locale, language)).toBe(example('en', language))
  })

  it('rejects invalid authentication, delivery headers, and signed event identities', () =>
    withDatabase(async (database) => {
      const requests = [
        delivery(event, { ...deliveryHeaders, 'tradinggoose-signature': 'invalid' }),
        delivery(event, {}),
        delivery(event, { ...deliveryHeaders, 'idempotency-key': 'different' }),
        delivery(event, { 'idempotency-key': ' ' }),
        delivery(null),
        delivery({ ...event, type: 'different' }),
        delivery({ ...event, data: { executionId: 'execution-1' } }),
        delivery({ ...event, data: { workflowId: 'workflow-1', executionId: 123 } }),
      ]
      expect(await run(language, database, requests)).toEqual({
        statuses: [401, 400, 400, 400, 400, 400, 400, 400],
        receipts: 0,
        effects: 0,
      })
    }))

  it('deduplicates retries, regenerated payload IDs, and substituted unsigned delivery headers', () =>
    withDatabase(async (database) => {
      const requests = [
        delivery(),
        delivery(),
        delivery({ ...event, id: 'evt_regenerated' }),
        delivery(event, {
          'idempotency-key': 'substituted',
          'tradinggoose-delivery-id': 'substituted',
        }),
      ]
      expect(await run(language, database, requests)).toEqual({
        statuses: [200, 200, 200, 200],
        receipts: 1,
        effects: 1,
      })
    }))

  it('accepts either delivery header and still processes distinct executions', () =>
    withDatabase(async (database) => {
      const nextEvent = { ...event, data: { ...event.data, executionId: 'execution-2' } }
      expect(
        await run(language, database, [
          delivery(event, { 'idempotency-key': 'delivery-1' }),
          delivery(event, { 'tradinggoose-delivery-id': 'delivery-1' }),
          delivery(nextEvent, { 'tradinggoose-delivery-id': 'delivery-2' }),
        ])
      ).toEqual({ statuses: [200, 200, 200], receipts: 2, effects: 2 })
    }))

  it('rolls back failed effects and persists successful receipts across process restarts', () =>
    withDatabase(async (database) => {
      expect(
        await run(language, database, [delivery(event, { ...deliveryHeaders, 'test-fail': '1' })])
      ).toEqual({ statuses: [500], receipts: 0, effects: 0 })
      expect(await run(language, database, [delivery()])).toEqual({
        statuses: [200],
        receipts: 1,
        effects: 1,
      })
      expect(await run(language, database, [delivery()])).toEqual({
        statuses: [200],
        receipts: 1,
        effects: 1,
      })
    }))

  it('serializes competing receiver processes without repeating effects', () =>
    withDatabase(async (database) => {
      await run(language, database, [])
      const request = delivery(event, { ...deliveryHeaders, 'test-delay': '1' })
      const results = await Promise.all([
        run(language, database, [request]),
        run(language, database, [request]),
      ])
      for (const result of results) {
        expect(result).toEqual({ statuses: [200], receipts: 1, effects: 1 })
      }
    }))
})
