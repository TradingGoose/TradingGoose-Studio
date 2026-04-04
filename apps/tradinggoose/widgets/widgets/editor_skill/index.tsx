'use client'

import { ToolCase } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import {
  SkillEditorSaveButton,
  SkillEditorSelector,
} from '@/widgets/widgets/editor_skill/components/skill-editor-header'
import { EditorSkillWidgetBody } from '@/widgets/widgets/editor_skill/editor-skill-body'
import { getSkillIdFromParams, SKILL_EDITOR_WIDGET_KEY } from '@/widgets/widgets/_shared/skill/utils'

export const editorSkillWidget: DashboardWidgetDefinition = {
  key: SKILL_EDITOR_WIDGET_KEY,
  title: 'Skill Editor',
  icon: ToolCase,
  category: 'editor',
  description: 'Edit workspace skills.',
  component: (props) => <EditorSkillWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const skillId = getSkillIdFromParams(
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null
    )

    return {
      center: (
        <SkillEditorSelector
          workspaceId={context?.workspaceId}
          panelId={panelId}
          skillId={skillId}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
        />
      ),
      right: (
        <div className='flex items-center gap-1'>
          <SkillEditorSaveButton
            workspaceId={context?.workspaceId}
            skillId={skillId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
          />
        </div>
      ),
    }
  },
}
