import type { LucideIcon } from 'lucide-react'
import {
  Building2,
  Clock,
  Code2,
  Database,
  DollarSign,
  HardDrive,
  HeadphonesIcon,
  Infinity as InfinityIcon,
  MessageSquare,
  Server,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react'
import type { PlanFeature } from './components/plan-card'

const FEATURE_ICON_RULES: Array<{ icon: LucideIcon; pattern: RegExp }> = [
  { icon: DollarSign, pattern: /\$|usage|credit|billing|price|cost/i },
  { icon: HardDrive, pattern: /storage|file|gb|tb|disk/i },
  { icon: Users, pattern: /seat|team|member|invite|workspace|organization/i },
  { icon: Building2, pattern: /workspace|organization|company/i },
  { icon: Clock, pattern: /async|queue|minute|latency/i },
  { icon: Zap, pattern: /sync|throughput|rate limit|speed|run/i },
  { icon: Database, pattern: /log|retention|history|database/i },
  { icon: MessageSquare, pattern: /slack|discord|channel|chat|message/i },
  { icon: Server, pattern: /hosting|host|self-host|infra|deployment/i },
  { icon: HeadphonesIcon, pattern: /support|success|sla/i },
  { icon: ShieldCheck, pattern: /security|sso|audit|compliance/i },
  { icon: Code2, pattern: /api|sdk|cli|developer/i },
]

const DEFAULT_FEATURE_ICON = InfinityIcon

export function getPlanFeatureIcon(featureText: string): LucideIcon {
  return (
    FEATURE_ICON_RULES.find((rule) => rule.pattern.test(featureText))?.icon ?? DEFAULT_FEATURE_ICON
  )
}

export function toPlanFeatures(features: string[]): PlanFeature[] {
  return features.map((text) => ({
    icon: getPlanFeatureIcon(text),
    text,
  }))
}
