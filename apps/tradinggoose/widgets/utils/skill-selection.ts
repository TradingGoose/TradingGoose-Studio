import { useEffect } from 'react'
import { SKILL_WIDGET_SELECT_EVENT, type SkillWidgetSelectEventDetail } from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'

const DEFAULT_SCOPE_KEY = 'editor_skill'

interface UseSkillSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onSkillSelect?: (skillId: string | null) => void
  scopeKey?: string
}

export function useSkillSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  params,
  pairColor = 'gray',
  onSkillSelect,
  scopeKey,
}: UseSkillSelectionPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange && !onSkillSelect) {
      return
    }

    const resolvedScopeKey = scopeKey ?? DEFAULT_SCOPE_KEY

    const handleSkillSelect = (event: Event) => {
      const detail = (event as CustomEvent<SkillWidgetSelectEventDetail>).detail
      if (!detail?.widgetKey) return
      if (resolvedScopeKey && detail.widgetKey !== resolvedScopeKey) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return

      if (pairColor !== 'gray' && onSkillSelect) {
        onSkillSelect(detail.skillId ?? null)
        return
      }

      if (pairColor !== 'gray') {
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        skillId: detail.skillId ?? null,
      })
    }

    window.addEventListener(SKILL_WIDGET_SELECT_EVENT, handleSkillSelect as EventListener)

    return () => {
      window.removeEventListener(SKILL_WIDGET_SELECT_EVENT, handleSkillSelect as EventListener)
    }
  }, [onWidgetParamsChange, onSkillSelect, pairColor, panelId, params, scopeKey])
}

interface EmitSkillSelectionOptions {
  skillId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitSkillSelectionChange({
  skillId,
  panelId,
  widgetKey,
}: EmitSkillSelectionOptions) {
  if (!widgetKey) return

  window.dispatchEvent(
    new CustomEvent<SkillWidgetSelectEventDetail>(SKILL_WIDGET_SELECT_EVENT, {
      detail: {
        skillId: skillId ?? null,
        panelId,
        widgetKey,
      },
    })
  )
}
