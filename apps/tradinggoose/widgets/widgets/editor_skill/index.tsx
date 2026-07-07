'use client'

import { ToolCase } from 'lucide-react'
import { skillEditorWidgetContract } from '@/widgets/widgets/editor_skill/contract'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { getSkillIdFromParams } from '@/widgets/widgets/_shared/skill/utils'
import {
  SkillEditorExportButton,
  SkillEditorSaveButton,
  SkillEditorSelector,
} from '@/widgets/widgets/editor_skill/components/skill-editor-header'
import { EditorSkillWidgetBody } from '@/widgets/widgets/editor_skill/editor-skill-body'

export const editorSkillWidget: DashboardWidgetDefinition = {
  contract: skillEditorWidgetContract,
  icon: ToolCase,
  component: (props) => <EditorSkillWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const params =
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null
    const skillId = getSkillIdFromParams(params)

    return {
      center: (
        <SkillEditorSelector
          workspaceId={context?.workspaceId}
          panelId={panelId}
          skillId={skillId}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
          params={params}
        />
      ),
      right: (
        <div className='flex items-center gap-1'>
          <SkillEditorExportButton
            workspaceId={context?.workspaceId}
            skillId={skillId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
          />
          <SkillEditorSaveButton
            workspaceId={context?.workspaceId}
            skillId={skillId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
            params={params}
          />
        </div>
      ),
    }
  },
}
