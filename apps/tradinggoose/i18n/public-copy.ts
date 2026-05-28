import enCopy from './messages/en.json'
import esCopy from './messages/es.json'
import zhCnCopy from './messages/zh-CN.json'
import { formatTemplate } from './template'
import { widgetsExtraCopy } from './widgets-extra-copy'
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
type WidgetsExtraCopy = WidenLiteralValues<(typeof widgetsExtraCopy)['en']>
type BaseCopy = CoreCopy & WidgetsExtraCopy
type BaseWidgetsCopy = BaseCopy['workspace']['widgets']
type WorkflowInspectorCopy = {
  workflowEditor: BaseWidgetsCopy['workflowEditor']
  blockEditor: BaseWidgetsCopy['blockEditor']
  workflowLabels: BaseWidgetsCopy['workflowLabels']
}

export type PublicCopy = BaseCopy & {
  workspace: {
    widgets: BaseWidgetsCopy & {
      workflowInspector: WorkflowInspectorCopy
    }
  }
}
export type PublicMessageNamespace = keyof PublicCopy

const PUBLIC_COPY = {
  en: enCopy,
  es: esCopy,
  'zh-CN': zhCnCopy,
} satisfies Record<LocaleCode, CoreCopy>
const publicCopyCache = new Map<LocaleCode, PublicCopy>()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeCopy<T extends Record<string, unknown>, U extends Record<string, unknown>>(
  base: T,
  extra: U
): T & U {
  const result = { ...base } as T & U

  for (const [key, value] of Object.entries(extra)) {
    const existing = result[key as keyof typeof result]

    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key as keyof typeof result] = mergeCopy(
        existing as Record<string, unknown>,
        value
      ) as (T & U)[keyof (T & U)]
      continue
    }

    result[key as keyof typeof result] = value as (T & U)[keyof (T & U)]
  }

  return result
}

export function getPublicCopy(locale: LocaleCode | string | undefined): PublicCopy {
  const resolvedLocale = (locale && locale in PUBLIC_COPY ? locale : defaultLocale) as LocaleCode
  const cachedCopy = publicCopyCache.get(resolvedLocale)
  if (cachedCopy) {
    return cachedCopy
  }

  const mergedCopy = mergeCopy(
    PUBLIC_COPY[resolvedLocale] as CoreCopy,
    widgetsExtraCopy[resolvedLocale]
  ) as BaseCopy

  const widgets = mergedCopy.workspace.widgets as BaseWidgetsCopy
  const publicCopy: PublicCopy = {
    ...mergedCopy,
    workspace: {
      ...mergedCopy.workspace,
      widgets: {
        ...widgets,
        workflowInspector: {
          workflowEditor: widgets.workflowEditor,
          blockEditor: widgets.blockEditor,
          workflowLabels: widgets.workflowLabels,
        },
      },
    },
  }

  publicCopyCache.set(resolvedLocale, publicCopy)
  return publicCopy
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
