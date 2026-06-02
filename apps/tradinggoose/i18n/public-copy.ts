import enCopy from './messages/en.json'
import esCopy from './messages/es.json'
import zhCopy from './messages/zh.json'
import { defaultLocale, formatTemplate, type LocaleCode } from './utils'

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

const PUBLIC_COPY = {
  en: enCopy,
  es: esCopy,
  zh: zhCopy,
} satisfies Record<LocaleCode, CoreCopy>

export function getPublicCopy(locale: LocaleCode | string | undefined): PublicCopy {
  const resolvedLocale = (locale && locale in PUBLIC_COPY ? locale : defaultLocale) as LocaleCode
  return PUBLIC_COPY[resolvedLocale]
}

export { formatTemplate }
