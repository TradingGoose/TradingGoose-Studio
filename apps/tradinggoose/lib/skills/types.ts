export interface SkillDefinition {
  id: string
  workspaceId: string
  userId: string | null
  name: string
  description: string
  content: string
  createdAt?: string
  updatedAt?: string
}
