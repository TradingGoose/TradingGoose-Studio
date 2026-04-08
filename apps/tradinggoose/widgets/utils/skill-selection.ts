import {
  SKILL_WIDGET_SELECT_EVENT,
  type SkillWidgetSelectEventDetail,
  type ReviewTargetEventFields,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import {
  createSelectionPersistenceHook,
  createEmitSelectionChange,
  type UseSelectionPersistenceOptions,
} from '@/widgets/utils/selection-persistence-factory'

const DEFAULT_SCOPE_KEY = 'editor_skill'

// Hook

const useSkillSelectionPersistenceGeneric = createSelectionPersistenceHook({
  eventName: SKILL_WIDGET_SELECT_EVENT,
  detailIdKey: 'skillId',
  defaultScopeKey: DEFAULT_SCOPE_KEY,
})

interface UseSkillSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onSkillSelect?: (skillId: string | null) => void
  scopeKey?: string
}

export function useSkillSelectionPersistence({
  onSkillSelect,
  ...rest
}: UseSkillSelectionPersistenceOptions) {
  const opts: UseSelectionPersistenceOptions = {
    ...rest,
    onEntitySelect: onSkillSelect,
  }
  useSkillSelectionPersistenceGeneric(opts)
}

// Emit

const emitGeneric = createEmitSelectionChange({
  eventName: SKILL_WIDGET_SELECT_EVENT,
  detailIdKey: 'skillId',
})

interface EmitSkillSelectionOptions extends ReviewTargetEventFields {
  skillId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitSkillSelectionChange({
  skillId,
  ...rest
}: EmitSkillSelectionOptions) {
  emitGeneric({ ...rest, entityId: skillId })
}
