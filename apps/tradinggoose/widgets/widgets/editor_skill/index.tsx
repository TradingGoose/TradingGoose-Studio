'use client'

import { ToolCase } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { getSkillIdFromParams } from '@/widgets/widgets/_shared/skill/utils'
import {
  SkillEditorExportButton,
  SkillEditorSaveButton,
  SkillEditorSelector,
} from '@/widgets/widgets/editor_skill/components/skill-editor-header'
import { skillEditorWidgetContract } from '@/widgets/widgets/editor_skill/contract'
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
      center: <SkillEditorSelector workspaceId={context?.workspaceId} skillId={skillId} />,
      right: (
        <div className='flex items-center gap-1'>
          <SkillEditorExportButton
            workspaceId={context?.workspaceId}
            skillId={skillId}
            panelId={panelId}
            widgetKey={widget?.key}
          />
          <SkillEditorSaveButton
            workspaceId={context?.workspaceId}
            skillId={skillId}
            panelId={panelId}
            widgetKey={widget?.key}
            canEditEntity={context?.canWrite !== false}
          />
        </div>
      ),
    }
  },
}
