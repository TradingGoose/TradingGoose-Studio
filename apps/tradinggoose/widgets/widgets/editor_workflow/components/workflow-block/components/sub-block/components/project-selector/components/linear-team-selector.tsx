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

export interface LinearTeamInfo {
  id: string
  name: string
}

interface LinearTeamSelectorProps {
  value: string
  onChange: (teamId: string, teamInfo?: LinearTeamInfo) => void
  credential: string
  label?: string
  disabled?: boolean
  workflowId?: string
  showPreview?: boolean
}

export function LinearTeamSelector({
  value,
  onChange,
  credential,
  label,
  disabled = false,
  workflowId,
}: LinearTeamSelectorProps) {
  const locale = useLocale() as LocaleCode
  const selectorCopy = useWorkspaceBlockEditorMessages().linearTeamSelector
  const copy = {
    selectLinearTeam: translateWorkflowLabel(locale, 'selectLinearTeam'),
    searchTeams: translateWorkflowLabel(locale, 'searchTeams'),
    loading: translateWorkflowLabel(locale, 'loading'),
    missingCredentials: translateWorkflowLabel(locale, 'missingCredentials'),
    configureLinearCredentials: translateWorkflowLabel(locale, 'configureLinearCredentials'),
    noTeamsFound: translateWorkflowLabel(locale, 'noTeamsFound'),
    noTeamsAvailable: translateWorkflowLabel(locale, 'noTeamsAvailable'),
    teams: translateWorkflowLabel(locale, 'teams'),
  }
  const labelText = label ?? copy.selectLinearTeam
  const [teams, setTeams] = useState<LinearTeamInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<keyof typeof selectorCopy.errors | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<LinearTeamInfo | null>(null)
  const errorMessage = errorKey ? selectorCopy.errors[errorKey] : null

  useEffect(() => {
    if (!credential) return
    const controller = new AbortController()
    setLoading(true)
    setErrorKey(null)

    fetch('/api/tools/linear/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: credential, workflowId }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error('failedToFetchTeams')
        return res.json()
      })
      .then((data) => {
        if (data.error) {
          setErrorKey('failedToFetchTeams')
          setTeams([])
        } else {
          setTeams(data.teams)

          // Find selected team info if we have a value
          if (value) {
            const teamInfo = data.teams.find((t: LinearTeamInfo) => t.id === value)
            setSelectedTeam(teamInfo || null)
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setErrorKey('failedToFetchTeams')
        setTeams([])
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [credential, value, workflowId])

  // Sync selected team with value prop
  useEffect(() => {
    if (value && teams.length > 0) {
      const teamInfo = teams.find((t) => t.id === value)
      setSelectedTeam(teamInfo || null)
    } else if (!value) {
      setSelectedTeam(null)
    }
  }, [value, teams])

  const handleSelectTeam = (team: LinearTeamInfo) => {
    setSelectedTeam(team)
    onChange(team.id, team)
    setOpen(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen((prev) => (prev === isOpen ? prev : isOpen))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled || !credential}
        render={
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='w-full justify-between'
            disabled={disabled || !credential}
          />
        }
      >
        {selectedTeam ? (
          <div className='flex items-center gap-1 overflow-hidden'>
            <LinearIcon className='h-4 w-4' />
            <span className='truncate font-normal'>{selectedTeam.name}</span>
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
          <CommandInput placeholder={copy.searchTeams} />
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
              ) : !credential ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>{copy.missingCredentials}</p>
                  <p className='text-muted-foreground text-xs'>{copy.configureLinearCredentials}</p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>{copy.noTeamsFound}</p>
                  <p className='text-muted-foreground text-xs'>{copy.noTeamsAvailable}</p>
                </div>
              )}
            </CommandEmpty>

            {teams.length > 0 && (
              <CommandGroup>
                <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                  {copy.teams}
                </div>
                {teams.map((team) => (
                  <CommandItem
                    key={team.id}
                    value={`team-${team.id}-${team.name}`}
                    onSelect={() => handleSelectTeam(team)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center gap-1 overflow-hidden'>
                      <LinearIcon className='h-4 w-4' />
                      <span className='truncate font-normal'>{team.name}</span>
                    </div>
                    {team.id === value && <Check className='ml-auto h-4 w-4' />}
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
