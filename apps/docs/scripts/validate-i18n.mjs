import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const root = new URL('../content/docs/', import.meta.url)
const locales = ['en', 'es', 'zh']
const errors = []

async function filesUnder(locale) {
  const base = new URL(`${locale}/`, root)
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else files.push(relative(base.pathname, path))
    }
  }
  await walk(base.pathname)
  return files.sort()
}

function structure(text) {
  return {
    fencedCode: [...text.matchAll(/^```[^\n]*\n[\s\S]*?^```/gm)].map((match) => match[0]),
    inlineCode: [...text.matchAll(/`[^`\n]+`/g)].map((match) => match[0]),
    imports: [...text.matchAll(/^import\s.+$/gm)].map((match) => match[0]),
    headings: [...text.matchAll(/^#{1,6}\s/gm)].length,
    links: [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]),
    callouts: [...text.matchAll(/^<(Callout|Warning|Info|Tip)\b/gm)].length,
    tags: [...text.matchAll(/<\/?([A-Za-z][\w.]*)\b/g)].map((match) => match[1]),
    props: [
      ...new Set([...text.matchAll(/\b([A-Za-z_$][\w$-]*)\s*=/g)].map((match) => match[1])),
    ].sort(),
    objectKeys: [...text.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]),
    technicalValues: [...text.matchAll(/"(?:id|type)"\s*:\s*"([^"]*)"/g)].map(
      (match) => match[1]
    ),
    technicalLabels: [...text.matchAll(/"label"\s*:\s*"([^"]*)"/g)]
      .map((match) => match[1])
      .filter((value) => !/\s/.test(value) && /(?:\d|[-_.:/])/.test(value)),
    urlsAndUris: [
      ...text.matchAll(/\b(?:https?:\/\/|spotify:)[^\s"')\\]+/g),
    ].map((match) => match[0]),
  }
}

const inventories = Object.fromEntries(
  await Promise.all(locales.map(async (locale) => [locale, await filesUnder(locale)]))
)
const expected = JSON.stringify(inventories.en)

for (const locale of ['es', 'zh']) {
  if (JSON.stringify(inventories[locale]) !== expected) {
    errors.push(`${locale} does not match the English ${inventories.en.length}-file inventory`)
  }
}

for (const path of inventories.en) {
  if (extname(path) !== '.mdx') continue
  const source = await readFile(new URL(`en/${path}`, root), 'utf8')
  const sourceStructure = structure(source)
  for (const locale of ['es', 'zh']) {
    const translated = await readFile(new URL(`${locale}/${path}`, root), 'utf8')
    const translatedStructure = structure(translated)
    for (const key of [
      'fencedCode',
      'inlineCode',
      'imports',
      'headings',
      'links',
      'callouts',
      'tags',
      'props',
      'objectKeys',
      'technicalValues',
      'technicalLabels',
      'urlsAndUris',
    ]) {
      if (JSON.stringify(translatedStructure[key]) !== JSON.stringify(sourceStructure[key])) {
        errors.push(`${locale}/${path} changed protected ${key}`)
      }
    }
    if (translated === source) errors.push(`${locale}/${path} is an untranslated English copy`)
  }
}

const appRoot = new URL('../', import.meta.url)
for (const path of [
  'package.json',
  'lib/i18n.ts',
  'app/[lang]/layout.tsx',
  'app/[lang]/[[...slug]]/page.tsx',
  'app/llms-full.txt/route.ts',
]) {
  const text = await readFile(new URL(path, appRoot), 'utf8')
  if (/lingo\.dev|pageTree\[[^\]]+\]\s*\?\?/i.test(text)) {
    errors.push(`${path} contains forbidden translation tooling or locale fallback`)
  }
}

const i18nSource = await readFile(new URL('lib/i18n.ts', appRoot), 'utf8')
if (!/defaultLanguage:\s*'en'/.test(i18nSource) || !/languages:\s*\['en', 'es', 'zh'\]/.test(i18nSource)) {
  errors.push('lib/i18n.ts must own exactly en, es, zh with en as default')
}

const llmsRoute = await readFile(new URL('app/llms-full.txt/route.ts', appRoot), 'utf8')
if (!/i18n\.languages\.filter/.test(llmsRoute) || /['"](?:fr|de|ja)['"]/.test(llmsRoute)) {
  errors.push('app/llms-full.txt/route.ts must derive locale prefixes from canonical i18n')
}

const englishProseWord =
  /\b(?:the|and|is|are|was|were|be|been|this|that|these|those|of|for|into|about|after|before|first|last|more|less|all|any|each|other|only|if|else|can|will|should|must|requires?|used?|using|select|enter|leave|empty|receive|retrieve|create|update|delete|manage|send|defaults?|today|available|to|your|from|when|with|generate|plays|specific)\b/gi
const distinctiveEnglish = /\b(?:your|when|generate|plays|specific|defaults?)\b/i
function containsMixedProse(locale, text) {
  return text.split('\n').filter((line) => {
    const words = line.match(englishProseWord) ?? []
    if (locale === 'zh' && !/[\u3400-\u9fff]/.test(line)) return false
    return distinctiveEnglish.test(line) || words.length >= 2
  })
}
function isAllowedResidual(locale, path, line) {
  if (
    locale === 'es' &&
    path === 'blocks/memory.mdx' &&
    /Add Memory|Get Memory|Get All Memories|Delete Memory/.test(line)
  ) {
    return true
  }
  if (
    path === 'copilot/index.mdx' &&
    /Limited \(default\)|Today|Yesterday|This Week|Last Week|Older/.test(line)
  ) {
    return true
  }
  if (path === 'tools/neo4j.mdx' && /\b(?:DETACH DELETE|DELETE)\b/.test(line)) return true
  if (path === 'tools/posthog.mdx' && /HogQL|SELECT/.test(line)) return true
  if (path === 'tools/salesforce.mdx' && /SOQL|SELECT/.test(line)) return true
  return false
}
if (containsMixedProse('es', 'Texto a generate embeddings').length === 0) {
  errors.push('validator self-test failed to detect mixed Spanish prose')
}
if (containsMixedProse('zh', '文本到generate embeddings').length === 0) {
  errors.push('validator self-test failed to detect mixed Chinese prose')
}
if (containsMixedProse('es', 'Consulta el `workflowId` en TradingGoose').length > 0) {
  errors.push('validator self-test rejected valid protected terminology')
}

for (const locale of ['es', 'zh']) {
  for (const path of inventories[locale].filter((path) => path.endsWith('.mdx'))) {
    const translated = await readFile(new URL(`${locale}/${path}`, root), 'utf8')
    const prose = translated
      .replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```/gm, '')
      .replace(/^import\s.+$/gm, '')
      .replace(/`[^`\n]+`/g, '')
      .replace(/"(?:id|name|label|placeholder)"\s*:\s*"(?:\\.|[^"])*"/g, '')
      .replace(/https?:\/\/[^\s"')\\]+/g, '')
    const residualLines = containsMixedProse(locale, prose).filter(
      (line) => !isAllowedResidual(locale, path, line)
    )
    if (residualLines.length > 0) {
      errors.push(`${locale}/${path} contains mixed-language prose`)
    }
  }
}

if (errors.length > 0) throw new Error(`Translation validation failed:\n- ${errors.join('\n- ')}`)

console.log(`Validated exact locale parity: en=${inventories.en.length}, es=${inventories.es.length}, zh=${inventories.zh.length}`)
