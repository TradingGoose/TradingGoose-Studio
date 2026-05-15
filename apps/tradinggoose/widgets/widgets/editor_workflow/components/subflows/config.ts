import { RepeatIcon, SplitIcon } from 'lucide-react'

export const SubflowBlockConfigs = {
  loop: {
    id: 'loop',
    type: 'loop',
    name: 'Loop',
    icon: RepeatIcon,
    bgColor: '#00ccff',
  },
  parallel: {
    id: 'parallel',
    type: 'parallel',
    name: 'Parallel',
    icon: SplitIcon,
    bgColor: '#ffdd00',
  },
} as const

export type SubflowKind = keyof typeof SubflowBlockConfigs

export function getSubflowBlockConfig(type: SubflowKind): (typeof SubflowBlockConfigs)[SubflowKind]
export function getSubflowBlockConfig(
  type: string
): (typeof SubflowBlockConfigs)[SubflowKind] | undefined
export function getSubflowBlockConfig(type: string) {
  return type === 'loop' || type === 'parallel' ? SubflowBlockConfigs[type] : undefined
}
