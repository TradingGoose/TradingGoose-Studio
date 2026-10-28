import { RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface NoOrganizationViewProps {
  canCreateOrganization: boolean
  orgName: string
  orgSlug: string
  setOrgSlug: (slug: string) => void
  onOrgNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onCreateOrganization: () => Promise<void>
  isCreatingOrg: boolean
  error: string | null
}

export function NoOrganizationView({
  canCreateOrganization,
  orgName,
  orgSlug,
  setOrgSlug,
  onOrgNameChange,
  onCreateOrganization,
  isCreatingOrg,
  error,
}: NoOrganizationViewProps) {
  const t = useTranslations('workspace.settingsModal.team')

  if (!canCreateOrganization) {
    return (
      <div className='px-6 pt-4 pb-4'>
        <div className='flex flex-col gap-6'>
          <div>
            <h4 className='font-medium text-sm'>{t('upgradeToCreateTeam')}</h4>
            <p className='mt-1 text-muted-foreground text-xs'>
              {t('upgradeToCreateTeamDescription')}
            </p>
          </div>

          <div className='flex justify-end'>
            <Button
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('open-settings', { detail: { tab: 'subscription' } })
                )
              }}
              className='h-9 rounded-sm'
            >
              {t('openSubscriptionSettings')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-6'>
        <div>
          <h4 className='font-medium text-sm'>{t('createYourTeamWorkspace')}</h4>
          <p className='mt-1 text-muted-foreground text-xs'>
            {t('createYourTeamWorkspaceDescription')}
          </p>
        </div>

        <div className='space-y-4'>
          <div>
            <Label htmlFor='orgName' className='font-medium text-sm'>
              {t('teamName')}
            </Label>
            <Input
              id='orgName'
              value={orgName}
              onChange={onOrgNameChange}
              placeholder={t('teamNamePlaceholder')}
              className='mt-1'
            />
          </div>

          <div>
            <Label htmlFor='orgSlug' className='font-medium text-sm'>
              {t('teamUrl')}
            </Label>
            <div className='mt-1 flex items-center'>
              <div className='rounded-l-[8px] border border-r-0 bg-muted px-3 py-2 text-muted-foreground text-sm'>
                tradinggoose.ai/team/
              </div>
              <Input
                id='orgSlug'
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                placeholder={t('teamSlugPlaceholder')}
                className='rounded-l-none'
              />
            </div>
          </div>

          {error ? (
            <Alert variant='destructive' className='rounded-sm'>
              <AlertTitle>{t('error')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className='flex justify-end'>
            <Button
              onClick={onCreateOrganization}
              disabled={!orgName || !orgSlug || isCreatingOrg}
              focusableWhenDisabled={isCreatingOrg}
              aria-busy={isCreatingOrg || undefined}
              className='h-9 rounded-sm'
            >
              {isCreatingOrg ? <RefreshCw className='h-4 w-4 animate-spin' /> : null}
              {isCreatingOrg ? t('creating') : t('createTeamWorkspace')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
