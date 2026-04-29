'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ListingSelector } from '@/components/listing-selector/selector/combo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getListingIdentityKey, type ListingOption } from '@/lib/listing/identity'
import type { QuickOrderSubmitRequest } from '@/app/api/providers/trading/order/types'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import {
  useSubmitTradingOrder,
  useTradingAccounts,
  useTradingPortfolioSnapshot,
} from '@/hooks/queries/trading-portfolio'
import {
  ALPACA_TRAILING_STOP_TRAIL_VALUE_ERROR,
  getAlpacaNotionalOrderTypeError,
} from '@/providers/trading/order-validation'
import {
  isTradingOrderListingSupported,
  resolveTradingListingAssetClass,
} from '@/providers/trading/utils'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitQuickOrderParamsChange,
  useQuickOrderParamsPersistence,
} from '@/widgets/utils/quick-order-params'
import { getSeriesMarketProviderOptions } from '@/widgets/widgets/data_chart/options'
import {
  getQuickOrderDefaultEnvironment,
  getQuickOrderDefaultTimeInForce,
  getQuickOrderEnvironmentOptions,
  getQuickOrderOrderTypeDefinitions,
  getQuickOrderProviderAvailabilityIds,
  getQuickOrderProviderOptions,
  getQuickOrderSizingModeConfig,
  getQuickOrderTimeInForceOptions,
  normalizeQuickOrderNumber,
  type QuickOrderNumberParseResult,
  resolveQuickOrderCredentialProvider,
  resolveQuickOrderOrderType,
  resolveQuickOrderProviderId,
} from '@/widgets/widgets/quick_order/components/shared'
import type { QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/types'

type QuickOrderBodyParams = QuickOrderWidgetParams | null

const centerStateClassName =
  'flex h-full min-h-0 items-center justify-center px-4 py-6 text-center text-muted-foreground text-sm'

function CenterState({ children }: { children: string }) {
  return <div className={centerStateClassName}>{children}</div>
}

const formatCurrency = (value: number | null | undefined, currency = 'USD') => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '$ -'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

const getQuickOrderMarketProviderId = () => {
  const options = getSeriesMarketProviderOptions()
  return options.find((option) => option.id === 'yahoo-finance')?.id ?? options[0]?.id ?? ''
}

function OrderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-3 text-sm'>
      <span className='font-medium text-foreground'>{label}</span>
      <span className='font-mono text-muted-foreground tabular-nums'>{value}</span>
    </div>
  )
}

function FieldBlock({ children }: { children: ReactNode }) {
  return <div className='space-y-2'>{children}</div>
}

const getParsedNumberValue = (result: QuickOrderNumberParseResult) =>
  result.ok ? result.value : undefined

const isPositiveNumber = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const getNumberValidationMessage = (
  label: string,
  result: QuickOrderNumberParseResult
): string | null => {
  if (!result.ok) return `Enter a valid ${label}.`
  return isPositiveNumber(result.value) ? null : `Enter ${label}.`
}

const getValidationMessage = ({
  providerId,
  credentialId,
  environment,
  accountId,
  listing,
  orderType,
  timeInForce,
  sizingMode,
  quantity,
  notional,
  limitPrice,
  stopPrice,
  trailPrice,
  trailPercent,
  orderTypeMessage,
}: {
  providerId?: string
  credentialId?: string
  environment?: 'paper' | 'live'
  accountId?: string
  listing: ListingOption | null
  orderType?: string
  timeInForce?: string
  sizingMode?: 'quantity' | 'notional'
  quantity: QuickOrderNumberParseResult
  notional: QuickOrderNumberParseResult
  limitPrice: QuickOrderNumberParseResult
  stopPrice: QuickOrderNumberParseResult
  trailPrice: QuickOrderNumberParseResult
  trailPercent: QuickOrderNumberParseResult
  orderTypeMessage?: string | null
}) => {
  if (!providerId || !credentialId || !environment || !accountId)
    return 'Select provider, connection, environment, and account.'
  if (!listing) return 'Select a listing.'

  const resolvedAssetClass = resolveTradingListingAssetClass(listing)
  if (!resolvedAssetClass) return 'Resolved listing asset class is required.'
  if (!isTradingOrderListingSupported(providerId, listing))
    return 'Listing is not supported by this provider.'
  if (orderTypeMessage) return orderTypeMessage
  if (!orderType) return 'Select an order type.'
  if (!timeInForce) return 'Select a time in force.'

  if (providerId === 'alpaca' && sizingMode === 'notional') {
    const notionalMessage = getNumberValidationMessage('notional amount', notional)
    if (notionalMessage) return notionalMessage
    const orderTypeError = getAlpacaNotionalOrderTypeError(orderType)
    if (orderTypeError) return orderTypeError
    if (timeInForce !== 'day') return 'Alpaca notional orders require DAY.'
  } else {
    const quantityMessage = getNumberValidationMessage('quantity', quantity)
    if (quantityMessage) return quantityMessage
  }

  if (orderType === 'trailing_stop') {
    if (!trailPrice.ok) return 'Enter a valid trail price.'
    if (!trailPercent.ok) return 'Enter a valid trail percent.'
    const hasTrailPrice = isPositiveNumber(trailPrice.value)
    const hasTrailPercent = isPositiveNumber(trailPercent.value)
    if ((hasTrailPrice && hasTrailPercent) || (!hasTrailPrice && !hasTrailPercent)) {
      return ALPACA_TRAILING_STOP_TRAIL_VALUE_ERROR
    }
    return null
  }

  if (orderType === 'limit' || orderType === 'stop_limit') {
    const limitPriceMessage = getNumberValidationMessage('limit price', limitPrice)
    if (limitPriceMessage) return limitPriceMessage
  }
  if (orderType === 'stop' || orderType === 'stop_limit') {
    const stopPriceMessage = getNumberValidationMessage('stop price', stopPrice)
    if (stopPriceMessage) return stopPriceMessage
  }

  return null
}

export function QuickOrderWidgetBody({
  context,
  panelId,
  widget,
  params,
  onWidgetParamsChange,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const quickOrderParams = (params as QuickOrderBodyParams) ?? null
  const widgetKey = widget?.key ?? 'quick_order'
  const side = quickOrderParams?.side === 'sell' ? 'sell' : 'buy'

  useQuickOrderParamsPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    params,
  })

  const listingInstanceId = `quick-order-${panelId ?? 'panel'}-${widgetKey}`
  const updateListingSelector = useListingSelectorStore((state) => state.updateInstance)
  const resetListingSelector = useListingSelectorStore((state) => state.resetInstance)
  const previousProviderRef = useRef<string | undefined>(undefined)
  const submitOrder = useSubmitTradingOrder()
  const resetSubmitOrder = submitOrder.reset

  const [listing, setListing] = useState<ListingOption | null>(null)
  const [quantityInput, setQuantityInput] = useState('')
  const [notionalInput, setNotionalInput] = useState('')
  const [limitPriceInput, setLimitPriceInput] = useState('')
  const [stopPriceInput, setStopPriceInput] = useState('')
  const [trailPriceInput, setTrailPriceInput] = useState('')
  const [trailPercentInput, setTrailPercentInput] = useState('')
  const [sizingMode, setSizingMode] = useState<'quantity' | 'notional' | undefined>(undefined)
  const [orderType, setOrderType] = useState('')
  const [timeInForce, setTimeInForce] = useState('')

  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getQuickOrderProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getQuickOrderProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolveQuickOrderProviderId(
    quickOrderParams?.provider,
    providerAvailabilityQuery.data
  )
  const hasSelectedProvider = Boolean(providerId)
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const environmentOptions = useMemo(
    () => (providerId ? getQuickOrderEnvironmentOptions(providerId) : []),
    [providerId]
  )
  const environment =
    providerId &&
    quickOrderParams?.environment &&
    environmentOptions.includes(quickOrderParams.environment)
      ? quickOrderParams.environment
      : providerId
        ? getQuickOrderDefaultEnvironment(providerId)
        : undefined
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolveQuickOrderCredentialProvider(providerId)
      : undefined
  const credentialsQuery = useOAuthCredentials(
    credentialProviderId,
    hasSelectedProvider && areProviderOptionsReady && Boolean(credentialProviderId)
  )
  const credentials = credentialsQuery.data ?? []
  const activeCredentialId = quickOrderParams?.credentialId
  const accountsQuery = useTradingAccounts({
    provider: hasSelectedProvider && areProviderOptionsReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: hasSelectedProvider && areProviderOptionsReady ? environment : undefined,
  })
  const accounts = accountsQuery.data ?? []
  const singleAccount = accounts.length === 1 ? (accounts[0] ?? null) : null
  const selectedAccount =
    quickOrderParams?.accountId && !accountsQuery.isLoading && !accountsQuery.error
      ? (accounts.find((account) => account.id === quickOrderParams.accountId) ?? null)
      : !quickOrderParams?.accountId
        ? singleAccount
        : null
  const activeAccountId = quickOrderParams?.accountId ?? singleAccount?.id
  const accountSnapshotQuery = useTradingPortfolioSnapshot({
    provider: hasSelectedProvider && areProviderOptionsReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: hasSelectedProvider && areProviderOptionsReady ? environment : undefined,
    accountId: activeAccountId,
  })
  const submitResetProviderKey = quickOrderParams?.provider ?? providerId
  const submitResetEnvironmentKey = quickOrderParams?.environment ?? environment

  const sizingModeConfig = useMemo(
    () => (providerId ? getQuickOrderSizingModeConfig(providerId) : { options: [] }),
    [providerId]
  )
  const sizingOptions = sizingModeConfig.options
  const defaultSizingMode = sizingModeConfig.defaultMode
  const selectedSizingMode =
    sizingOptions.length > 0
      ? sizingMode && sizingOptions.includes(sizingMode)
        ? sizingMode
        : defaultSizingMode
      : undefined
  const resolvedAssetClass = listing ? resolveTradingListingAssetClass(listing) : undefined
  const isListingSupported =
    !providerId || !listing || !resolvedAssetClass
      ? false
      : isTradingOrderListingSupported(providerId, listing)
  const orderTypeDefinitions = useMemo(
    () =>
      providerId && listing && resolvedAssetClass && isListingSupported
        ? getQuickOrderOrderTypeDefinitions(providerId, listing)
        : [],
    [providerId, listing, resolvedAssetClass, isListingSupported]
  )
  const defaultOrderTypeResolution = useMemo(
    () =>
      providerId && listing && resolvedAssetClass && isListingSupported
        ? resolveQuickOrderOrderType({ providerId, listing })
        : null,
    [providerId, listing, resolvedAssetClass, isListingSupported]
  )
  const requestedOrderTypeResolution = useMemo(
    () =>
      providerId && listing && resolvedAssetClass && isListingSupported
        ? resolveQuickOrderOrderType({
            providerId,
            listing,
            orderType: orderType || undefined,
          })
        : null,
    [providerId, listing, resolvedAssetClass, isListingSupported, orderType]
  )
  const defaultOrderType =
    defaultOrderTypeResolution?.ok === true ? defaultOrderTypeResolution.orderType : ''
  const orderTypePlaceholder = !listing
    ? 'Select listing first'
    : !resolvedAssetClass
      ? 'Asset class unavailable'
      : !isListingSupported
        ? 'Listing unsupported'
        : 'No supported types'
  const orderTypeMessage =
    listing && !resolvedAssetClass
      ? 'Resolved listing asset class is required.'
      : listing && resolvedAssetClass && !isListingSupported
        ? 'Listing is not supported by this provider.'
        : requestedOrderTypeResolution?.ok === false &&
            requestedOrderTypeResolution.reason === 'no_supported_order_types'
          ? 'No supported order types for this listing.'
          : requestedOrderTypeResolution?.ok === false
            ? 'Selected order type is not supported for this listing.'
            : null
  const timeInForceOptions = useMemo(
    () => (providerId ? getQuickOrderTimeInForceOptions(providerId) : []),
    [providerId]
  )
  const defaultTimeInForce = providerId ? getQuickOrderDefaultTimeInForce(providerId) : undefined
  const marketProviderId = useMemo(() => getQuickOrderMarketProviderId(), [])
  const quoteItems = useMemo(
    () =>
      listing
        ? [
            {
              key: getListingIdentityKey(listing),
              listing,
            },
          ]
        : [],
    [listing]
  )
  const quoteSnapshotsQuery = useMarketQuoteSnapshots({
    workspaceId: workspaceId ?? undefined,
    provider: marketProviderId || undefined,
    items: quoteItems,
    enabled: Boolean(workspaceId && marketProviderId && quoteItems.length > 0),
  })

  const quantity = normalizeQuickOrderNumber(quantityInput)
  const notional = normalizeQuickOrderNumber(notionalInput)
  const limitPrice = normalizeQuickOrderNumber(limitPriceInput)
  const stopPrice = normalizeQuickOrderNumber(stopPriceInput)
  const trailPrice = normalizeQuickOrderNumber(trailPriceInput)
  const trailPercent = normalizeQuickOrderNumber(trailPercentInput)
  const parsedQuantity = getParsedNumberValue(quantity)
  const parsedNotional = getParsedNumberValue(notional)
  const parsedLimitPrice = getParsedNumberValue(limitPrice)
  const parsedStopPrice = getParsedNumberValue(stopPrice)
  const parsedTrailPrice = getParsedNumberValue(trailPrice)
  const parsedTrailPercent = getParsedNumberValue(trailPercent)
  const quoteKey = quoteItems[0]?.key
  const selectedQuote = quoteKey ? quoteSnapshotsQuery.data?.[quoteKey] : undefined
  const marketPrice =
    typeof selectedQuote?.lastPrice === 'number' && Number.isFinite(selectedQuote.lastPrice)
      ? selectedQuote.lastPrice
      : undefined
  const accountSnapshot = accountSnapshotQuery.data
  const accountCurrency =
    accountSnapshot?.account.baseCurrency ?? selectedAccount?.baseCurrency ?? 'USD'
  const cashBuyingPower =
    typeof accountSnapshot?.accountSummary.buyingPower === 'number'
      ? accountSnapshot.accountSummary.buyingPower
      : accountSnapshot?.accountSummary.totalCashValue
  const estimatedReferencePrice = parsedLimitPrice ?? parsedStopPrice ?? marketPrice
  const estimatedOrderValue =
    selectedSizingMode === 'notional'
      ? parsedNotional
      : parsedQuantity && estimatedReferencePrice
        ? parsedQuantity * estimatedReferencePrice
        : undefined
  const validationMessage = getValidationMessage({
    providerId,
    credentialId: activeCredentialId,
    environment,
    accountId: activeAccountId,
    listing,
    orderType,
    timeInForce,
    sizingMode: selectedSizingMode,
    quantity,
    notional,
    limitPrice,
    stopPrice,
    trailPrice,
    trailPercent,
    orderTypeMessage,
  })

  useEffect(() => {
    if (!areProviderOptionsReady || !quickOrderParams?.provider || providerId) return
    emitQuickOrderParamsChange({
      params: {
        provider: null,
        credentialId: null,
        environment: null,
        accountId: null,
      },
      panelId,
      widgetKey,
    })
  }, [areProviderOptionsReady, panelId, providerId, quickOrderParams?.provider, widgetKey])

  useEffect(() => {
    if (!providerId || quickOrderParams?.environment === environment) return
    emitQuickOrderParamsChange({
      params: { environment: environment ?? null, accountId: null },
      panelId,
      widgetKey,
    })
  }, [environment, panelId, providerId, quickOrderParams?.environment, widgetKey])

  useEffect(() => {
    if (accountsQuery.isLoading || accountsQuery.error || !activeCredentialId) return

    if (!quickOrderParams?.accountId && accounts.length === 1 && accounts[0]) {
      emitQuickOrderParamsChange({
        params: { accountId: accounts[0].id },
        panelId,
        widgetKey,
      })
    }
  }, [
    accounts,
    accountsQuery.error,
    accountsQuery.isLoading,
    activeCredentialId,
    panelId,
    quickOrderParams?.accountId,
    widgetKey,
  ])

  useEffect(() => {
    if (previousProviderRef.current === providerId) return
    previousProviderRef.current = providerId
    setListing(null)
    setQuantityInput('')
    setNotionalInput('')
    setLimitPriceInput('')
    setStopPriceInput('')
    setTrailPriceInput('')
    setTrailPercentInput('')
    setOrderType('')
    setTimeInForce('')
    setSizingMode(undefined)
    resetSubmitOrder()
    updateListingSelector(listingInstanceId, {
      providerId,
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
      selectedListingValue: null,
      selectedListing: null,
    })
  }, [listingInstanceId, providerId, resetSubmitOrder, updateListingSelector])

  useEffect(() => {
    if (sizingOptions.length === 0) {
      if (sizingMode) setSizingMode(undefined)
      return
    }
    if (!sizingMode || !sizingOptions.includes(sizingMode)) {
      setSizingMode(defaultSizingMode)
    }
  }, [defaultSizingMode, sizingMode, sizingOptions])

  useEffect(() => {
    if (!listing || !resolvedAssetClass || !isListingSupported || !defaultOrderType) {
      if (orderType) setOrderType('')
      return
    }
    if (!orderType || requestedOrderTypeResolution?.ok === false) {
      setOrderType(defaultOrderType)
    }
  }, [
    defaultOrderType,
    isListingSupported,
    listing,
    orderType,
    requestedOrderTypeResolution?.ok,
    resolvedAssetClass,
  ])

  useEffect(() => {
    if (!defaultTimeInForce) {
      if (timeInForce) setTimeInForce('')
      return
    }
    if (!timeInForce || !timeInForceOptions.includes(timeInForce)) {
      setTimeInForce(defaultTimeInForce)
    }
  }, [defaultTimeInForce, timeInForce, timeInForceOptions])

  useEffect(() => {
    const usesLimitPrice = orderType === 'limit' || orderType === 'stop_limit'
    const usesStopPrice = orderType === 'stop' || orderType === 'stop_limit'
    const usesTrailValue = orderType === 'trailing_stop'

    if (!usesLimitPrice && limitPriceInput) setLimitPriceInput('')
    if (!usesStopPrice && stopPriceInput) setStopPriceInput('')
    if (!usesTrailValue && trailPriceInput) setTrailPriceInput('')
    if (!usesTrailValue && trailPercentInput) setTrailPercentInput('')
  }, [limitPriceInput, orderType, stopPriceInput, trailPercentInput, trailPriceInput])

  useEffect(() => {
    resetSubmitOrder()
  }, [
    limitPriceInput,
    listing,
    notionalInput,
    orderType,
    quickOrderParams?.accountId,
    quickOrderParams?.credentialId,
    quantityInput,
    side,
    sizingMode,
    stopPriceInput,
    resetSubmitOrder,
    submitResetEnvironmentKey,
    submitResetProviderKey,
    timeInForce,
    trailPercentInput,
    trailPriceInput,
  ])

  useEffect(() => {
    return () => {
      resetListingSelector(listingInstanceId)
    }
  }, [listingInstanceId, resetListingSelector])

  if (providerAvailabilityQuery.isLoading) {
    return (
      <div className={centerStateClassName}>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (providerAvailabilityQuery.error) {
    return <CenterState>Failed to load trading providers.</CenterState>
  }

  if (providerOptions.length === 0) {
    return <CenterState>No order-capable trading providers are available.</CenterState>
  }

  if (!providerId) {
    return <CenterState>Select a trading provider to get started.</CenterState>
  }

  if (credentialsQuery.isLoading) {
    return (
      <div className={centerStateClassName}>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (credentialsQuery.error) {
    return <CenterState>Failed to load provider connections.</CenterState>
  }

  if (credentials.length === 0 && !activeCredentialId) {
    return <CenterState>No provider connections found. Add one from provider settings.</CenterState>
  }

  if (!activeCredentialId) {
    return <CenterState>Select a provider connection in settings.</CenterState>
  }

  if (!activeAccountId) {
    if (accountsQuery.isLoading) {
      return (
        <div className={centerStateClassName}>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (accountsQuery.error) {
      return <CenterState>Failed to load broker accounts.</CenterState>
    }

    if (accounts.length === 0) {
      return <CenterState>No broker accounts found for the selected credential.</CenterState>
    }

    return <CenterState>Select a broker account to submit an order.</CenterState>
  }

  const canSubmit = !validationMessage && !submitOrder.isPending
  const order = submitOrder.data?.order

  const handleSubmit = () => {
    if (
      validationMessage ||
      !providerId ||
      !environment ||
      !activeCredentialId ||
      !activeAccountId ||
      !listing
    ) {
      return
    }

    const payload: QuickOrderSubmitRequest = {
      provider: providerId,
      credentialId: activeCredentialId,
      environment,
      accountId: activeAccountId,
      listing,
      side,
      orderType,
      timeInForce,
    }

    if (providerId === 'alpaca' && selectedSizingMode === 'notional') {
      payload.orderSizingMode = 'notional'
      if (parsedNotional !== undefined) payload.notional = parsedNotional
    } else {
      if (selectedSizingMode) payload.orderSizingMode = selectedSizingMode
      if (parsedQuantity !== undefined) payload.quantity = parsedQuantity
    }

    if ((orderType === 'limit' || orderType === 'stop_limit') && parsedLimitPrice) {
      payload.limitPrice = parsedLimitPrice
    }
    if ((orderType === 'stop' || orderType === 'stop_limit') && parsedStopPrice) {
      payload.stopPrice = parsedStopPrice
    }
    if (orderType === 'trailing_stop') {
      if (parsedTrailPrice) payload.trailPrice = parsedTrailPrice
      if (parsedTrailPercent) payload.trailPercent = parsedTrailPercent
    }

    resetSubmitOrder()
    submitOrder.mutate(payload)
  }

  return (
    <form
      className='flex h-full min-h-0 flex-col bg-background'
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
        <div className='space-y-5'>
          <ListingSelector
            instanceId={listingInstanceId}
            providerType='trading'
            className='w-full'
            listingRequired
            onListingChange={(nextListing) => {
              setListing(nextListing)
              setOrderType('')
            }}
            onListingValueChange={() => {
              setListing(null)
              setOrderType('')
            }}
          />

          <OrderRow label='Market Price' value={formatCurrency(marketPrice, accountCurrency)} />

          <FieldBlock>
            <Label htmlFor='quick-order-size'>
              {selectedSizingMode === 'notional' ? 'Notional' : 'Quantity'}
            </Label>
            <Input
              id='quick-order-size'
              className='h-9 font-mono'
              inputMode='decimal'
              value={selectedSizingMode === 'notional' ? notionalInput : quantityInput}
              placeholder={selectedSizingMode === 'notional' ? '0.00' : '0'}
              onChange={(event) => {
                if (selectedSizingMode === 'notional') {
                  setNotionalInput(event.target.value)
                  return
                }
                setQuantityInput(event.target.value)
              }}
            />
          </FieldBlock>

          <FieldBlock>
            <Label htmlFor='quick-order-order-type'>Order Type</Label>
            <Select
              value={orderType || undefined}
              disabled={
                !listing ||
                !resolvedAssetClass ||
                !isListingSupported ||
                orderTypeDefinitions.length === 0
              }
              onValueChange={setOrderType}
            >
              <SelectTrigger id='quick-order-order-type' className='h-9'>
                <SelectValue placeholder={orderTypePlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {orderTypeDefinitions.map((definition) => (
                  <SelectItem key={definition.id} value={definition.id}>
                    {definition.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          {sizingOptions.length > 1 ? (
            <FieldBlock>
              <Label>Choose how to {side}</Label>
              <RadioGroup
                className='flex items-center gap-5'
                value={selectedSizingMode}
                onValueChange={(value) =>
                  setSizingMode(value === 'notional' ? 'notional' : 'quantity')
                }
              >
                {sizingOptions.map((option) => {
                  const id = `${listingInstanceId}-sizing-${option}`
                  return (
                    <div key={option} className='flex items-center gap-2'>
                      <RadioGroupItem id={id} value={option} />
                      <Label htmlFor={id} className='cursor-pointer text-muted-foreground text-sm'>
                        {option === 'quantity' ? 'Shares' : 'Dollars'}
                      </Label>
                    </div>
                  )
                })}
              </RadioGroup>
            </FieldBlock>
          ) : null}

          <FieldBlock>
            <Label htmlFor='quick-order-time-in-force'>Time in Force</Label>
            <Select value={timeInForce || undefined} onValueChange={setTimeInForce}>
              <SelectTrigger id='quick-order-time-in-force' className='h-9'>
                <SelectValue placeholder='Select time in force' />
              </SelectTrigger>
              <SelectContent>
                {timeInForceOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          {orderType !== 'trailing_stop' &&
          (orderType === 'limit' || orderType === 'stop_limit') ? (
            <FieldBlock>
              <Label htmlFor='quick-order-limit-price'>Limit Price</Label>
              <Input
                id='quick-order-limit-price'
                className='h-9 font-mono'
                inputMode='decimal'
                value={limitPriceInput}
                placeholder='0.00'
                onChange={(event) => setLimitPriceInput(event.target.value)}
              />
            </FieldBlock>
          ) : null}

          {orderType !== 'trailing_stop' && (orderType === 'stop' || orderType === 'stop_limit') ? (
            <FieldBlock>
              <Label htmlFor='quick-order-stop-price'>Stop Price</Label>
              <Input
                id='quick-order-stop-price'
                className='h-9 font-mono'
                inputMode='decimal'
                value={stopPriceInput}
                placeholder='0.00'
                onChange={(event) => setStopPriceInput(event.target.value)}
              />
            </FieldBlock>
          ) : null}

          {orderType === 'trailing_stop' ? (
            <div className='grid grid-cols-2 gap-3'>
              <FieldBlock>
                <Label htmlFor='quick-order-trail-price'>Trail Price</Label>
                <Input
                  id='quick-order-trail-price'
                  className='h-9 font-mono'
                  inputMode='decimal'
                  value={trailPriceInput}
                  disabled={Boolean(trailPercentInput)}
                  placeholder='0.00'
                  onChange={(event) => {
                    setTrailPriceInput(event.target.value)
                    if (event.target.value.trim()) setTrailPercentInput('')
                  }}
                />
              </FieldBlock>
              <FieldBlock>
                <Label htmlFor='quick-order-trail-percent'>Trail Percent</Label>
                <Input
                  id='quick-order-trail-percent'
                  className='h-9 font-mono'
                  inputMode='decimal'
                  value={trailPercentInput}
                  disabled={Boolean(trailPriceInput)}
                  placeholder='0.00'
                  onChange={(event) => {
                    setTrailPercentInput(event.target.value)
                    if (event.target.value.trim()) setTrailPriceInput('')
                  }}
                />
              </FieldBlock>
            </div>
          ) : null}

          {listing && !resolvedAssetClass ? (
            <div className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300 text-xs'>
              Resolved listing asset class is required.
            </div>
          ) : null}
          {listing && resolvedAssetClass && !isListingSupported ? (
            <div className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300 text-xs'>
              Listing is not supported by this provider.
            </div>
          ) : null}
          {listing && resolvedAssetClass && isListingSupported && orderTypeMessage ? (
            <div className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300 text-xs'>
              {orderTypeMessage}
            </div>
          ) : null}
        </div>
      </div>

      <div className='shrink-0 border-border/70 border-t bg-background/95 px-4 py-3'>
        <div className='space-y-2 rounded-md border border-border/70 bg-card/30 p-3'>
          <OrderRow
            label={side === 'sell' ? 'Estimated Proceeds' : 'Estimated Cost'}
            value={formatCurrency(estimatedOrderValue, accountCurrency)}
          />
          <OrderRow
            label='Cash Buying Power'
            value={formatCurrency(cashBuyingPower, accountCurrency)}
          />
        </div>
        {submitOrder.error ? (
          <div className='mb-2 text-destructive text-xs'>{submitOrder.error.message}</div>
        ) : order ? (
          <div className='mb-2 text-xs'>
            <div className='space-y-0.5 text-muted-foreground'>
              <div className='text-foreground'>
                {order.id ? `Order ${order.id}` : 'Order submitted'}
                {order.status ? ` · ${order.status}` : ''}
              </div>
              <div>
                {[
                  submitOrder.data?.provider,
                  submitOrder.data?.environment?.toUpperCase(),
                  submitOrder.data?.accountId,
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </div>
              <div>
                {[order.symbol, side.toUpperCase(), order.submittedAt].filter(Boolean).join(' · ')}
              </div>
              {submitOrder.data?.message ? <div>{submitOrder.data.message}</div> : null}
            </div>
          </div>
        ) : null}
        <Button type='submit' className='h-10 w-full' disabled={!canSubmit}>
          {submitOrder.isPending ? 'Submitting...' : `Submit ${side.toUpperCase()} Order`}
        </Button>
      </div>
    </form>
  )
}
