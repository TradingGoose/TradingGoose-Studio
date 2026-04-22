import { type Cheerio, type CheerioAPI, load } from 'cheerio'

interface ConvertHtmlToMarkdownOptions {
  sourceUrl: string
}

type HtmlNode = {
  type: string
  data?: string
  tagName?: string
}

interface RenderContext {
  $: CheerioAPI
  sourceUrl: string
  listDepth: number
}

const BLOCK_TAGS = new Set([
  'article',
  'blockquote',
  'div',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'thead',
  'tr',
  'ul',
])

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function collapseMarkdownWhitespace(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`')
}

function resolveUrl(href: string | undefined, sourceUrl: string): string {
  if (!href) {
    return ''
  }

  try {
    return new URL(href, sourceUrl).toString()
  } catch {
    return href
  }
}

function renderInlineNodes(nodes: HtmlNode[], context: RenderContext): string {
  const rendered = nodes.map((node) => renderInlineNode(node, context)).join('')
  return normalizeInlineWhitespace(rendered)
}

function renderInlineNode(node: HtmlNode, context: RenderContext): string {
  if (node.type === 'text') {
    return node.data || ''
  }

  if (node.type !== 'tag') {
    return ''
  }

  const { $, sourceUrl } = context
  const element = $(node as never)
  const tag = (node.tagName || '').toLowerCase()

  if (BLOCK_TAGS.has(tag)) {
    return ''
  }

  switch (tag) {
    case 'a': {
      const href = resolveUrl(element.attr('href'), sourceUrl)
      const text = renderInlineNodes(element.contents().toArray(), context) || href
      return href ? `[${text}](${href})` : text
    }
    case 'code': {
      const text = normalizeInlineWhitespace(element.text())
      return text ? `\`${escapeInlineCode(text)}\`` : ''
    }
    case 'img': {
      const alt = normalizeInlineWhitespace(element.attr('alt') || '')
      const src = resolveUrl(element.attr('src'), sourceUrl)
      return src ? `![${alt}](${src})` : alt
    }
    case 'strong':
    case 'b': {
      const text = renderInlineNodes(element.contents().toArray(), context)
      return text ? `**${text}**` : ''
    }
    case 'em':
    case 'i': {
      const text = renderInlineNodes(element.contents().toArray(), context)
      return text ? `*${text}*` : ''
    }
    case 'br':
      return '\n'
    default:
      return renderInlineNodes(element.contents().toArray(), context)
  }
}

function renderList(element: Cheerio<any>, tag: 'ul' | 'ol', context: RenderContext): string {
  const childItems = element.children('li').toArray()

  if (childItems.length === 0) {
    return ''
  }

  const nextContext: RenderContext = {
    ...context,
    listDepth: context.listDepth + 1,
  }

  const lines = childItems
    .map((item, index) => {
      const marker = tag === 'ol' ? `${index + 1}.` : '-'
      return renderListItem(context.$(item), marker, nextContext)
    })
    .filter(Boolean)

  return lines.join('\n')
}

function renderListItem(element: Cheerio<any>, marker: string, context: RenderContext): string {
  const indent = '  '.repeat(Math.max(0, context.listDepth - 1))
  const childNodes = element.contents().toArray()
  const inlineNodes = childNodes.filter(
    (node) =>
      node.type === 'text' ||
      (node.type === 'tag' && !BLOCK_TAGS.has((node.tagName || '').toLowerCase()))
  )
  const blockNodes = childNodes.filter(
    (node) =>
      !(
        node.type === 'text' ||
        (node.type === 'tag' && !BLOCK_TAGS.has((node.tagName || '').toLowerCase()))
      )
  )

  const inlineText = renderInlineNodes(inlineNodes, context)
  const renderedBlocks = blockNodes
    .map((node) => renderBlockNode(node, context))
    .join('\n')
    .trim()

  const head = inlineText ? `${indent}${marker} ${inlineText}` : `${indent}${marker}`

  if (!renderedBlocks) {
    return head
  }

  const nested = renderedBlocks
    .split('\n')
    .map((line) => (line ? `${indent}  ${line}` : ''))
    .join('\n')

  return `${head}\n${nested}`
}

function renderTable(element: Cheerio<any>, context: RenderContext): string {
  const rows = element.find('tr').toArray()

  if (rows.length === 0) {
    return ''
  }

  const renderedRows = rows
    .map((row) =>
      context
        .$(row)
        .children('th,td')
        .toArray()
        .map((cell) => renderInlineNodes(context.$(cell).contents().toArray(), context))
    )
    .filter((row) => row.length > 0)

  if (renderedRows.length === 0) {
    return ''
  }

  const header = renderedRows[0]
  const separator = header.map(() => '---')
  const body = renderedRows.slice(1)

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function renderBlockNode(node: HtmlNode, context: RenderContext): string {
  if (node.type === 'text') {
    return normalizeInlineWhitespace(node.data || '')
  }

  if (node.type !== 'tag') {
    return ''
  }

  const { $, sourceUrl } = context
  const element = $(node as never)
  const tag = (node.tagName || '').toLowerCase()

  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const depth = Number(tag.slice(1))
      const text = renderInlineNodes(element.contents().toArray(), context)
      return text ? `${'#'.repeat(depth)} ${text}` : ''
    }
    case 'p': {
      return renderInlineNodes(element.contents().toArray(), context)
    }
    case 'blockquote': {
      const content = renderChildBlocks(element.contents().toArray(), context)
      return content
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    }
    case 'pre': {
      const codeChild = element.children('code').first()
      const raw = codeChild.length > 0 ? codeChild.text() : element.text()
      const languageClass = codeChild.attr('class') || ''
      const languageMatch = languageClass.match(/language-([A-Za-z0-9_-]+)/)
      const language = languageMatch?.[1] || ''
      return `\`\`\`${language}\n${raw.trimEnd()}\n\`\`\``
    }
    case 'ul':
    case 'ol': {
      return renderList(element, tag, context)
    }
    case 'table': {
      return renderTable(element, context)
    }
    case 'img': {
      const alt = normalizeInlineWhitespace(element.attr('alt') || '')
      const src = resolveUrl(element.attr('src'), sourceUrl)
      return src ? `![${alt}](${src})` : ''
    }
    case 'hr':
      return '---'
    case 'article':
    case 'div':
    case 'header':
    case 'main':
    case 'section':
    case 'span':
    case 'tbody':
    case 'thead':
    case 'tr':
      return renderChildBlocks(element.contents().toArray(), context)
    default: {
      const inline = renderInlineNodes(element.contents().toArray(), context)
      if (inline) {
        return inline
      }

      return renderChildBlocks(element.contents().toArray(), context)
    }
  }
}

function renderChildBlocks(nodes: HtmlNode[], context: RenderContext): string {
  return nodes
    .map((node) => renderBlockNode(node, context))
    .filter(Boolean)
    .join('\n\n')
}

export function convertHtmlToMarkdown(
  html: string,
  options: ConvertHtmlToMarkdownOptions
): { title: string; description: string; body: string } {
  const $ = load(html)
  $('script, style, noscript, iframe, svg, nav, footer, form, button').remove()
  $('[aria-hidden="true"]').remove()

  const title = normalizeInlineWhitespace($('head title').first().text())
  const description = normalizeInlineWhitespace(
    $('head meta[name="description"]').attr('content') || ''
  )

  const root =
    $('main').first().length > 0
      ? $('main').first()
      : $('article').first().length > 0
        ? $('article').first()
        : $('body').first()

  const body = collapseMarkdownWhitespace(
    renderChildBlocks(root.contents().toArray(), {
      $,
      sourceUrl: options.sourceUrl,
      listDepth: 0,
    })
  )

  return {
    title,
    description,
    body,
  }
}
