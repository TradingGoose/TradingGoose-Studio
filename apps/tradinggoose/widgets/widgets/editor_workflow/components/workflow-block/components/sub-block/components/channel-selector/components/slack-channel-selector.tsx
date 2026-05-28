import { useCallback, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { Check, ChevronDown, Hash, Lock, RefreshCw } from 'lucide-react'
import { SlackIcon } from '@/components/icons/icons'
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

export interface SlackChannelInfo {
  id: string
  name: string
  isPrivate: boolean
}

interface SlackChannelSelectorProps {
  value: string
  onChange: (channelId: string, channelInfo?: SlackChannelInfo) => void
  credential: string
  label?: string
  disabled?: boolean
  workflowId?: string
  isForeignCredential?: boolean
}

export function SlackChannelSelector({
  value,
  onChange,
  credential,
  label,
  disabled = false,
  workflowId,
  isForeignCredential = false,
}: SlackChannelSelectorProps) {
  const locale = useLocale() as LocaleCode
  const selectorCopy = useWorkspaceBlockEditorMessages().slackChannelSelector
  const copy = {
    selectSlackChannel: translateWorkflowLabel(locale, 'Select Slack channel'),
    searchChannels: translateWorkflowLabel(locale, 'Search channels...'),
    loadingChannels: translateWorkflowLabel(locale, 'Loading channels...'),
    missingCredentials: translateWorkflowLabel(locale, 'Missing credentials'),
    configureSlackCredentials: translateWorkflowLabel(locale, 'Please configure Slack credentials.'),
    noChannelsFound: translateWorkflowLabel(locale, 'No channels found'),
    noChannelsAvailable: translateWorkflowLabel(locale, 'No channels available for this Slack workspace.'),
    channels: translateWorkflowLabel(locale, 'Channels'),
    private: translateWorkflowLabel(locale, 'Private'),
    usingSharedAccount: translateWorkflowLabel(locale, 'Using a shared account'),
  }
  type SlackChannelSelectorErrorCode = keyof typeof selectorCopy.errors
  const labelText = label ?? copy.selectSlackChannel
  const [channels, setChannels] = useState<SlackChannelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<SlackChannelSelectorErrorCode | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<SlackChannelInfo | null>(null)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  // Fetch channels from Slack API
  const fetchChannels = useCallback(async () => {
    if (!credential) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/tools/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: credential, workflowId }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => null)
        console.error('Failed to fetch Slack channels', { status: res.status, errorData })
        setError('failedToFetchChannels')
        setChannels([])
        setInitialFetchDone(true)
        return
      }

      const data = await res.json()
      if (data.error) {
        console.error('Slack channels API returned an error', data)
        setError('failedToFetchChannels')
        setChannels([])
        setInitialFetchDone(true)
      } else {
        setChannels(data.channels)
        setInitialFetchDone(true)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      console.error('Failed to fetch Slack channels', err)
      setError('failedToFetchChannels')
      setChannels([])
      setInitialFetchDone(true)
    } finally {
      setLoading(false)
    }
  }, [credential])

  // Handle dropdown open/close - fetch channels when opening
  const handleOpenChange = (isOpen: boolean) => {
    setOpen((prev) => (prev === isOpen ? prev : isOpen))

    // Only fetch channels when opening the dropdown and if we have valid credential
    if (isOpen && credential && (!initialFetchDone || channels.length === 0)) {
      fetchChannels()
    }
  }

  // Sync selected channel with value prop
  useEffect(() => {
    if (value && channels.length > 0) {
      const channelInfo = channels.find((c) => c.id === value)
      setSelectedChannel(channelInfo || null)
    } else if (!value) {
      setSelectedChannel(null)
    }
  }, [value, channels])

  // If we have a value but no channel info and haven't fetched yet, get just that channel
  useEffect(() => {
    if (value && !selectedChannel && !loading && !initialFetchDone && credential) {
      // For now, we'll fetch all channels when needed
      // In the future, we could optimize to fetch just the selected channel
      fetchChannels()
    }
  }, [value, selectedChannel, loading, initialFetchDone, credential, fetchChannels])

  const handleSelectChannel = (channel: SlackChannelInfo) => {
    setSelectedChannel(channel)
    onChange(channel.id, channel)
    setOpen(false)
  }

  const getChannelIcon = (channel: SlackChannelInfo) => {
    return channel.isPrivate ? <Lock className='h-1.5 w-1.5' /> : <Hash className='h-1.5 w-1.5' />
  }

  const formatChannelName = (channel: SlackChannelInfo) => {
    return channel.name
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='relative w-full justify-between'
          disabled={disabled || !credential}
          title={isForeignCredential ? copy.usingSharedAccount : undefined}
        >
          <div className='flex max-w-[calc(100%-20px)] items-center gap-2 overflow-hidden'>
            <SlackIcon className='h-4 w-4 text-[#611f69]' />
            {selectedChannel ? (
              <>
                {getChannelIcon(selectedChannel)}
                <span className='truncate font-normal'>{formatChannelName(selectedChannel)}</span>
              </>
            ) : value ? (
              <>
                <Hash className='h-1.5 w-1.5' />
                <span className='truncate font-normal'>{value}</span>
              </>
            ) : (
              <span className='truncate text-muted-foreground'>{labelText}</span>
            )}
          </div>
          <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[250px] p-0' align='start'>
        <Command>
          <CommandInput placeholder={copy.searchChannels} />
          <CommandList>
            <CommandEmpty>
              {loading ? (
                <div className='flex items-center justify-center p-4'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='ml-2'>{copy.loadingChannels}</span>
                </div>
              ) : error ? (
                <div className='p-4 text-center'>
                  <p className='text-destructive text-sm'>{selectorCopy.errors[error]}</p>
                </div>
              ) : !credential ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>{copy.missingCredentials}</p>
                  <p className='text-muted-foreground text-xs'>{copy.configureSlackCredentials}</p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>{copy.noChannelsFound}</p>
                  <p className='text-muted-foreground text-xs'>{copy.noChannelsAvailable}</p>
                </div>
              )}
            </CommandEmpty>

            {channels.length > 0 && (
              <CommandGroup>
                <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                  {copy.channels}
                </div>
                {channels.map((channel) => (
                  <CommandItem
                    key={channel.id}
                    value={`channel-${channel.id}-${channel.name}`}
                    onSelect={() => handleSelectChannel(channel)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center gap-1 overflow-hidden'>
                      <SlackIcon className='h-4 w-4 text-[#611f69]' />
                      {getChannelIcon(channel)}
                      <span className='truncate font-normal'>{formatChannelName(channel)}</span>
                      {channel.isPrivate && (
                        <span className='ml-auto text-muted-foreground text-xs'>{copy.private}</span>
                      )}
                    </div>
                    {channel.id === value && <Check className='ml-auto h-4 w-4' />}
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
