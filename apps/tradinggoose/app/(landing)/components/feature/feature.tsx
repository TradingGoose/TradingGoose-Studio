'use client'

import React from 'react'
import { type Edge, type Node, Position } from 'reactflow'

import { BinaryIcon, BookIcon, CalendarIcon, CodeIcon, Globe2Icon, MessageSquareIcon, VariableIcon } from 'lucide-react'
import { AgentIcon, OpenAIIcon, PackageSearchIcon, ScheduleIcon } from '@/components/icons'
import { soehne } from '@/app/fonts/soehne/soehne'
import {
  CARD_WIDTH,
  LandingCanvas,
  type LandingGroupData,
  type LandingManualBlock,
  type LandingViewportApi,
} from '@/app/(landing)/components/feature/components'

const LANDING_BLOCKS: LandingManualBlock[] = [
  {
    id: 'schedule',
    name: 'Schedule',
    color: '#7B68EE',
    icon: <ScheduleIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 8, y: 60 },
      tablet: { x: 40, y: 120 },
      desktop: { x: 60, y: 180 },
    },
    tags: [
      { icon: <CalendarIcon className='h-3 w-3' />, label: '09:00AM Daily' },
      { icon: <Globe2Icon className='h-3 w-3' />, label: 'PST' },
    ],
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    color: '#00B0B0',
    icon: <PackageSearchIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 120, y: 140 },
      tablet: { x: 220, y: 200 },
      desktop: { x: 420, y: 241 },
    },
    tags: [
      { icon: <BookIcon className='h-3 w-3' />, label: 'Product Vector DB' },
      { icon: <BinaryIcon className='h-3 w-3' />, label: 'Limit: 10' },
    ],
  },
  {
    id: 'agent',
    name: 'Agent',
    color: '#802FFF',
    icon: <AgentIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 340, y: 60 },
      tablet: { x: 540, y: 120 },
      desktop: { x: 880, y: 142 },
    },
    tags: [
      { icon: <OpenAIIcon className='h-3 w-3' />, label: 'gpt-5' },
      { icon: <MessageSquareIcon className='h-3 w-3' />, label: 'You are a support ag...' },
    ],
  },
  {
    id: 'function',
    name: 'Function',
    color: '#FF402F',
    icon: <CodeIcon className='h-4 w-4' />,
    positions: {
      mobile: { x: 480, y: 220 },
      tablet: { x: 740, y: 280 },
      desktop: { x: 880, y: 340 },
    },
    tags: [
      { icon: <CodeIcon className='h-3 w-3' />, label: 'Python' },
      { icon: <VariableIcon className='h-3 w-3' />, label: 'time = "2025-09-01...' },
    ],
  },
]

const SAMPLE_WORKFLOW_EDGES = [
  { id: 'e1', from: 'schedule', to: 'knowledge' },
  { id: 'e2', from: 'knowledge', to: 'agent' },
  { id: 'e3', from: 'knowledge', to: 'function' },
]

export default function Feature() {
  const [isMobile, setIsMobile] = React.useState(false)
  const [rfNodes, setRfNodes] = React.useState<Node[]>([])
  const [rfEdges, setRfEdges] = React.useState<Edge[]>([])
  const [groupBox] = React.useState<LandingGroupData | null>(null)
  const [worldWidth, setWorldWidth] = React.useState<number>(1000)
  const viewportApiRef = React.useRef<LandingViewportApi | null>(null)

  React.useEffect(() => {
    const updateMatch = () => {
      if (typeof window !== 'undefined') {
        setIsMobile(window.innerWidth < 640)
      }
    }

    updateMatch()
    window.addEventListener('resize', updateMatch)

    return () => window.removeEventListener('resize', updateMatch)
  }, [])

  React.useEffect(() => {
    const breakpoint =
      typeof window !== 'undefined' && window.innerWidth < 640
        ? 'mobile'
        : typeof window !== 'undefined' && window.innerWidth < 1024
          ? 'tablet'
          : 'desktop'

    const nodes: Node[] = [
      {
        id: 'loop',
        type: 'group',
        position: { x: 720, y: 20 },
        data: { label: 'Loop' },
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
        style: {
          width: 1198,
          height: 528,
          backgroundColor: 'transparent',
          border: 'none',
          padding: 0,
        },
      },
      ...LANDING_BLOCKS.map((block, index) => {
        const isLoopChild = block.id === 'agent' || block.id === 'function'
        const baseNode = {
          id: block.id,
          type: 'landing',
          position: isLoopChild
            ? {
                x: block.id === 'agent' ? 160 : 160,
                y: block.id === 'agent' ? 122 : 320,
              }
            : block.positions[breakpoint],
          data: {
            icon: block.icon,
            color: block.color,
            name: block.name,
            tags: block.tags,
            delay: index * 0.18,
            hideTargetHandle: block.id === 'schedule',
            hideSourceHandle: block.id === 'agent' || block.id === 'function',
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        }

        if (isLoopChild) {
          return {
            ...baseNode,
            parentId: 'loop',
            extent: 'parent',
          }
        }

        return baseNode
      }),
    ]

    const edges: Edge[] = SAMPLE_WORKFLOW_EDGES.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'landingEdge',
      animated: false,
      data: { delay: 0.6 },
    }))

    setRfNodes(nodes)
    setRfEdges(edges)

    const maxX = Math.max(...nodes.map((node) => node.position.x))
    setWorldWidth(maxX + CARD_WIDTH + 32)
  }, [])

  if (isMobile) {
    return null
  }

  return (
    <section
      id='feature'
      className={`${soehne.className} flex w-full flex-col items-center justify-center`}
      aria-label='Feature'
    >
      <div className='mt-[60px] w-full max-w-[1308px] sm:mt-[127.5px]'>
        <LandingCanvas
          nodes={rfNodes}
          edges={rfEdges}
          groupBox={groupBox}
          worldWidth={worldWidth}
          viewportApiRef={viewportApiRef}
        />
      </div>
    </section>
  )
}
