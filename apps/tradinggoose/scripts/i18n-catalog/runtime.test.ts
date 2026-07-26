import { afterEach, describe, expect, it } from 'vitest'
import {
  ARRAY_RUNTIME_CALLBACK_METHOD_NAMES,
  RUNTIME_CALLBACK_FUNCTION_NAMES,
  RUNTIME_CALLBACK_HOOK_NAMES,
} from './scan/core/rules'
import { scanCatalogProject } from './scan'
import {
  cleanupTempProjects,
  createLocaleMessages,
  createOptionalChainMonitorProject,
  createRenderPropMonitorProject,
  createRuntimeMatrixProject,
  createStartTransitionMonitorProject,
  createTempProject,
  createTimerCallbackMonitorProject,
  createVerifyPromiseProject,
  createWrappedExportMonitorProject,
  getCoveragePathKeys,
} from './test-utils'

const MONITOR_ROUTE_PATH = '/workspace/[workspaceId]/monitor'
const MONITOR_USED_PATH_KEY = 'workspace.monitor.used'

type RuntimeMatrixDefinition = {
  body: string
  importLines?: string[]
  name: string
  returnExpression?: string
}

const runtimeHookMatrix: RuntimeMatrixDefinition[] = [
  {
    body: `
useEffect(() => {
  void copy.used
}, [])
`,
    importLines: ["import { useEffect } from 'react'"],
    name: 'useEffect',
  },
  {
    body: `
useInsertionEffect(() => {
  void copy.used
}, [])
`,
    importLines: ["import { useInsertionEffect } from 'react'"],
    name: 'useInsertionEffect',
  },
  {
    body: `
useLayoutEffect(() => {
  void copy.used
}, [])
`,
    importLines: ["import { useLayoutEffect } from 'react'"],
    name: 'useLayoutEffect',
  },
  {
    body: "const memoizedLabel = useMemo(() => copy.used, [copy])",
    importLines: ["import { useMemo } from 'react'"],
    name: 'useMemo',
    returnExpression: '<div>{memoizedLabel}</div>',
  },
]

const runtimeFunctionMatrix: RuntimeMatrixDefinition[] = [
  {
    body: `
queueMicrotask(() => {
  void copy.used
})
`,
    name: 'queueMicrotask',
  },
  {
    body: `
requestAnimationFrame(() => {
  void copy.used
})
`,
    name: 'requestAnimationFrame',
  },
  {
    body: `
startTransition(() => {
  void copy.used
})
`,
    importLines: ["import { startTransition } from 'react'"],
    name: 'startTransition',
  },
  {
    body: `
setInterval(() => {
  void copy.used
}, 0)
`,
    name: 'setInterval',
  },
  {
    body: `
setTimeout(() => {
  void copy.used
}, 0)
`,
    name: 'setTimeout',
  },
]

const arrayRuntimeCallbackMatrix: RuntimeMatrixDefinition[] = [
  {
    body: 'const everyResult = [1].every(() => Boolean(copy.used))',
    name: 'every',
    returnExpression: '<div>{String(everyResult)}</div>',
  },
  {
    body: 'const filteredValues = [1].filter(() => Boolean(copy.used))',
    name: 'filter',
    returnExpression: '<div>{filteredValues.length}</div>',
  },
  {
    body: 'const foundValue = [1].find(() => Boolean(copy.used))',
    name: 'find',
    returnExpression: '<div>{foundValue}</div>',
  },
  {
    body: 'const foundIndex = [1].findIndex(() => Boolean(copy.used))',
    name: 'findIndex',
    returnExpression: '<div>{foundIndex}</div>',
  },
  {
    body: 'const foundLastValue = [1].findLast(() => Boolean(copy.used))',
    name: 'findLast',
    returnExpression: '<div>{foundLastValue}</div>',
  },
  {
    body: 'const foundLastIndex = [1].findLastIndex(() => Boolean(copy.used))',
    name: 'findLastIndex',
    returnExpression: '<div>{foundLastIndex}</div>',
  },
  {
    body: 'const flattenedValues = [1].flatMap(() => [copy.used])',
    name: 'flatMap',
    returnExpression: '<div>{flattenedValues.length}</div>',
  },
  {
    body: `
[1].forEach(() => {
  void copy.used
})
`,
    name: 'forEach',
  },
  {
    body: 'const mappedValues = [1].map(() => copy.used)',
    name: 'map',
    returnExpression: '<div>{mappedValues[0]}</div>',
  },
  {
    body: 'const reducedValue = [1].reduce((sum) => sum + copy.used.length, 0)',
    name: 'reduce',
    returnExpression: '<div>{reducedValue}</div>',
  },
  {
    body: 'const reducedRightValue = [1].reduceRight((sum) => sum + copy.used.length, 0)',
    name: 'reduceRight',
    returnExpression: '<div>{reducedRightValue}</div>',
  },
  {
    body: 'const someResult = [1].some(() => Boolean(copy.used))',
    name: 'some',
    returnExpression: '<div>{String(someResult)}</div>',
  },
  {
    body: 'const sortedValues = [1].toSorted(() => copy.used.length)',
    name: 'toSorted',
    returnExpression: '<div>{sortedValues[0]}</div>',
  },
]

function indentBlock(value: string, prefix = '  ') {
  return value
    .trim()
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function createMonitorComponentSource(
  definition: RuntimeMatrixDefinition,
  options?: { wrapInUnusedHelper?: boolean }
) {
  const body = options?.wrapInUnusedHelper
    ? `
function neverInvoked() {
${indentBlock(definition.body, '  ')}
}

void neverInvoked
`
    : definition.body

  return `
'use client'

${definition.importLines?.join('\n') ?? ''}
import { useMessages } from 'next-intl'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor;
  ${body.trim()}

  return ${definition.returnExpression ?? '<div />'}
}
`
}

function scanMonitorProject(projectRoot: string) {
  return scanCatalogProject({
    mode: 'route',
    projectRoot,
    routePath: MONITOR_ROUTE_PATH,
  })
}

function createIntrinsicCallbackForwardingProject(elementTag: 'button' | 'input') {
  const messages = createLocaleMessages()
  const eventProp = elementTag === 'button' ? 'onClick' : 'onChange'

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/control.tsx': `
export function Control(props: any) {
  return <${elementTag} {...props} />
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMessages } from 'next-intl'
import { Control } from '@/app/workspace/[workspaceId]/monitor/control'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor
  const handleEvent = () => copy.used

  return <Control ${eventProp}={handleEvent}>{copy.title}</Control>
}
`,
  })
}

function createCustomComponentCallbackPassThroughProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/dropdown.tsx': `
export function Dropdown(_props: any) {
  return <div />
}
`,
    'app/workspace/[workspaceId]/monitor/control.tsx': `
import { Dropdown } from '@/app/workspace/[workspaceId]/monitor/dropdown'

export function Control(props: any) {
  return <Dropdown {...props} />
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMessages } from 'next-intl'
import { Control } from '@/app/workspace/[workspaceId]/monitor/control'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor
  const handleClick = () => copy.orphan

  return <Control onClick={handleClick}>{copy.title}</Control>
}
`,
  })
}

function createDynamicTagCallbackForwardingProject() {
  const messages = createLocaleMessages()

  return createTempProject({
    'i18n/messages/en.json': messages,
    'i18n/messages/es.json': messages,
    'i18n/messages/zh.json': messages,
    'app/[locale]/workspace/[workspaceId]/layout.tsx':
      'export default function Layout({ children }: { children: React.ReactNode }) { return children }\n',
    'app/[locale]/workspace/[workspaceId]/monitor/page.tsx':
      "import { MonitorPage } from '@/app/workspace/[workspaceId]/monitor/monitor'\nexport default function Page(){ return <MonitorPage /> }\n",
    'app/workspace/[workspaceId]/monitor/control.tsx': `
export function Control(props: any) {
  const Comp = 'button'

  return <Comp {...props} />
}
`,
    'app/workspace/[workspaceId]/monitor/monitor.tsx': `
'use client'

import { useMessages } from 'next-intl'
import { Control } from '@/app/workspace/[workspaceId]/monitor/control'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor
  const handleClick = () => copy.orphan

  return <Control onClick={handleClick}>{copy.title}</Control>
}
`,
  })
}

afterEach(cleanupTempProjects)

describe('i18n catalog scanner runtime', () => {
  it('captures copy access through optional-chain monitor error copy', () => {
    const projectRoot = createOptionalChainMonitorProject()

    const result = scanMonitorProject(projectRoot)

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
        'workspace.monitor.errors.invalidViewResponse',
      ])
    )
  })

  it('captures copy access through promise callbacks in verify flows', () => {
    const projectRoot = createVerifyPromiseProject()

    const result = scanCatalogProject({
      mode: 'route',
      projectRoot,
      routePath: '/verify',
    })

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'auth.verify.pendingTitle',
        'auth.verify.errors.expired',
        'auth.verify.errors.invalid',
        'auth.verify.errors.attempts',
        'auth.verify.errors.generic',
        'auth.verify.errors.resendFailed',
      ])
    )
  })

  it('does not capture copy access through promise callbacks inside unused helpers', () => {
    const projectRoot = createRuntimeMatrixProject(`
'use client'

import { useMessages } from 'next-intl'

export function MonitorPage() {
  const copy = useMessages().workspace.monitor

  function neverInvoked() {
    Promise.resolve().then(() => {
      void copy.used
    })
  }

  void neverInvoked

  return <div />
}
`)

    const result = scanMonitorProject(projectRoot)

    expect(getCoveragePathKeys(result)).not.toContain(MONITOR_USED_PATH_KEY)
  })

  it('captures copy access through timer and microtask callbacks', () => {
    const projectRoot = createTimerCallbackMonitorProject()

    const result = scanMonitorProject(projectRoot)

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        MONITOR_USED_PATH_KEY,
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
        'workspace.monitor.errors.invalidViewResponse',
      ])
    )
  })

  it('captures copy access through startTransition callbacks', () => {
    const projectRoot = createStartTransitionMonitorProject()

    const result = scanMonitorProject(projectRoot)

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        MONITOR_USED_PATH_KEY,
        'workspace.monitor.errors.loadViews',
        'workspace.monitor.errors.createDefaultView',
      ])
    )
  })

  it('captures copy access through invoked render props and callback props', () => {
    const projectRoot = createRenderPropMonitorProject()

    const result = scanMonitorProject(projectRoot)

    expect(getCoveragePathKeys(result)).toEqual(
      expect.arrayContaining([
        'workspace.monitor.timezone.label',
        'workspace.monitor.timezone.loading',
        'workspace.monitor.timezone.empty',
        'workspace.monitor.timezone.placeholder',
      ])
    )
  })

  ;([
    ['forwardRef', 'forwardRef'],
    ['memo', 'memo'],
    ['memo(forwardRef)', 'memoForwardRef'],
  ] as const).forEach(([label, wrapper]) => {
    it(`captures copy access through ${label}-wrapped exported components`, () => {
      const projectRoot = createWrappedExportMonitorProject(wrapper)

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).toContain(MONITOR_USED_PATH_KEY)
    })
  })

  ;(['button', 'input'] as const).forEach((elementTag) => {
    it(`captures copy access through intrinsic ${elementTag} callback forwarding`, () => {
      const projectRoot = createIntrinsicCallbackForwardingProject(elementTag)

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).toContain(MONITOR_USED_PATH_KEY)
    })
  })

  it('does not capture copy access through callback props passed through custom components that never invoke them', () => {
    const projectRoot = createCustomComponentCallbackPassThroughProject()

    const result = scanMonitorProject(projectRoot)

    expect(getCoveragePathKeys(result)).not.toContain('workspace.monitor.orphan')
  })

  it('does not capture copy access through dynamic tag callback forwarding', () => {
    const projectRoot = createDynamicTagCallbackForwardingProject()

    const result = scanMonitorProject(projectRoot)

    expect(getCoveragePathKeys(result)).not.toContain('workspace.monitor.orphan')
  })

  it('keeps hook callback coverage aligned with supported runtime hook names', () => {
    expect(runtimeHookMatrix.map((definition) => definition.name).sort()).toEqual(
      [...RUNTIME_CALLBACK_HOOK_NAMES].sort()
    )
  })

  runtimeHookMatrix.forEach((definition) => {
    it(`captures copy access through ${definition.name} callbacks`, () => {
      const projectRoot = createRuntimeMatrixProject(createMonitorComponentSource(definition))

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).toContain(MONITOR_USED_PATH_KEY)
    })

    it(`does not capture copy access through ${definition.name} callbacks inside unused helpers`, () => {
      const projectRoot = createRuntimeMatrixProject(
        createMonitorComponentSource(definition, {
          wrapInUnusedHelper: true,
        })
      )

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).not.toContain(MONITOR_USED_PATH_KEY)
    })
  })

  it('keeps runtime function callback coverage aligned with supported function names', () => {
    expect(runtimeFunctionMatrix.map((definition) => definition.name).sort()).toEqual(
      [...RUNTIME_CALLBACK_FUNCTION_NAMES].sort()
    )
  })

  runtimeFunctionMatrix.forEach((definition) => {
    it(`captures copy access through ${definition.name} callbacks`, () => {
      const projectRoot = createRuntimeMatrixProject(createMonitorComponentSource(definition))

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).toContain(MONITOR_USED_PATH_KEY)
    })

    it(`does not capture copy access through ${definition.name} callbacks inside unused helpers`, () => {
      const projectRoot = createRuntimeMatrixProject(
        createMonitorComponentSource(definition, {
          wrapInUnusedHelper: true,
        })
      )

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).not.toContain(MONITOR_USED_PATH_KEY)
    })
  })

  it('keeps array callback coverage aligned with supported array runtime methods', () => {
    expect(arrayRuntimeCallbackMatrix.map((definition) => definition.name).sort()).toEqual(
      [...ARRAY_RUNTIME_CALLBACK_METHOD_NAMES].sort()
    )
  })

  arrayRuntimeCallbackMatrix.forEach((definition) => {
    it(`captures copy access through array.${definition.name} callbacks`, () => {
      const projectRoot = createRuntimeMatrixProject(createMonitorComponentSource(definition))

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).toContain(MONITOR_USED_PATH_KEY)
    })

    it(`does not capture copy access through array.${definition.name} callbacks inside unused helpers`, () => {
      const projectRoot = createRuntimeMatrixProject(
        createMonitorComponentSource(definition, {
          wrapInUnusedHelper: true,
        })
      )

      const result = scanMonitorProject(projectRoot)

      expect(getCoveragePathKeys(result)).not.toContain(MONITOR_USED_PATH_KEY)
    })
  })

  it('ignores punctuation-only hardcoded candidates', () => {
    const messages = createLocaleMessages()
    const projectRoot = createTempProject({
      'i18n/messages/en.json': messages,
      'i18n/messages/es.json': messages,
      'i18n/messages/zh.json': messages,
      'app/[locale]/workspace/[workspaceId]/monitor/page.tsx': `
export default function Page() {
  return (
    <div>
      :
      %
      |
    </div>
  )
}
`,
    })

    const result = scanMonitorProject(projectRoot)

    expect(result.hardcodedCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: ':' }),
        expect.objectContaining({ text: '%' }),
        expect.objectContaining({ text: '|' }),
      ])
    )
  })
})
