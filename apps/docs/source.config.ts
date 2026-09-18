import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'

const markdown = remark().use(remarkMdx).use(remarkGfm)

export const docs = defineDocs({
  dir: 'content/docs',
})

export default defineConfig({
  mdxOptions: {
    valueToExport: ['llmText'],
    remarkPlugins: (plugins) => [
      () => (tree, file) => {
        file.data.llmText = markdown.stringify(tree)
      },
      ...plugins,
    ],
  },
})
