'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Loader2, ShieldCheck, UserCheck2, X } from 'lucide-react'
import { type Messages, useLocale, useMessages } from 'next-intl'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui'
import type { AdminWaitlistEntry } from '@/lib/admin/registration/types'
import {
  REGISTRATION_MODE_VALUES,
  type RegistrationMode,
  WAITLIST_STATUS_VALUES,
  type WaitlistStatus,
} from '@/lib/registration/shared'
import { ADMIN_STATUS_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
import { AdminPageShell } from '@/app/admin/page-shell'
import { SearchInput } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  adminRegistrationKeys,
  updateAdminRegistration,
  useAdminRegistrationSnapshot,
} from '@/hooks/queries/admin-registration'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'

const TIME_RANGE_VALUES = ['all', '7d', '30d', '90d'] as const

type WaitlistTimeRange = (typeof TIME_RANGE_VALUES)[number]
type RegistrationAction =
  | { kind: 'mode'; mode: RegistrationMode }
  | {
      kind: 'row'
      entryId: string
      status: Extract<WaitlistStatus, 'approved' | 'rejected'>
    }
  | {
      kind: 'bulk'
      ids: string[]
      status: Extract<WaitlistStatus, 'approved' | 'rejected'>
    }
type RegistrationStatusCopy = Messages['admin']['registration']['status']
type RegistrationModeCopy = Messages['admin']['registration']['modes']

function formatTimestamp(locale: string, value: string | null, neverLabel: string) {
  if (!value) {
    return neverLabel
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : null
}

function getStatusVariant(status: AdminWaitlistEntry['status']) {
  if (status === 'approved' || status === 'signed_up') {
    return 'default' as const
  }

  if (status === 'rejected') {
    return 'destructive' as const
  }

  return 'secondary' as const
}

function getStatusLabel(status: WaitlistStatus, copy: RegistrationStatusCopy) {
  switch (status) {
    case 'pending':
      return copy.pending
    case 'approved':
      return copy.approved
    case 'rejected':
      return copy.rejected
    case 'signed_up':
      return copy.signedUp
  }
}

function getModeLabel(mode: RegistrationMode, copy: RegistrationModeCopy) {
  switch (mode) {
    case 'open':
      return copy.open
    case 'waitlist':
      return copy.waitlist
    case 'disabled':
      return copy.disabled
  }
}

function getTimeRangeCutoff(range: WaitlistTimeRange) {
  if (range === 'all') {
    return null
  }

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  switch (range) {
    case '7d':
      return now - 7 * day
    case '30d':
      return now - 30 * day
    case '90d':
      return now - 90 * day
  }
}

function isWithinTimeRange(value: string, range: WaitlistTimeRange) {
  const cutoff = getTimeRangeCutoff(range)
  if (cutoff === null) {
    return true
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp >= cutoff
}

function getLastActivityAt(entry: AdminWaitlistEntry) {
  return entry.signedUpAt ?? entry.approvedAt ?? entry.rejectedAt
}

export function AdminRegistration() {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().admin.registration
  const snapshotQuery = useAdminRegistrationSnapshot()
  const [searchTerm, setSearchTerm] = useState('')
  const [submittedRange, setSubmittedRange] = useState<WaitlistTimeRange>('all')
  const [statusFilters, setStatusFilters] = useState<WaitlistStatus[]>([...WAITLIST_STATUS_VALUES])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const queryClient = useQueryClient()
  const writeLockRef = useRef(false)
  const registrationMutation = useMutation({
    mutationFn: (action: RegistrationAction) =>
      updateAdminRegistration(
        action.kind === 'mode'
          ? { type: 'settings', registrationMode: action.mode }
          : {
              type: 'waitlist',
              ids: action.kind === 'row' ? [action.entryId] : action.ids,
              status: action.status,
            }
      ),
    onSuccess: (nextSnapshot, action) => {
      queryClient.setQueryData(adminRegistrationKeys.snapshot(), nextSnapshot)
      if (action.kind === 'bulk') {
        setSelectedIds([])
      }
    },
    onSettled: () => {
      writeLockRef.current = false
    },
  })

  const snapshot = snapshotQuery.data
  const registrationMode = snapshot?.registrationMode ?? 'open'
  const waitlist = snapshot?.waitlist ?? []
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const activeStatusFilters = new Set(statusFilters)

  const filteredWaitlist = useMemo(
    () =>
      waitlist.filter((entry) => {
        if (!activeStatusFilters.has(entry.status)) {
          return false
        }

        if (!isWithinTimeRange(entry.createdAt, submittedRange)) {
          return false
        }

        if (!normalizedSearchTerm) {
          return true
        }

        return (
          entry.email.toLowerCase().includes(normalizedSearchTerm) ||
          entry.status.toLowerCase().includes(normalizedSearchTerm)
        )
      }),
    [activeStatusFilters, normalizedSearchTerm, submittedRange, waitlist]
  )
  const timeRangeLabels: Record<WaitlistTimeRange, string> = {
    all: copy.timeRanges.all,
    '7d': copy.timeRanges['7d'],
    '30d': copy.timeRanges['30d'],
    '90d': copy.timeRanges['90d'],
  }

  const selectableIds = useMemo(
    () => filteredWaitlist.filter((entry) => entry.status !== 'signed_up').map((entry) => entry.id),
    [filteredWaitlist]
  )

  useEffect(() => {
    const visibleSelectableIds = new Set(selectableIds)
    setSelectedIds((current) => {
      const next = current.filter((id) => visibleSelectableIds.has(id))
      return next.length === current.length ? current : next
    })
  }, [selectableIds])

  const counts = {
    pending: waitlist.filter((entry) => entry.status === 'pending').length,
    approved: waitlist.filter((entry) => entry.status === 'approved').length,
    rejected: waitlist.filter((entry) => entry.status === 'rejected').length,
    signedUp: waitlist.filter((entry) => entry.status === 'signed_up').length,
  }

  const allStatusesSelected = statusFilters.length === WAITLIST_STATUS_VALUES.length
  const selectedVisibleCount = selectedIds.length
  const bulkSelectionChecked =
    selectableIds.length > 0 && selectedVisibleCount === selectableIds.length
  const pendingAction = registrationMutation.isPending ? registrationMutation.variables : undefined
  const isBulkApproving = pendingAction?.kind === 'bulk' && pendingAction.status === 'approved'
  const isBulkRejecting = pendingAction?.kind === 'bulk' && pendingAction.status === 'rejected'

  function toggleStatusFilter(status: WaitlistStatus) {
    setStatusFilters((current) => {
      if (current.includes(status)) {
        return current.length === 1 ? current : current.filter((item) => item !== status)
      }

      return [...current, status]
    })
  }

  function updateEntries(
    ids: string[],
    status: Extract<WaitlistStatus, 'approved' | 'rejected'>,
    clearSelection = false
  ) {
    if (ids.length === 0) {
      return
    }

    startRegistrationAction(
      clearSelection
        ? { kind: 'bulk', ids: [...ids], status }
        : { kind: 'row', entryId: ids[0] as string, status }
    )
  }

  function startRegistrationAction(action: RegistrationAction) {
    if (
      writeLockRef.current ||
      registrationMutation.isPending ||
      (action.kind === 'mode' && action.mode === registrationMode)
    ) {
      return
    }

    writeLockRef.current = true
    registrationMutation.mutate(action)
  }

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <ShieldCheck className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>{copy.title}</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={copy.searchPlaceholder}
          clearLabel={copy.clearSearch}
          className='w-full'
        />
      </div>
    </div>
  )

  const headerRight = (
    <div className='flex items-center gap-2'>
      <span className='hidden text-[11px] text-muted-foreground xl:inline'>{copy.mode}</span>
      <div className='flex items-center gap-2 rounded-md border bg-muted/20 p-1'>
        {REGISTRATION_MODE_VALUES.map((mode) => {
          const isActive = registrationMode === mode
          const isSwitching =
            registrationMutation.isPending &&
            registrationMutation.variables?.kind === 'mode' &&
            registrationMutation.variables.mode === mode
          const modeLabel = getModeLabel(mode as RegistrationMode, copy.modes)

          return (
            <Button
              key={mode}
              variant={isActive ? 'default' : 'ghost'}
              size='sm'
              disabled={isActive || registrationMutation.isPending}
              aria-busy={isSwitching || undefined}
              onClick={() =>
                startRegistrationAction({ kind: 'mode', mode: mode as RegistrationMode })
              }
              className='h-7 px-2'
            >
              {isSwitching ? (
                <>
                  <Loader2
                    aria-hidden='true'
                    className='size-4 animate-spin motion-reduce:animate-none'
                  />
                  {formatTemplate(copy.actions.switching, { mode: modeLabel })}
                </>
              ) : (
                modeLabel
              )}
            </Button>
          )
        })}
      </div>
    </div>
  )

  const headerCenter = (
    <div className='hidden items-center gap-3 rounded-md border bg-muted/20 px-3 py-1.5 xl:flex'>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.status.pending}</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.pending}</span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.status.approved}</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.approved}</span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.status.rejected}</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.rejected}</span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.status.signedUp}</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.signedUp}</span>
      </div>
    </div>
  )

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='flex h-full min-h-0 flex-col gap-4'>
        {snapshotQuery.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {getErrorMessage(snapshotQuery.error) ?? copy.error}
            </AlertDescription>
          </Alert>
        ) : null}

        {registrationMutation.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {getErrorMessage(registrationMutation.error) ?? copy.error}
            </AlertDescription>
          </Alert>
        ) : null}

        {!snapshot && snapshotQuery.isPending ? (
          <div
            role='status'
            aria-live='polite'
            aria-atomic='true'
            className='flex flex-1 items-center justify-center rounded-lg border bg-background'
          >
            <p className='text-muted-foreground text-sm'>{copy.loading}</p>
          </div>
        ) : null}

        {snapshot ? (
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background'>
            <div className='flex flex-col gap-3 border-b bg-muted/10 px-4 py-3 lg:flex-row lg:items-center'>
              <div className='flex flex-1 flex-wrap items-center gap-3 lg:min-w-0 lg:flex-nowrap'>
                <p className='text-muted-foreground text-sm lg:flex-shrink-0'>
                  {formatTemplate(copy.selectedCount, { count: selectedIds.length })}
                </p>

                <div className='flex w-full flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 sm:w-auto lg:min-w-0 lg:flex-nowrap'>
                  <span className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.2em]'>
                    {copy.submitted}
                  </span>
                  {TIME_RANGE_VALUES.map((option) => (
                    <Button
                      key={option}
                      size='sm'
                      variant={submittedRange === option ? 'default' : 'ghost'}
                      className='h-7 rounded-md px-2 text-[11px]'
                      onClick={() => setSubmittedRange(option)}
                    >
                      {timeRangeLabels[option]}
                    </Button>
                  ))}
                </div>

                <div className='flex w-full flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 sm:w-auto lg:min-w-0 lg:flex-nowrap'>
                  <span className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.2em]'>
                    {copy.statusLabel}
                  </span>
                  <Button
                    size='sm'
                    variant={allStatusesSelected ? 'default' : 'ghost'}
                    className='h-7 rounded-md px-2 text-[11px]'
                    onClick={() => setStatusFilters([...WAITLIST_STATUS_VALUES])}
                  >
                    {copy.all}
                  </Button>
                  {WAITLIST_STATUS_VALUES.map((status) => (
                    <Button
                      key={status}
                      size='sm'
                      variant={statusFilters.includes(status) ? 'default' : 'ghost'}
                      className='h-7 rounded-md px-2 text-[11px] capitalize'
                      onClick={() => toggleStatusFilter(status)}
                    >
                      {getStatusLabel(status, copy.status)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className='flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto lg:flex-nowrap lg:justify-end'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={selectedIds.length === 0 || registrationMutation.isPending}
                  aria-busy={isBulkApproving || undefined}
                  onClick={() => updateEntries(selectedIds, 'approved', true)}
                  className='min-w-[88px] flex-1 sm:flex-none'
                >
                  {isBulkApproving ? (
                    <Loader2
                      aria-hidden='true'
                      className='size-4 animate-spin motion-reduce:animate-none'
                    />
                  ) : (
                    <CheckCheck className='h-4 w-4' />
                  )}
                  {isBulkApproving ? copy.actions.approving : copy.actions.approve}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={selectedIds.length === 0 || registrationMutation.isPending}
                  aria-busy={isBulkRejecting || undefined}
                  onClick={() => updateEntries(selectedIds, 'rejected', true)}
                  className='min-w-[88px] flex-1 sm:flex-none'
                >
                  {isBulkRejecting ? (
                    <Loader2
                      aria-hidden='true'
                      className='size-4 animate-spin motion-reduce:animate-none'
                    />
                  ) : (
                    <UserCheck2 className='h-4 w-4' />
                  )}
                  {isBulkRejecting ? copy.actions.rejecting : copy.actions.reject}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={selectedIds.length === 0 || registrationMutation.isPending}
                  onClick={() => setSelectedIds([])}
                  className='min-w-[88px] flex-1 sm:flex-none'
                >
                  <X className='mr-2 h-4 w-4' />
                  {copy.actions.clear}
                </Button>
              </div>
            </div>

            <div className='min-h-0 flex-1 overflow-auto'>
              <Table>
                <TableHeader className='sticky top-0 z-10 bg-background'>
                  <TableRow>
                    <TableHead className='w-10 bg-background'>
                      <Switch
                        checked={bulkSelectionChecked}
                        disabled={selectableIds.length === 0 || registrationMutation.isPending}
                        onCheckedChange={(checked) =>
                          setSelectedIds(checked === true ? selectableIds : [])
                        }
                        aria-label={copy.selectVisible}
                      />
                    </TableHead>
                    <TableHead className='bg-background'>{copy.table.email}</TableHead>
                    <TableHead className='bg-background'>{copy.table.status}</TableHead>
                    <TableHead className='bg-background'>{copy.table.submitted}</TableHead>
                    <TableHead className='bg-background'>{copy.table.lastActivity}</TableHead>
                    <TableHead className='bg-background'>{copy.table.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWaitlist.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className='py-10 text-center text-muted-foreground'>
                        {copy.emptyState}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredWaitlist.map((entry) => {
                      const isApproving =
                        pendingAction?.kind === 'row' &&
                        pendingAction.entryId === entry.id &&
                        pendingAction.status === 'approved'
                      const isRejecting =
                        pendingAction?.kind === 'row' &&
                        pendingAction.entryId === entry.id &&
                        pendingAction.status === 'rejected'
                      const isSelectable = entry.status !== 'signed_up'
                      const submittedAt = formatTimestamp(locale, entry.createdAt, copy.never)
                      const lastActivityAt = formatTimestamp(
                        locale,
                        getLastActivityAt(entry),
                        copy.never
                      )

                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            {isSelectable ? (
                              <Switch
                                checked={selectedIds.includes(entry.id)}
                                disabled={registrationMutation.isPending}
                                onCheckedChange={(checked) =>
                                  setSelectedIds((current) =>
                                    checked === true
                                      ? Array.from(new Set([...current, entry.id]))
                                      : current.filter((id) => id !== entry.id)
                                  )
                                }
                                aria-label={formatTemplate(copy.selectEntry, {
                                  email: entry.email,
                                })}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell className='font-medium'>
                            <span
                              className='block max-w-[140px] truncate sm:max-w-[220px] lg:max-w-none'
                              title={entry.email}
                            >
                              {entry.email}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={getStatusVariant(entry.status)}
                              className={ADMIN_STATUS_BADGE_CLASSNAME}
                            >
                              {getStatusLabel(entry.status, copy.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span
                              className='block max-w-[112px] truncate sm:max-w-[160px] lg:max-w-none'
                              title={submittedAt}
                            >
                              {submittedAt}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className='block max-w-[112px] truncate sm:max-w-[160px] lg:max-w-none'
                              title={lastActivityAt}
                            >
                              {lastActivityAt}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className='flex items-center gap-2'>
                              {entry.status !== 'approved' && entry.status !== 'signed_up' ? (
                                <Button
                                  size='sm'
                                  variant='outline'
                                  disabled={registrationMutation.isPending}
                                  aria-busy={isApproving || undefined}
                                  onClick={() => updateEntries([entry.id], 'approved')}
                                >
                                  {isApproving ? (
                                    <Loader2
                                      aria-hidden='true'
                                      className='size-4 animate-spin motion-reduce:animate-none'
                                    />
                                  ) : (
                                    <CheckCheck className='h-4 w-4' />
                                  )}
                                  {isApproving ? copy.actions.approving : copy.actions.approve}
                                </Button>
                              ) : null}

                              {entry.status !== 'rejected' && entry.status !== 'signed_up' ? (
                                <Button
                                  size='sm'
                                  variant='outline'
                                  disabled={registrationMutation.isPending}
                                  aria-busy={isRejecting || undefined}
                                  onClick={() => updateEntries([entry.id], 'rejected')}
                                >
                                  {isRejecting ? (
                                    <Loader2
                                      aria-hidden='true'
                                      className='size-4 animate-spin motion-reduce:animate-none'
                                    />
                                  ) : (
                                    <UserCheck2 className='h-4 w-4' />
                                  )}
                                  {isRejecting ? copy.actions.rejecting : copy.actions.reject}
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>
    </AdminPageShell>
  )
}
