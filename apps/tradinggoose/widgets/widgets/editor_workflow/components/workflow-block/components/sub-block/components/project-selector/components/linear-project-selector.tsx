import { useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { useLocale } from 'next-intl'
import { LinearIcon } from '@/components/icons/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { useWorkspaceBlockEditorMessages } from '@/i18n/workspace-widget-hooks'

export interface LinearProjectInfo {
  id: string
  name: string
}

interface LinearProjectSelectorProps {
  value: string
  onChange: (projectId: string, projectInfo?: LinearProjectInfo) => void
  credential: string
  teamId: string
  label?: string
  disabled?: boolean
  workflowId?: string
}

export function LinearProjectSelector({
  value,
  onChange,
  credential,
  teamId,
  label,
  disabled = false,
  workflowId,
}: LinearProjectSelectorProps) {
  const locale = useLocale() as LocaleCode
  const selectorCopy = useWorkspaceBlockEditorMessages().linearProjectSelector
  const copy = {
    selectLinearProject: translateWorkflowLabel(locale, 'selectLinearProject'),
    searchProjects: translateWorkflowLabel(locale, 'searchProjects'),
    loading: translateWorkflowLabel(locale, 'loading'),
    missingCredentialsOrTeam: translateWorkflowLabel(locale, 'missingCredentialsOrTeam'),
    configureLinearCredentialsAndSelectTeam: translateWorkflowLabel(
      locale,
      'configureLinearCredentialsAndSelectTeam'
    ),
    noProjectsFound: translateWorkflowLabel(locale, 'noProjectsFound'),
    noProjectsAvailable: translateWorkflowLabel(locale, 'noProjectsAvailable'),
    projects: translateWorkflowLabel(locale, 'projects'),
  }
  const [projects, setProjects] = useState<LinearProjectInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<keyof typeof selectorCopy.errors | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<LinearProjectInfo | null>(null)
  const labelText = label ?? copy.selectLinearProject
  const errorMessage = errorKey ? selectorCopy.errors[errorKey] : null

  useEffect(() => {
    if (!credential || !teamId) return
    const controller = new AbortController()
    setLoading(true)
    setErrorKey(null)

    fetch('/api/tools/linear/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: credential, teamId, workflowId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          await res.text()
          throw new Error('failedToFetchProjects')
        }
        return res.json()
      })
      .then((data) => {
        if (data.error) {
          setErrorKey('failedToFetchProjects')
          setProjects([])
        } else {
          setProjects(data.projects)

          // Find selected project info if we have a value
          if (value) {
            const projectInfo = data.projects.find((p: LinearProjectInfo) => p.id === value)
            setSelectedProject(projectInfo || null)
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setErrorKey('failedToFetchProjects')
        setProjects([])
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [credential, teamId, value, workflowId])

  // Sync selected project with value prop
  useEffect(() => {
    if (value && projects.length > 0) {
      const projectInfo = projects.find((p) => p.id === value)
      setSelectedProject(projectInfo || null)
    } else if (!value) {
      setSelectedProject(null)
    }
  }, [value, projects])

  const handleSelectProject = (project: LinearProjectInfo) => {
    setSelectedProject(project)
    onChange(project.id, project)
    setOpen(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen((prev) => (prev === isOpen ? prev : isOpen))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled || !credential || !teamId}
        render={
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='w-full justify-between'
            disabled={disabled || !credential || !teamId}
          />
        }
      >
        {selectedProject ? (
          <div className='flex items-center gap-1 overflow-hidden'>
            <LinearIcon className='h-4 w-4' />
            <span className='truncate font-normal'>{selectedProject.name}</span>
          </div>
        ) : (
          <div className='flex items-center gap-1'>
            <LinearIcon className='h-4 w-4' />
            <span className='text-muted-foreground'>{labelText}</span>
          </div>
        )}
        <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
      </PopoverTrigger>
      <PopoverContent className='w-[300px] p-0' align='start'>
        <Command>
          <CommandInput placeholder={copy.searchProjects} />
          <CommandList>
            <CommandEmpty>
              {loading ? (
                <div className='flex items-center justify-center p-4'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='ml-2'>{copy.loading}</span>
                </div>
              ) : errorMessage ? (
                <div className='p-4 text-center'>
                  <p className='text-destructive text-sm'>{errorMessage}</p>
                </div>
              ) : !credential || !teamId ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>{copy.missingCredentialsOrTeam}</p>
                  <p className='text-muted-foreground text-xs'>
                    {copy.configureLinearCredentialsAndSelectTeam}
                  </p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>{copy.noProjectsFound}</p>
                  <p className='text-muted-foreground text-xs'>{copy.noProjectsAvailable}</p>
                </div>
              )}
            </CommandEmpty>

            {projects.length > 0 && (
              <CommandGroup>
                <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                  {copy.projects}
                </div>
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`project-${project.id}-${project.name}`}
                    onSelect={() => handleSelectProject(project)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center gap-1 overflow-hidden'>
                      <LinearIcon className='h-4 w-4' />
                      <span className='truncate font-normal'>{project.name}</span>
                    </div>
                    {project.id === value && <Check className='ml-auto h-4 w-4' />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
