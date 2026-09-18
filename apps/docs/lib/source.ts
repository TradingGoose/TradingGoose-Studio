import { loader } from 'fumadocs-core/source'
import { docs } from '@/.source'
import { i18n } from './i18n'

const docsSource = docs.toFumadocsSource()

export const source = loader({
  baseUrl: '/',
  source: {
    ...docsSource,
    files() {
      const files = typeof docsSource.files === 'function' ? docsSource.files() : docsSource.files
      const sourcePrefix = `${i18n.defaultLanguage}/`
      // Share navigation structure, not page content. Localized metadata below takes precedence.
      const sharedMetadata = files
        .filter((file) => file.type === 'meta' && file.path.startsWith(sourcePrefix))
        .flatMap((file) =>
          i18n.languages
            .filter((locale) => locale !== i18n.defaultLanguage)
            .map((locale) => ({
              ...file,
              path: `${locale}/${file.path.slice(sourcePrefix.length)}`,
            }))
        )
      return [...sharedMetadata, ...files]
    },
  },
  i18n,
})
