'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCheck, ShieldCheck, UserCheck2, X } from 'lucide-react'
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
  useAdminRegistrationSnapshot,
  useSaveRegistrationMode,
  useUpdateWaitlistStatuses,
} from '@/hooks/queries/admin-registration'

const TIME_RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
] as const

type WaitlistTimeRange = (typeof TIME_RANGE_OPTIONS)[number]['value']

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'Never'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
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

function getStatusLabel(status: WaitlistStatus) {
  return status === 'signed_up' ? 'Signed up' : status
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
  const snapshotQuery = useAdminRegistrationSnapshot()
  const saveModeMutation = useSaveRegistrationMode()
  const updateWaitlistMutation = useUpdateWaitlistStatuses()
  const [searchTerm, setSearchTerm] = useState('')
  const [submittedRange, setSubmittedRange] = useState<WaitlistTimeRange>('all')
  const [statusFilters, setStatusFilters] = useState<WaitlistStatus[]>([...WAITLIST_STATUS_VALUES])
  const [selectedIds, setSelectedIds] = useState<string[]>([])

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

    updateWaitlistMutation.mutate(
      { ids, status },
      {
        onSuccess: () => {
          if (clearSelection) {
            setSelectedIds([])
          }
        },
      }
    )
  }

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <ShieldCheck className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Admin registration</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder='Search waitlist entries...'
          className='w-full'
        />
      </div>
    </div>
  )

  const headerRight = (
    <div className='flex items-center gap-2'>
      <span className='hidden text-[11px] text-muted-foreground xl:inline'>Mode</span>
      <div className='flex items-center gap-2 rounded-md border bg-muted/20 p-1'>
        {REGISTRATION_MODE_VALUES.map((mode) => {
          const isActive = registrationMode === mode

          return (
            <Button
              key={mode}
              variant={isActive ? 'default' : 'ghost'}
              size='sm'
              disabled={saveModeMutation.isPending && saveModeMutation.variables === mode}
              onClick={() => saveModeMutation.mutate(mode as RegistrationMode)}
              className='h-7 px-2 capitalize'
            >
              {mode}
            </Button>
          )
        })}
      </div>
    </div>
  )

  const headerCenter = (
    <div className='hidden items-center gap-3 rounded-md border bg-muted/20 px-3 py-1.5 xl:flex'>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Pending</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.pending}</span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Approved</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.approved}</span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Rejected</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.rejected}</span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Signed up</span>
        <span className='font-medium text-[11px] text-foreground'>{counts.signedUp}</span>
      </div>
    </div>
  )

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='flex h-full min-h-0 flex-col gap-4'>
        {snapshotQuery.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(snapshotQuery.error)}</AlertDescription>
          </Alert>
        ) : null}

        {saveModeMutation.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(saveModeMutation.error)}</AlertDescription>
          </Alert>
        ) : null}

        {updateWaitlistMutation.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(updateWaitlistMutation.error)}</AlertDescription>
          </Alert>
        ) : null}

        {!snapshot && snapshotQuery.isPending ? (
          <div className='flex flex-1 items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>Loading registration settings...</p>
          </div>
        ) : null}

        {snapshot ? (
          <div className='min-h-0 flex-1 overflow-hidden rounded-lg border bg-background'>
            <div className='flex flex-col gap-3 border-b bg-muted/10 px-4 py-3 lg:flex-row lg:items-center'>
              <div className='flex flex-1 flex-wrap items-center gap-3 lg:min-w-0 lg:flex-nowrap'>
                <p className='text-muted-foreground text-sm lg:flex-shrink-0'>
                  <span className='font-medium text-foreground'>{selectedIds.length}</span> selected
                </p>

                <div className='flex w-full flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 sm:w-auto lg:min-w-0 lg:flex-nowrap'>
                  <span className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.2em]'>
                    Submitted
                  </span>
                  {TIME_RANGE_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      size='sm'
                      variant={submittedRange === option.value ? 'default' : 'ghost'}
                      className='h-7 rounded-md px-2 text-[11px]'
                      onClick={() => setSubmittedRange(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>

                <div className='flex w-full flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 sm:w-auto lg:min-w-0 lg:flex-nowrap'>
                  <span className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.2em]'>
                    Status
                  </span>
                  <Button
                    size='sm'
                    variant={allStatusesSelected ? 'default' : 'ghost'}
                    className='h-7 rounded-md px-2 text-[11px]'
                    onClick={() => setStatusFilters([...WAITLIST_STATUS_VALUES])}
                  >
                    All
                  </Button>
                  {WAITLIST_STATUS_VALUES.map((status) => (
                    <Button
                      key={status}
                      size='sm'
                      variant={statusFilters.includes(status) ? 'default' : 'ghost'}
                      className='h-7 rounded-md px-2 text-[11px] capitalize'
                      onClick={() => toggleStatusFilter(status)}
                    >
                      {getStatusLabel(status)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className='flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto lg:flex-nowrap lg:justify-end'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={selectedIds.length === 0 || updateWaitlistMutation.isPending}
                  onClick={() => updateEntries(selectedIds, 'approved', true)}
                  className='min-w-[88px] flex-1 sm:flex-none'
                >
                  <CheckCheck className='mr-2 h-4 w-4' />
                  Approve
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={selectedIds.length === 0 || updateWaitlistMutation.isPending}
                  onClick={() => updateEntries(selectedIds, 'rejected', true)}
                  className='min-w-[88px] flex-1 sm:flex-none'
                >
                  <UserCheck2 className='mr-2 h-4 w-4' />
                  Reject
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={selectedIds.length === 0 || updateWaitlistMutation.isPending}
                  onClick={() => setSelectedIds([])}
                  className='min-w-[88px] flex-1 sm:flex-none'
                >
                  <X className='mr-2 h-4 w-4' />
                  Clear
                </Button>
              </div>
            </div>

            <div className='min-h-0 overflow-auto'>
              <Table>
                <TableHeader className='sticky top-0 z-10 bg-background'>
                  <TableRow>
                    <TableHead className='w-10 bg-background'>
                      <Switch
                        checked={bulkSelectionChecked}
                        disabled={selectableIds.length === 0 || updateWaitlistMutation.isPending}
                        onCheckedChange={(checked) =>
                          setSelectedIds(checked === true ? selectableIds : [])
                        }
                        aria-label='Select visible waitlist entries'
                      />
                    </TableHead>
                    <TableHead className='bg-background'>Email</TableHead>
                    <TableHead className='bg-background'>Status</TableHead>
                    <TableHead className='bg-background'>Submitted</TableHead>
                    <TableHead className='bg-background'>Last activity</TableHead>
                    <TableHead className='bg-background'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWaitlist.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className='py-10 text-center text-muted-foreground'>
                        No waitlist entries match the current search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredWaitlist.map((entry) => {
                      const isUpdating =
                        updateWaitlistMutation.isPending &&
                        updateWaitlistMutation.variables?.ids?.includes(entry.id)
                      const isSelectable = entry.status !== 'signed_up'
                      const submittedAt = formatTimestamp(entry.createdAt)
                      const lastActivityAt = formatTimestamp(getLastActivityAt(entry))

                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            {isSelectable ? (
                              <Switch
                                checked={selectedIds.includes(entry.id)}
                                disabled={updateWaitlistMutation.isPending}
                                onCheckedChange={(checked) =>
                                  setSelectedIds((current) =>
                                    checked === true
                                      ? Array.from(new Set([...current, entry.id]))
                                      : current.filter((id) => id !== entry.id)
                                  )
                                }
                                aria-label={`Select ${entry.email}`}
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
                              {getStatusLabel(entry.status)}
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
                                  disabled={isUpdating}
                                  onClick={() => updateEntries([entry.id], 'approved')}
                                >
                                  <CheckCheck className='mr-2 h-4 w-4' />
                                  Approve
                                </Button>
                              ) : null}

                              {entry.status !== 'rejected' && entry.status !== 'signed_up' ? (
                                <Button
                                  size='sm'
                                  variant='outline'
                                  disabled={isUpdating}
                                  onClick={() => updateEntries([entry.id], 'rejected')}
                                >
                                  <UserCheck2 className='mr-2 h-4 w-4' />
                                  Reject
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
