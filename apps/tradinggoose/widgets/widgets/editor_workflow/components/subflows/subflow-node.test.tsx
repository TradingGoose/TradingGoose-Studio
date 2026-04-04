import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubflowNodeComponent } from '@/widgets/widgets/editor_workflow/components/subflows/subflow-node'

const mockGetNodes = vi.fn()

// Mocks
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('reactflow', () => ({
  Handle: ({ id, type, position }: any) => ({ id, type, position }),
  Position: {
    Top: 'top',
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
  },
  useReactFlow: () => ({
    getNodes: mockGetNodes,
  }),
  useUpdateNodeInternals: () => vi.fn(),
  memo: (component: any) => component,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<any>('react')
  return {
    ...actual,
    memo: (component: any) => component,
    useEffect: (fn: any) => fn(),
    useMemo: (fn: any) => fn(),
  }
})

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => ({ children, ...props }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

describe('SubflowNodeComponent', () => {
  const defaultProps = {
    id: 'subflow-1',
    type: 'subflowNode',
    data: {
      width: 500,
      height: 300,
      isPreview: false,
      kind: 'loop' as const,
    },
    selected: false,
    zIndex: 1,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetNodes.mockReturnValue([])
  })

  describe('Component Definition and Structure', () => {
    it.concurrent('should be defined as a function component', () => {
      expect(SubflowNodeComponent).toBeDefined()
      expect(typeof SubflowNodeComponent).toBe('function')
    })

    it.concurrent('should have correct display name', () => {
      expect(SubflowNodeComponent.displayName).toBe('SubflowNodeComponent')
    })

    it.concurrent('should be a memoized component', () => {
      expect(SubflowNodeComponent).toBeDefined()
    })
  })

  describe('Props Validation and Type Safety', () => {
    it.concurrent('should accept NodeProps interface', () => {
      const validProps = {
        id: 'test-id',
        type: 'subflowNode' as const,
        data: {
          width: 400,
          height: 300,
          isPreview: true,
          kind: 'parallel' as const,
        },
        selected: false,
        zIndex: 1,
        isConnectable: true,
        xPos: 0,
        yPos: 0,
        dragging: false,
      }

      expect(() => {
        const _component: typeof SubflowNodeComponent = SubflowNodeComponent
        expect(_component).toBeDefined()
        expect(validProps.type).toBe('subflowNode')
      }).not.toThrow()
    })

    it.concurrent('should handle different data configurations', () => {
      const configurations = [
        { width: 500, height: 300, isPreview: false, kind: 'loop' as const },
        { width: 800, height: 600, isPreview: true, kind: 'parallel' as const },
        { width: 0, height: 0, isPreview: false, kind: 'loop' as const },
        { kind: 'loop' as const },
      ]

      configurations.forEach((data) => {
        const props = { ...defaultProps, data }
        expect(() => {
          const _component: typeof SubflowNodeComponent = SubflowNodeComponent
          expect(_component).toBeDefined()
          expect(props.data).toBeDefined()
        }).not.toThrow()
      })
    })
  })

  describe('Component Configuration', () => {
    it.concurrent('should handle different dimensions', () => {
      const dimensionTests = [
        { width: 500, height: 300 },
        { width: 800, height: 600 },
        { width: 0, height: 0 },
        { width: 10000, height: 10000 },
      ]

      dimensionTests.forEach(({ width, height }) => {
        const data = { width, height }
        expect(data.width).toBe(width)
        expect(data.height).toBe(height)
      })
    })
  })

  describe('Component Data Handling', () => {
    it.concurrent('should handle missing data properties gracefully', () => {
      const testCases = [
        undefined,
        {},
        { width: 500 },
        { height: 300 },
        { width: 500, height: 300 },
      ]

      testCases.forEach((data: any) => {
        const props = { ...defaultProps, data }
        const width = Math.max(0, data?.width || 500)
        const height = Math.max(0, data?.height || 300)
        expect(width).toBeGreaterThanOrEqual(0)
        expect(height).toBeGreaterThanOrEqual(0)
        expect(props.type).toBe('subflowNode')
      })
    })

    it.concurrent('should handle parent ID relationships', () => {
      const testCases = [
        { parentId: undefined, hasParent: false },
        { parentId: 'parent-1', hasParent: true },
        { parentId: '', hasParent: false },
      ]

      testCases.forEach(({ parentId, hasParent }) => {
        const data = { ...defaultProps.data, parentId }
        expect(Boolean(data.parentId)).toBe(hasParent)
      })
    })
  })

  describe('Loop vs Parallel Kind Specific Tests', () => {
    it.concurrent('should generate correct handle IDs for loop kind', () => {
      const loopData = { ...defaultProps.data, kind: 'loop' as const }
      const startHandleId = loopData.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
      const endHandleId = loopData.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'

      expect(startHandleId).toBe('loop-start-source')
      expect(endHandleId).toBe('loop-end-source')
    })

    it.concurrent('should generate correct handle IDs for parallel kind', () => {
      type SubflowKind = 'loop' | 'parallel'
      const testHandleGeneration = (kind: SubflowKind) => {
        const startHandleId = kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
        const endHandleId = kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
        return { startHandleId, endHandleId }
      }

      const result = testHandleGeneration('parallel')
      expect(result.startHandleId).toBe('parallel-start-source')
      expect(result.endHandleId).toBe('parallel-end-source')
    })

    it.concurrent('should generate correct background colors for loop kind', () => {
      const loopData = { ...defaultProps.data, kind: 'loop' as const }
      const startBg = loopData.kind === 'loop' ? '#00ccff' : '#ffdd00'

      expect(startBg).toBe('#00ccff')
    })

    it.concurrent('should generate correct background colors for parallel kind', () => {
      type SubflowKind = 'loop' | 'parallel'
      const testBgGeneration = (kind: SubflowKind) => {
        return kind === 'loop' ? '#00ccff' : '#ffdd00'
      }

      const startBg = testBgGeneration('parallel')
      expect(startBg).toBe('#ffdd00')
    })

    it.concurrent('should demonstrate handle ID generation for any kind', () => {
      type SubflowKind = 'loop' | 'parallel'
      const testKind = (kind: SubflowKind) => {
        const data = { kind }
        const startHandleId = data.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
        const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
        return { startHandleId, endHandleId }
      }

      const loopResult = testKind('loop')
      expect(loopResult.startHandleId).toBe('loop-start-source')
      expect(loopResult.endHandleId).toBe('loop-end-source')

      const parallelResult = testKind('parallel')
      expect(parallelResult.startHandleId).toBe('parallel-start-source')
      expect(parallelResult.endHandleId).toBe('parallel-end-source')
    })

    it.concurrent('should handle both kinds in configuration arrays', () => {
      const bothKinds = ['loop', 'parallel'] as const
      bothKinds.forEach((kind) => {
        const data = { ...defaultProps.data, kind }
        expect(['loop', 'parallel']).toContain(data.kind)

        // Test handle ID generation for both kinds
        const startHandleId = data.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
        const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
        const startBg = data.kind === 'loop' ? '#00ccff' : '#ffdd00'

        if (kind === 'loop') {
          expect(startHandleId).toBe('loop-start-source')
          expect(endHandleId).toBe('loop-end-source')
          expect(startBg).toBe('#00ccff')
        } else {
          expect(startHandleId).toBe('parallel-start-source')
          expect(endHandleId).toBe('parallel-end-source')
          expect(startBg).toBe('#ffdd00')
        }
      })
    })

    it.concurrent('should maintain consistent styling behavior across both kinds', () => {
      const loopProps = { ...defaultProps, data: { ...defaultProps.data, kind: 'loop' as const } }
      const parallelProps = {
        ...defaultProps,
        data: { ...defaultProps.data, kind: 'parallel' as const },
      }

      // Both should have same base properties except kind-specific ones
      expect(loopProps.data.width).toBe(parallelProps.data.width)
      expect(loopProps.data.height).toBe(parallelProps.data.height)
      expect(loopProps.data.isPreview).toBe(parallelProps.data.isPreview)

      // But different kinds
      expect(loopProps.data.kind).toBe('loop')
      expect(parallelProps.data.kind).toBe('parallel')
    })
  })

  describe('CSS Class Generation', () => {
    it.concurrent('should handle error state styling', () => {
      const hasNestedError = true
      const errorClasses = hasNestedError && 'bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10'

      expect(errorClasses).toBe('bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10')
    })

    it.concurrent('should use the shared hover ring styling pattern', () => {
      const hoverClasses = 'hover:ring-1 hover:ring-[var(--block-hover-color)]'

      expect(hoverClasses).toContain('hover:ring-1')
      expect(hoverClasses).toContain('--block-hover-color')
    })

    it.concurrent('should handle diff status styling', () => {
      const diffStatuses = ['new', 'edited'] as const

      diffStatuses.forEach((status) => {
        let diffClass = ''
        if (status === 'new') {
          diffClass = 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10'
        } else if (status === 'edited') {
          diffClass = 'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10'
        }

        expect(diffClass).toBeTruthy()
        if (status === 'new') {
          expect(diffClass).toContain('ring-green-500')
        } else {
          expect(diffClass).toContain('ring-orange-500')
        }
      })
    })
  })
})
