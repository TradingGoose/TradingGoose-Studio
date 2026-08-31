'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useMessages } from 'next-intl'
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
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { getListingIdentityKey, type ListingResolved } from '@/lib/listing/identity'
import type { TradingOrderSubmitRequest } from '@/lib/trading/order-types'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { recordsOrderKeys } from '@/hooks/queries/records-orders'
import { submitTradingOrder, usePortfolioDetail } from '@/hooks/queries/trading-portfolio'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import {
  getTradingOrderTimeInForceOptions,
  resolveTradingOrderTimeInForce,
  tradingOrderTypeUsesField,
} from '@/providers/trading/order-types'
import type {
  TradingOrderSizingModeDefinition,
  TradingOrderTypeDefinition,
} from '@/providers/trading/providers'
import {
  isTradingOrderListingSupported,
  resolveTradingListingAssetClass,
} from '@/providers/trading/utils'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { WidgetComponentProps } from '@/widgets/types'
import { usePortfolioIdentitySelection } from '@/widgets/widgets/components/use-portfolio-identity-selection'
import {
  getQuickOrderOrderTypeDefinitions,
  getQuickOrderProviderAvailabilityIds,
  getQuickOrderProviderOptions,
  getQuickOrderSizingModeConfig,
  getQuickOrderSubmitMutationKey,
  normalizeQuickOrderNumber,
  type QuickOrderNumberParseResult,
  resolveQuickOrderMarketProviderId,
  resolveQuickOrderOrderType,
  resolveQuickOrderProviderId,
} from '@/widgets/widgets/quick_order/components/shared'
import type { QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/contract'

type QuickOrderBodyParams = QuickOrderWidgetParams | null
type OrderAttemptIdempotency = { fingerprint: string; key: string }

const centerStateClassName =
  'flex h-full min-h-0 items-center justify-center px-4 py-6 text-center text-muted-foreground text-sm'

function CenterState({ children }: { children: string }) {
  return <div className={centerStateClassName}>{children}</div>
}

const formatCurrency = (value: number | null | undefined, currency = 'USD', locale = 'en-US') => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '$ -'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
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
  result: QuickOrderNumberParseResult,
  enterValidMessage: string
): string | null => {
  if (!result.ok) return formatTemplate(enterValidMessage, { field: label })
  return isPositiveNumber(result.value) ? null : formatTemplate(enterValidMessage, { field: label })
}

const getValidationMessage = ({
  providerId,
  accountId,
  listing,
  orderType,
  orderTypeDefinition,
  timeInForce,
  sizingMode,
  sizingModeDefinition,
  quantity,
  notional,
  limitPrice,
  stopPrice,
  trailPrice,
  trailPercent,
  orderTypeMessage,
  copy,
  orderFieldLabels,
}: {
  providerId?: string
  accountId?: string
  listing: ListingResolved | null
  orderType?: string
  orderTypeDefinition?: TradingOrderTypeDefinition | null
  timeInForce?: string
  sizingMode?: 'quantity' | 'notional'
  sizingModeDefinition?: TradingOrderSizingModeDefinition
  quantity: QuickOrderNumberParseResult
  notional: QuickOrderNumberParseResult
  limitPrice: QuickOrderNumberParseResult
  stopPrice: QuickOrderNumberParseResult
  trailPrice: QuickOrderNumberParseResult
  trailPercent: QuickOrderNumberParseResult
  orderTypeMessage?: string | null
  copy: Record<string, string>
  orderFieldLabels: Record<'limitPrice' | 'stopPrice' | 'trailPrice' | 'trailPercent', string>
}) => {
  if (!providerId || !accountId) return copy.selectProviderAndAccount
  if (!listing) return copy.selectListing

  const resolvedAssetClass = resolveTradingListingAssetClass(listing)
  if (!resolvedAssetClass) return copy.resolvedListingAssetClassRequired
  if (!isTradingOrderListingSupported(providerId, listing))
    return copy.listingIsNotSupportedByThisProvider
  if (orderTypeMessage) return orderTypeMessage
  if (!orderType) return copy.selectOrderType
  if (!timeInForce) return copy.selectTimeInForce
  if (!sizingMode || !sizingModeDefinition) return copy.selectOrderSize

  if (sizingMode === 'notional') {
    const notionalMessage = getNumberValidationMessage('notional amount', notional, copy.enterValid)
    if (notionalMessage) return notionalMessage
    if (
      sizingModeDefinition.orderTypes?.length &&
      !sizingModeDefinition.orderTypes.includes(orderType)
    ) {
      return copy.notionalSizingIsNotSupportedForThisOrderType
    }
    if (
      sizingModeDefinition.timeInForce?.length &&
      !sizingModeDefinition.timeInForce.includes(timeInForce)
    ) {
      return formatTemplate(copy.notionalSizingRequires, {
        values: sizingModeDefinition.timeInForce.join('/').toUpperCase(),
      })
    }
  } else {
    const quantityMessage = getNumberValidationMessage('quantity', quantity, copy.enterValid)
    if (quantityMessage) return quantityMessage
  }

  for (const field of orderTypeDefinition?.excludes ?? []) {
    const result = { limitPrice, stopPrice, trailPrice, trailPercent }[field]
    if (isPositiveNumber(getParsedNumberValue(result))) {
      return formatTemplate(copy.fieldNotSupportedForThisOrderType, {
        field: orderFieldLabels[field],
      })
    }
  }

  const oneOfFields = orderTypeDefinition?.requiresOneOf ?? []
  if (oneOfFields.length) {
    const values = { limitPrice, stopPrice, trailPrice, trailPercent }
    const invalidField = oneOfFields.find((field) => !values[field].ok)
    if (invalidField)
      return formatTemplate(copy.enterValid, { field: orderFieldLabels[invalidField] })
    const providedCount = oneOfFields.filter((field) =>
      isPositiveNumber(getParsedNumberValue(values[field]))
    ).length
    if (providedCount !== 1) {
      return formatTemplate(copy.oneOfFieldsRequired, {
        fields: oneOfFields.join(' or '),
      })
    }
  }

  for (const field of orderTypeDefinition?.requires ?? []) {
    const result = { limitPrice, stopPrice, trailPrice, trailPercent }[field]
    const message = getNumberValidationMessage(orderFieldLabels[field], result, copy.enterValid)
    if (message) return message
  }

  return null
}

export function QuickOrderWidgetBody({
  context,
  panelId,
  widget,
  params,
  onWidgetParamsPatch,
}: WidgetComponentProps) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.quickOrder
  const workspaceId = context?.workspaceId ?? null
  const quickOrderParams = (params as QuickOrderBodyParams) ?? null
  const widgetKey = widget?.key ?? 'quick_order'
  const side = quickOrderParams?.side === 'sell' ? 'sell' : 'buy'
  const sideLabel = side === 'sell' ? copy.header.sell : copy.header.buy
  const sideLabelLower = sideLabel.toLowerCase()
  const orderFieldLabels = {
    limitPrice: copy.body.limitPrice,
    stopPrice: copy.body.stopPrice,
    trailPrice: copy.body.trailPrice,
    trailPercent: copy.body.trailPercent,
  } as const

  const patchWidgetParams = useCallback(
    (nextParams: Record<string, unknown>) => {
      onWidgetParamsPatch?.(nextParams)
    },
    [onWidgetParamsPatch]
  )

  const listingInstanceId = `quick-order-${panelId ?? 'panel'}-${widgetKey}`
  const updateListingSelector = useListingSelectorStore((state) => state.updateInstance)
  const resetListingSelector = useListingSelectorStore((state) => state.resetInstance)
  const previousProviderRef = useRef<string | undefined>(undefined)
  const orderAttemptIdempotencyRef = useRef<OrderAttemptIdempotency | null>(null)
  const submissionLockRef = useRef(false)
  const queryClient = useQueryClient()
  const submitMutationKey = getQuickOrderSubmitMutationKey(panelId)
  const activeSubmitCount = useIsMutating({ mutationKey: submitMutationKey, exact: true })

  const [listing, setListing] = useState<ListingResolved | null>(null)
  const [quantityInput, setQuantityInput] = useState('')
  const [notionalInput, setNotionalInput] = useState('')
  const [limitPriceInput, setLimitPriceInput] = useState('')
  const [stopPriceInput, setStopPriceInput] = useState('')
  const [trailPriceInput, setTrailPriceInput] = useState('')
  const [trailPercentInput, setTrailPercentInput] = useState('')
  const [sizingMode, setSizingMode] = useState<'quantity' | 'notional' | undefined>(undefined)
  const [orderType, setOrderType] = useState('')
  const [timeInForce, setTimeInForce] = useState('')
  const [isSubmissionActive, setIsSubmissionActive] = useState(false)

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
  const { accountsQuery, activeServiceId, activePortfolioIdentity, services, portfolioIdentities } =
    usePortfolioIdentitySelection({
      providerId,
      serviceId: quickOrderParams?.serviceId,
      portfolioIdentity: quickOrderParams?.portfolioIdentity,
      enabled: areProviderOptionsReady && hasSelectedProvider,
    })
  const accountSnapshotQuery = usePortfolioDetail({
    workspaceId: workspaceId ?? undefined,
    provider: hasSelectedProvider && areProviderOptionsReady ? providerId : undefined,
    serviceId: activeServiceId,
    portfolioIdentity: activePortfolioIdentity,
  })
  const submitOrder = useMutation({
    mutationKey: submitMutationKey,
    mutationFn: async ({
      request,
      refetchPortfolio,
    }: {
      request: TradingOrderSubmitRequest
      refetchPortfolio: typeof accountSnapshotQuery.refetch
    }) => {
      const response = await submitTradingOrder(request)
      const [recordsResult, portfolioResult] = await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: recordsOrderKeys.all }, { throwOnError: true }),
        refetchPortfolio(),
      ])
      const convergenceFailed =
        recordsResult.status === 'rejected' ||
        portfolioResult.status === 'rejected' ||
        Boolean(portfolioResult.value.error)
      return { response, convergenceFailed }
    },
    onSuccess: () => {
      orderAttemptIdempotencyRef.current = null
    },
    onSettled: () => {
      submissionLockRef.current = false
      setIsSubmissionActive(false)
    },
  })
  const resetSubmitOrder = submitOrder.reset
  const isPending = isSubmissionActive || submitOrder.isPending || activeSubmitCount > 0
  const submitResetProviderKey = [
    quickOrderParams?.provider ?? providerId,
    activeServiceId ?? '',
  ].join(':')

  const sizingModeConfig = useMemo(
    () =>
      providerId ? getQuickOrderSizingModeConfig(providerId) : { options: [], definitions: [] },
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
  const selectedSizingModeDefinition = sizingModeConfig.definitions.find(
    (definition) => definition.id === selectedSizingMode
  )
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
  const selectedOrderTypeDefinition =
    requestedOrderTypeResolution?.ok === true ? requestedOrderTypeResolution.definition : null
  const usesLimitPrice = tradingOrderTypeUsesField(selectedOrderTypeDefinition, 'limitPrice')
  const usesStopPrice = tradingOrderTypeUsesField(selectedOrderTypeDefinition, 'stopPrice')
  const usesTrailPrice = tradingOrderTypeUsesField(selectedOrderTypeDefinition, 'trailPrice')
  const usesTrailPercent = tradingOrderTypeUsesField(selectedOrderTypeDefinition, 'trailPercent')
  const defaultOrderType =
    defaultOrderTypeResolution?.ok === true ? defaultOrderTypeResolution.orderType : ''
  const orderTypePlaceholder = !listing
    ? copy.body.selectListingFirst
    : !resolvedAssetClass
      ? copy.body.assetClassUnavailable
      : !isListingSupported
        ? copy.body.listingUnsupported
        : copy.body.noSupportedTypes
  const orderTypeMessage =
    listing && !resolvedAssetClass
      ? copy.body.resolvedListingAssetClassRequired
      : listing && resolvedAssetClass && !isListingSupported
        ? copy.body.listingIsNotSupportedByThisProvider
        : requestedOrderTypeResolution?.ok === false &&
            requestedOrderTypeResolution.reason === 'no_supported_order_types'
          ? copy.body.noSupportedOrderTypesForThisListing
          : requestedOrderTypeResolution?.ok === false
            ? copy.body.selectedOrderTypeIsNotSupportedForThisListing
            : null
  const timeInForceOptions = useMemo(
    () => getTradingOrderTimeInForceOptions(providerId),
    [providerId]
  )
  const defaultTimeInForce = resolveTradingOrderTimeInForce(providerId)
  const marketProviderId = resolveQuickOrderMarketProviderId(quickOrderParams)
  const quoteItems = useMemo(
    () =>
      listing
        ? [
            {
              key: getListingIdentityKey(listing.listingIdentity),
              listing: listing.listingIdentity,
            },
          ]
        : [],
    [listing]
  )
  const quoteSnapshotsQuery = useMarketQuoteSnapshots({
    workspaceId: workspaceId ?? undefined,
    provider: marketProviderId || undefined,
    items: quoteItems,
    auth: quickOrderParams?.marketAuth,
    providerParams: quickOrderParams?.marketProviderParams,
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
    accountSnapshot?.baseCurrency ?? activePortfolioIdentity?.baseCurrency ?? 'USD'
  const cashBuyingPower =
    typeof accountSnapshot?.summary.buyingPower === 'number'
      ? accountSnapshot.summary.buyingPower
      : accountSnapshot?.summary.totalCashValue
  const estimatedReferencePrice = parsedLimitPrice ?? parsedStopPrice ?? marketPrice
  const estimatedOrderValue =
    selectedSizingMode === 'notional'
      ? parsedNotional
      : parsedQuantity && estimatedReferencePrice
        ? parsedQuantity * estimatedReferencePrice
        : undefined
  const validationMessage = getValidationMessage({
    providerId,
    accountId: activePortfolioIdentity?.accountId,
    listing,
    orderType,
    orderTypeDefinition: selectedOrderTypeDefinition,
    timeInForce,
    sizingMode: selectedSizingMode,
    sizingModeDefinition: selectedSizingModeDefinition,
    quantity,
    notional,
    limitPrice,
    stopPrice,
    trailPrice,
    trailPercent,
    orderTypeMessage,
    copy: copy.body,
    orderFieldLabels,
  })

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
    if (!submissionLockRef.current) {
      resetSubmitOrder()
    }
    updateListingSelector(listingInstanceId, {
      providerId,
      query: '',
      results: [],
      isLoading: false,
      error: undefined,
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
    if (!usesLimitPrice && limitPriceInput) setLimitPriceInput('')
    if (!usesStopPrice && stopPriceInput) setStopPriceInput('')
    if (!usesTrailPrice && trailPriceInput) setTrailPriceInput('')
    if (!usesTrailPercent && trailPercentInput) setTrailPercentInput('')
  }, [
    limitPriceInput,
    stopPriceInput,
    trailPercentInput,
    trailPriceInput,
    usesLimitPrice,
    usesStopPrice,
    usesTrailPercent,
    usesTrailPrice,
  ])

  useEffect(() => {
    if (!submissionLockRef.current) {
      resetSubmitOrder()
    }
  }, [
    limitPriceInput,
    listing,
    notionalInput,
    orderType,
    quickOrderParams?.portfolioIdentity,
    quantityInput,
    side,
    sizingMode,
    stopPriceInput,
    resetSubmitOrder,
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
    return <CenterState>{copy.body.failedToLoadTradingProviders}</CenterState>
  }

  if (providerOptions.length === 0) {
    return <CenterState>{copy.body.noOrderCapableTradingProvidersAvailable}</CenterState>
  }

  if (!providerId) {
    return <CenterState>{copy.body.selectTradingProviderToGetStarted}</CenterState>
  }

  if (!activePortfolioIdentity) {
    if (services.isLoading) {
      return (
        <div className={centerStateClassName}>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (!activeServiceId) {
      return <CenterState>{copy.body.selectBrokerConnectionToSubmitAnOrder}</CenterState>
    }

    if (accountsQuery.isLoading) {
      return (
        <div className={centerStateClassName}>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (accountsQuery.error) {
      return <CenterState>{copy.body.failedToLoadBrokerAccounts}</CenterState>
    }

    if (portfolioIdentities.length === 0) {
      return <CenterState>{copy.body.noBrokerAccountsFoundForThisProviderConnection}</CenterState>
    }

    return <CenterState>{copy.body.selectBrokerAccountToSubmitAnOrder}</CenterState>
  }

  const canSubmit = Boolean(workspaceId) && !validationMessage
  const acceptedResponse = submitOrder.data?.response
  const order = acceptedResponse?.order
  const submittedSide = submitOrder.variables?.request.side ?? side

  const handleSubmit = () => {
    if (
      submissionLockRef.current ||
      isPending ||
      validationMessage ||
      !providerId ||
      !workspaceId ||
      !activeServiceId ||
      !activePortfolioIdentity ||
      !listing
    ) {
      return
    }

    const payload: Omit<TradingOrderSubmitRequest, 'idempotencyKey'> = {
      workspaceId,
      portfolioIdentity: activePortfolioIdentity,
      listing,
      side,
      orderType,
      timeInForce,
    }

    if (selectedSizingMode === 'notional') {
      payload.orderSizingMode = 'notional'
      if (parsedNotional !== undefined) payload.notional = parsedNotional
    } else {
      if (selectedSizingMode) payload.orderSizingMode = selectedSizingMode
      if (parsedQuantity !== undefined) payload.quantity = parsedQuantity
    }

    if (usesLimitPrice && parsedLimitPrice) {
      payload.limitPrice = parsedLimitPrice
    }
    if (usesStopPrice && parsedStopPrice) {
      payload.stopPrice = parsedStopPrice
    }
    if (usesTrailPrice) {
      if (parsedTrailPrice) payload.trailPrice = parsedTrailPrice
    }
    if (usesTrailPercent) {
      if (parsedTrailPercent) payload.trailPercent = parsedTrailPercent
    }

    const fingerprint = stableStringifyJsonValue(payload)
    const idempotencyKey =
      orderAttemptIdempotencyRef.current?.fingerprint === fingerprint
        ? orderAttemptIdempotencyRef.current.key
        : `trading-order:manual:${crypto.randomUUID()}`
    orderAttemptIdempotencyRef.current = { fingerprint, key: idempotencyKey }

    submissionLockRef.current = true
    setIsSubmissionActive(true)
    submitOrder.mutate({
      request: {
        ...payload,
        idempotencyKey,
      },
      refetchPortfolio: accountSnapshotQuery.refetch,
    })
  }

  return (
    <form
      className='flex h-full min-h-0 flex-col bg-background'
      aria-busy={isPending || undefined}
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
            marketProviderId={marketProviderId || undefined}
            tradingProviderId={providerId || undefined}
            className='w-full'
            disabled={isPending}
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

          <OrderRow
            label={copy.body.marketPrice}
            value={formatCurrency(marketPrice, accountCurrency, locale)}
          />

          <FieldBlock>
            <Label htmlFor='quick-order-size'>
              {selectedSizingMode === 'notional' ? copy.body.notional : copy.body.quantity}
            </Label>
            <Input
              id='quick-order-size'
              className='h-9 font-mono'
              inputMode='decimal'
              value={selectedSizingMode === 'notional' ? notionalInput : quantityInput}
              placeholder={selectedSizingMode === 'notional' ? '0.00' : '0'}
              disabled={isPending}
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
            <Label htmlFor='quick-order-order-type'>{copy.body.orderType}</Label>
            <Select
              value={orderType || null}
              items={orderTypeDefinitions.map((definition) => ({
                value: definition.id,
                label: definition.label,
              }))}
              disabled={
                isPending ||
                !listing ||
                !resolvedAssetClass ||
                !isListingSupported ||
                orderTypeDefinitions.length === 0
              }
              onValueChange={(nextOrderType) => {
                if (nextOrderType !== null) setOrderType(nextOrderType)
              }}
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
              <Label>{formatTemplate(copy.body.chooseHowTo, { side: sideLabelLower })}</Label>
              <RadioGroup
                className='flex items-center gap-5'
                value={selectedSizingMode}
                disabled={isPending}
                onValueChange={(value) =>
                  setSizingMode(value === 'notional' ? 'notional' : 'quantity')
                }
              >
                {sizingOptions.map((option) => {
                  const id = `${listingInstanceId}-sizing-${option}`
                  const label =
                    sizingModeConfig.definitions.find((definition) => definition.id === option)
                      ?.label ?? option
                  return (
                    <div key={option} className='flex items-center gap-2'>
                      <RadioGroupItem id={id} value={option} />
                      <Label htmlFor={id} className='cursor-pointer text-muted-foreground text-sm'>
                        {label}
                      </Label>
                    </div>
                  )
                })}
              </RadioGroup>
            </FieldBlock>
          ) : null}

          <FieldBlock>
            <Label htmlFor='quick-order-time-in-force'>{copy.body.timeInForce}</Label>
            <Select
              value={timeInForce || null}
              items={timeInForceOptions.map((option) => ({
                value: option,
                label: option.toUpperCase(),
              }))}
              disabled={isPending}
              onValueChange={(nextTimeInForce) => {
                if (nextTimeInForce !== null) setTimeInForce(nextTimeInForce)
              }}
            >
              <SelectTrigger id='quick-order-time-in-force' className='h-9'>
                <SelectValue placeholder={copy.body.selectTimeInForce} />
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

          {usesLimitPrice ? (
            <FieldBlock>
              <Label htmlFor='quick-order-limit-price'>{copy.body.limitPrice}</Label>
              <Input
                id='quick-order-limit-price'
                className='h-9 font-mono'
                inputMode='decimal'
                value={limitPriceInput}
                placeholder='0.00'
                disabled={isPending}
                onChange={(event) => setLimitPriceInput(event.target.value)}
              />
            </FieldBlock>
          ) : null}

          {usesStopPrice ? (
            <FieldBlock>
              <Label htmlFor='quick-order-stop-price'>{copy.body.stopPrice}</Label>
              <Input
                id='quick-order-stop-price'
                className='h-9 font-mono'
                inputMode='decimal'
                value={stopPriceInput}
                placeholder='0.00'
                disabled={isPending}
                onChange={(event) => setStopPriceInput(event.target.value)}
              />
            </FieldBlock>
          ) : null}

          {usesTrailPrice || usesTrailPercent ? (
            <div className='grid grid-cols-2 gap-3'>
              <FieldBlock>
                <Label htmlFor='quick-order-trail-price'>{copy.body.trailPrice}</Label>
                <Input
                  id='quick-order-trail-price'
                  className='h-9 font-mono'
                  inputMode='decimal'
                  value={trailPriceInput}
                  disabled={isPending || Boolean(trailPercentInput)}
                  placeholder='0.00'
                  onChange={(event) => {
                    setTrailPriceInput(event.target.value)
                    if (event.target.value.trim()) setTrailPercentInput('')
                  }}
                />
              </FieldBlock>
              <FieldBlock>
                <Label htmlFor='quick-order-trail-percent'>{copy.body.trailPercent}</Label>
                <Input
                  id='quick-order-trail-percent'
                  className='h-9 font-mono'
                  inputMode='decimal'
                  value={trailPercentInput}
                  disabled={isPending || Boolean(trailPriceInput)}
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
              {copy.body.resolvedListingAssetClassRequired}
            </div>
          ) : null}
          {listing && resolvedAssetClass && !isListingSupported ? (
            <div className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300 text-xs'>
              {copy.body.listingIsNotSupportedByThisProvider}
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
        <div className='space-y-2 pb-3'>
          <OrderRow
            label={side === 'sell' ? copy.body.estimatedProceeds : copy.body.estimatedCost}
            value={formatCurrency(estimatedOrderValue, accountCurrency, locale)}
          />
          <OrderRow
            label={copy.body.cashBuyingPower}
            value={formatCurrency(cashBuyingPower, accountCurrency, locale)}
          />
        </div>
        {isPending ? (
          <div role='status' aria-atomic='true' className='mb-2 text-muted-foreground text-xs'>
            {copy.body.submitting}
          </div>
        ) : submitOrder.error ? (
          <div role='alert' aria-atomic='true' className='mb-2 text-destructive text-xs'>
            {submitOrder.error.message}
          </div>
        ) : acceptedResponse ? (
          <div role='status' aria-atomic='true' className='mb-2 text-xs'>
            <div className='space-y-0.5 text-muted-foreground'>
              <div className='text-foreground'>
                {order
                  ? `${order.id ? `${copy.body.orderPrefix} ${order.id}` : copy.body.orderSubmitted}${order.status ? ` · ${order.status}` : ''}`
                  : (acceptedResponse.message ?? copy.body.orderSubmitted)}
              </div>
              {acceptedResponse.provider || acceptedResponse.accountId ? (
                <div>
                  {[acceptedResponse.provider, acceptedResponse.accountId]
                    .filter(Boolean)
                    .join(' / ')}
                </div>
              ) : null}
              {order ? (
                <div>
                  {[order.symbol, submittedSide.toUpperCase(), order.submittedAt]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              ) : null}
              {order && acceptedResponse.message ? <div>{acceptedResponse.message}</div> : null}
            </div>
          </div>
        ) : null}
        {!isPending &&
        acceptedResponse &&
        (acceptedResponse.historyWarning || submitOrder.data?.convergenceFailed) ? (
          <div role='alert' aria-atomic='true' className='mb-2 text-amber-600 text-xs'>
            {[
              acceptedResponse.historyWarning,
              submitOrder.data?.convergenceFailed ? copy.body.orderAcceptedRefreshWarning : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </div>
        ) : null}
        <Button
          type='submit'
          className='h-10 w-full'
          disabled={!canSubmit || isPending}
          focusableWhenDisabled={isPending}
          aria-busy={isPending || undefined}
        >
          {isPending
            ? copy.body.submitting
            : formatTemplate(copy.body.submitOrder, { side: sideLabel })}
        </Button>
      </div>
    </form>
  )
}
