import { execFileSync } from 'child_process'
import path from 'path'
import { describe, it } from 'bun:test'

const docsDir = path.resolve(import.meta.dir, '../../apps/docs')

function checkSource(assertions: string, setup = '') {
  // Isolate the real loader from the source mock used by locale-output.test.ts.
  const script = `
    import assert from 'node:assert/strict'
    import { readdirSync, readFileSync } from 'node:fs'
    import { mock } from 'bun:test'

    const files = readdirSync('content/docs', { recursive: true })
      .filter((path) => path.endsWith('.mdx') || path.endsWith('/meta.json'))
      .map((path) => {
        const content = readFileSync('content/docs/' + path, 'utf8')
        const type = path.endsWith('.json') ? 'meta' : 'page'
        const data = type === 'meta'
          ? JSON.parse(content)
          : Bun.YAML.parse(content.split('---')[1])
        return { path, type, data }
      })

    ${setup}
    mock.module('@/.source', () => ({
      docs: { toFumadocsSource: () => ({ files: () => files }) },
    }))
    const { source } = await import('./lib/source')
    const { getDocsPathname, i18n } = await import('./lib/i18n')
    ${assertions}
  `
  execFileSync(process.execPath, ['-e', script], { cwd: docsDir, stdio: 'pipe' })
}

describe('localized documentation sidebar', () => {
  it('preserves real navigation metadata and translated pages with locale-prefixed URLs', () => {
    checkSource(`
      const expectedItems = [
        ['page', 'introduction/index.mdx'],
        ['folder', 'copilot'],
        ['folder', 'utilities'],
        ['page', 'permissions/index.mdx'],
        ['folder', 'indicators'],
        ['folder', 'triggers'],
        ['folder', 'blocks'],
        ['folder', 'widgets'],
        ['folder', 'tools'],
        ['folder', 'connections'],
        ['folder', 'knowledgebase'],
        ['folder', 'variables'],
        ['folder', 'execution'],
        ['folder', 'sdks'],
      ]
      const shape = (nodes) => nodes.map((node) => ({
        type: node.type,
        id: node.$id,
        url: node.url && getDocsPathname(node.url),
        index: node.index && getDocsPathname(node.index.url),
        children: node.children && shape(node.children),
      }))

      for (const locale of i18n.languages) {
        const tree = source.pageTree[locale]
        assert.deepEqual(tree.children.map((node) => [node.type, node.$id]), expectedItems)
        assert.deepEqual(shape(tree.children), shape(source.pageTree.en.children))
        for (const [id, title] of Object.entries({
          blocks: 'Blocks', connections: 'Connections', execution: 'Execution',
          tools: 'Tools', triggers: 'Triggers',
        })) {
          assert.equal(tree.children.find((node) => node.$id === id)?.name, title)
        }
        assert.deepEqual(
          tree.children.find((node) => node.$id === 'copilot').children.map((node) => node.$id),
          ['copilot/index.mdx', 'copilot/copilot-mcp.mdx'],
        )

        const translatedFiles = files.filter((file) =>
          file.type === 'page' && file.path.startsWith(locale + '/'))
        assert.equal(source.getPages(locale).length, translatedFiles.length)
        for (const page of source.getPages(locale)) {
          assert.ok(page.path.startsWith(locale + '/'))
          assert.equal(page.data.title, translatedFiles.find((file) => file.path === page.path).data.title)
          assert.ok(page.url === '/' + locale || page.url.startsWith('/' + locale + '/'))
        }
        for (const slug of ['introduction', 'permissions']) {
          assert.equal(
            tree.children.find((node) => node.$id === slug + '/index.mdx').name,
            source.getPage([slug], locale).data.title,
          )
        }
      }
    `)
  })

  it('lets localized metadata override shared metadata without falling back to English pages', () => {
    checkSource(
      `
        assert.equal(i18n.fallbackLanguage, null)
        assert.equal(source.getPage(['copilot', 'copilot-mcp'], 'es'), undefined)
        assert.ok(source.getPage(['copilot', 'copilot-mcp'], 'en'))
        const utilities = source.pageTree.es.children.find((node) => node.$id === 'utilities')
        assert.equal(utilities.name, 'Utilidades personalizadas')
        assert.deepEqual(utilities.children.map((node) => node.$id), [
          'utilities/index.mdx', 'utilities/custom-tools.mdx',
          'utilities/skills.mdx', 'utilities/mcp.mdx',
        ])
        assert.equal(source.pageTree.en.children.find((node) => node.$id === 'utilities').name, 'Utilities')
      `,
      `
        files.splice(files.findIndex((file) => file.path === 'es/copilot/copilot-mcp.mdx'), 1)
        files.push({
          type: 'meta', path: 'es/utilities/meta.json',
          data: {
            title: 'Utilidades personalizadas',
            pages: ['index', 'custom-tools', 'skills', 'mcp'],
          },
        })
      `
    )
  })
})
