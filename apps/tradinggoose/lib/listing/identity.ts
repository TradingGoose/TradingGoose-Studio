import { z } from 'zod'

const LISTING_TYPES = ['default', 'crypto', 'currency'] as const

export type ListingType = (typeof LISTING_TYPES)[number]

export const LISTING_IDENTITY_VALUE_TYPE = 'listingIdentity' as const

export const LISTING_IDENTITY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    listing_id: {
      type: 'string',
      description: 'Listing id for default listings; otherwise empty.',
    },
    base_id: { type: 'string', description: 'Base asset id for pair listings; otherwise empty.' },
    quote_id: { type: 'string', description: 'Quote asset id for pair listings; otherwise empty.' },
    listing_type: {
      type: 'string',
      enum: LISTING_TYPES,
      description: 'Listing type.',
    },
  },
  required: ['listing_id', 'base_id', 'quote_id', 'listing_type'],
  additionalProperties: false,
}

export const ListingIdentitySchema = z
  .object({
    listing_id: z.string().trim(),
    base_id: z.string().trim(),
    quote_id: z.string().trim(),
    listing_type: z.enum(LISTING_TYPES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.listing_type === 'default') {
      if (!value.listing_id || value.base_id || value.quote_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Default listing identities require listing_id and empty base_id/quote_id',
        })
      }
      return
    }

    if (value.listing_id || !value.base_id || !value.quote_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pair listing identities require base_id/quote_id and empty listing_id',
      })
    }
  })

export type ListingIdentity = z.infer<typeof ListingIdentitySchema>

const OptionalListingDetailSchema = z.string().trim().nullable().optional()

export const ListingResolvedSchema = z
  .object({
    listingIdentity: ListingIdentitySchema,
    base: z.string().trim().min(1),
    quote: OptionalListingDetailSchema,
    name: OptionalListingDetailSchema,
    iconUrl: OptionalListingDetailSchema,
    assetClass: OptionalListingDetailSchema,
    primaryMicCode: OptionalListingDetailSchema,
    marketCode: OptionalListingDetailSchema,
    countryCode: OptionalListingDetailSchema,
    cityName: OptionalListingDetailSchema,
    timeZoneName: OptionalListingDetailSchema,
    base_asset_class: OptionalListingDetailSchema,
    quote_asset_class: OptionalListingDetailSchema,
  })
  .strict()

export type ListingResolved = z.infer<typeof ListingResolvedSchema>

export type ListingInputValue = ListingIdentity | ListingResolved | string | null | undefined

export const getListingIdentitySymbol = (listing: ListingIdentity) =>
  listing.listing_type === 'default' ? listing.listing_id : `${listing.base_id}/${listing.quote_id}`

export const toListingValueObject = (value: unknown): ListingIdentity | null => {
  const resolved = ListingResolvedSchema.safeParse(value)
  if (resolved.success) return resolved.data.listingIdentity

  const identity = ListingIdentitySchema.safeParse(value)
  return identity.success ? identity.data : null
}

export const areListingIdentitiesEqual = (
  left?: ListingIdentity | null,
  right?: ListingIdentity | null
) => {
  if (!left || !right) return false
  return (
    left.listing_type === right.listing_type &&
    left.listing_id === right.listing_id &&
    left.base_id === right.base_id &&
    left.quote_id === right.quote_id
  )
}

export const getListingIdentityKey = (listing: ListingIdentity) =>
  `${listing.listing_type}|${listing.listing_id}|${listing.base_id}|${listing.quote_id}`

export const parseListingIdentityValueStrict = (value: unknown): ListingIdentity => {
  let parsedValue = value
  if (typeof value === 'string' && value.trim()) {
    try {
      parsedValue = JSON.parse(value.trim())
    } catch {
      throw new Error('Invalid listingIdentity value')
    }
  }

  const listing = ListingIdentitySchema.safeParse(parsedValue)
  if (!listing.success) throw new Error('Invalid listingIdentity value')
  return listing.data
}
