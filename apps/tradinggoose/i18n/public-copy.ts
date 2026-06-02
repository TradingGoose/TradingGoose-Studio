import enCopy from './messages/en.json'
import esCopy from './messages/es.json'
import zhCopy from './messages/zh.json'
import { formatTemplate } from './template'
import { defaultLocale, type LocaleCode } from './utils'

type WidenLiteralValues<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? WidenLiteralValues<U>[]
        : T extends object
          ? { [K in keyof T]: WidenLiteralValues<T[K]> }
          : T

type CoreCopy = WidenLiteralValues<typeof enCopy>
export type PublicCopy = CoreCopy
export type PublicMessageNamespace = keyof PublicCopy

const PUBLIC_COPY = {
  en: enCopy,
  es: esCopy,
  zh: zhCopy,
} satisfies Record<LocaleCode, CoreCopy>

export function getPublicCopy(locale: LocaleCode | string | undefined): PublicCopy {
  const resolvedLocale = (locale && locale in PUBLIC_COPY ? locale : defaultLocale) as LocaleCode
  return PUBLIC_COPY[resolvedLocale]
}

export function getScopedPublicMessages<const TNamespace extends PublicMessageNamespace>(
  locale: LocaleCode | string | undefined,
  namespaces: readonly TNamespace[]
): Pick<PublicCopy, TNamespace> {
  const publicCopy = getPublicCopy(locale)

  return Object.fromEntries(
    namespaces.map((namespace) => [namespace, publicCopy[namespace]])
  ) as Pick<PublicCopy, TNamespace>
}

export { formatTemplate }
