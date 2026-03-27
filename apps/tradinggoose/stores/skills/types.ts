export interface SkillDefinition {
  id: string
  workspaceId: string
  userId: string | null
  name: string
  description: string
  content: string
  createdAt: string
  updatedAt?: string
}

export interface SkillsStore {
  skillsByWorkspace: Record<string, SkillDefinition[]>
  activeWorkspaceId: string | null

  setSkills: (workspaceId: string, skills: SkillDefinition[]) => void
  getSkill: (id: string, workspaceId?: string) => SkillDefinition | undefined
  getAllSkills: (workspaceId?: string) => SkillDefinition[]
  resetWorkspace: (workspaceId: string) => void
  resetAll: () => void
}
