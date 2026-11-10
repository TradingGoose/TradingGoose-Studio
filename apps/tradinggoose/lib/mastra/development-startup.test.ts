/** Execute configured startup orchestration with finite stand-ins for the services. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const rootPackage = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
const appPackage = JSON.parse(
  readFileSync(join(repository, 'apps/tradinggoose/package.json'), 'utf8')
)
const docsPackage = JSON.parse(readFileSync(join(repository, 'apps/docs/package.json'), 'utf8'))
const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

// Execute the actual configured script strings. These finite stand-ins never import application code.
const standIn = String.raw`
const fs = require('node:fs'); const path = require('node:path');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2); const command = path.basename(process.argv[1]);
const event = (type) => fs.appendFileSync(process.env.DEV_EVENTS, JSON.stringify({type, cwd:process.cwd()})+'\n');
function shell(script, cwd = process.cwd()) {
  return new Promise((resolve,reject) => {
    const child = spawn('/bin/sh', ['-c',script], {cwd,env:process.env,stdio:'inherit'});
    child.on('error',reject); child.on('exit',(code) => resolve(code ?? 99));
  });
}
function run(name,cwd = process.cwd()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd,'package.json'),'utf8'));
  if (!pkg.scripts?.[name]) throw new Error('Unknown synthetic script '+name);
  return shell(pkg.scripts[name],cwd);
}
function leaf(name) {
  event('leaf:'+name); return 0;
}
(async () => {
  if(command==='bun') {
    if(args[0]==='run' && args[1]==='socket-server/index.ts') return leaf('sockets');
    if(args[0]==='run' && args.length===2) return run(args[1]);
  }
  if(command==='next') return leaf(process.cwd().endsWith('/apps/docs')?'docs':'next');
  if(command==='email') return leaf('email');
  if(command==='npx' && args.join(' ')==='trigger.dev@latest dev') return leaf('trigger');
  if(command==='concurrently') {
    const results=await Promise.all(args.slice(-2).map((script)=>shell(script)));
    return results.find((code)=>code!==0) ?? 0;
  }
  if(command==='turbo' && args.join(' ')==='run dev') {
    const results=await Promise.all(['apps/docs','apps/tradinggoose'].map((dir)=>run('dev',path.join(process.cwd(),dir))));
    return results.find((code)=>code!==0) ?? 0;
  }
  throw new Error('Unexpected synthetic leaf '+command+' '+args.join(' '));
})().then((code)=>{process.exitCode=code},(error)=>{console.error(error);process.exitCode=99});
`

type Event = { type: string; cwd: string }
function execute(scope: 'root' | 'app', name: string) {
  const root = mkdtempSync(join(tmpdir(), 'tg-development-startup-'))
  directories.push(root)
  for (const [name, value] of [
    ['package.json', rootPackage],
    ['apps/tradinggoose/package.json', appPackage],
    ['apps/docs/package.json', docsPackage],
  ] as const) {
    const target = join(root, name)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, JSON.stringify(value))
  }
  const bin = join(root, 'safe-bin')
  mkdirSync(bin)
  for (const command of ['bun', 'next', 'email', 'npx', 'concurrently', 'turbo']) {
    writeFileSync(join(bin, command), `#!${process.execPath}\n${standIn}`, { mode: 0o755 })
  }
  const events = join(root, 'events.jsonl')
  writeFileSync(events, '')
  const cwd = scope === 'root' ? root : join(root, 'apps/tradinggoose')
  const script = (scope === 'root' ? rootPackage : appPackage).scripts[name]
  const result = spawnSync('/bin/sh', ['-c', script], {
    cwd,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      NODE_ENV: 'test',
      DEV_EVENTS: events,
    },
    encoding: 'utf8',
    timeout: 10_000,
  })
  expect(result.error).toBeUndefined()
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    events: readFileSync(events, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)) as Event[],
  }
}

const entries = [
  ['root', 'dev', ['docs', 'next']],
  ['root', 'dev:docs', ['docs']],
  ['root', 'dev:next', ['next']],
  ['root', 'dev:sockets', ['sockets']],
  ['root', 'dev:full', ['next', 'sockets']],
  ['root', 'dev:trigger', ['trigger']],
  ['app', 'dev', ['next']],
  ['app', 'dev:sockets', ['sockets']],
  ['app', 'dev:full', ['next', 'sockets']],
  ['app', 'email:dev', ['email']],
] as const

it.each(entries)(
  '%s %s starts its consumers directly from workspace source',
  (scope, name, leaves) => {
    const result = execute(scope, name)
    expect(result.status, result.output).toBe(0)
    expect(result.events.map(({ type }) => type).sort()).toEqual(
      leaves.map((leaf) => `leaf:${leaf}`).sort()
    )
  }
)
