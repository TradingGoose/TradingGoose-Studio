import { describe, expect, it } from 'vitest'
import {
  getListingIdentityKey,
  ListingIdentitySchema,
  ListingResolvedSchema,
  parseListingIdentityValueStrict,
  toListingValueObject,
} from '@/lib/listing/identity'

describe('listing identity helpers', () => {
  const defaultListing = {
    listing_id: 'AAPL',
    base_id: '',
    quote_id: '',
    listing_type: 'default' as const,
  }
  const pairListing = {
    listing_id: '',
    base_id: 'BTC',
    quote_id: 'USD',
    listing_type: 'crypto' as const,
  }

  it('parses listing identities and builds canonical keys from one source', () => {
    const listing = toListingValueObject({
      listing_id: ' AAPL ',
      base_id: ' ',
      quote_id: '\t',
      listing_type: 'default',
    })

    expect(listing).toEqual({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
    expect(listing ? getListingIdentityKey(listing) : null).toBe('default|AAPL||')

    expect(parseListingIdentityValueStrict(JSON.stringify(listing))).toEqual(listing)
    expect(() => parseListingIdentityValueStrict({ ...listing, base: 'AAPL' })).toThrow(
      'Invalid listingIdentity value'
    )
    expect(() => parseListingIdentityValueStrict('{"listing_type":"stock"}')).toThrow(
      'Invalid listingIdentity value'
    )
    expect(() => parseListingIdentityValueStrict('{invalid}')).toThrow(
      'Invalid listingIdentity value'
    )
  })

  it('normalizes and validates listing identities', () => {
    expect(
      ListingIdentitySchema.parse({
        ...defaultListing,
        listing_id: ' AAPL ',
        base_id: ' ',
        quote_id: '\t',
      })
    ).toEqual(defaultListing)
    expect(
      ListingIdentitySchema.parse({
        ...pairListing,
        listing_id: ' ',
        base_id: ' BTC ',
        quote_id: ' USD ',
      })
    ).toEqual(pairListing)

    for (const [listing, message] of [
      [{ ...defaultListing, listing_id: '   ' }, 'Default listing identities require listing_id'],
      [{ ...pairListing, base_id: '   ' }, 'Pair listing identities require base_id/quote_id'],
      [{ ...pairListing, quote_id: '   ' }, 'Pair listing identities require base_id/quote_id'],
      [
        { ...pairListing, listing_id: ' BTCUSD ' },
        'Pair listing identities require base_id/quote_id',
      ],
    ] as const) {
      expect(() => ListingIdentitySchema.parse(listing)).toThrow(message)
    }
  })

  it('rejects identity objects with display metadata', () => {
    expect(toListingValueObject({ ...defaultListing, name: 'Apple' })).toBeNull()
    expect(() => ListingIdentitySchema.parse({ ...defaultListing, name: 'Apple' })).toThrow()
  })

  it('extracts canonical identity from the nested resolved listing aggregate', () => {
    expect(
      toListingValueObject({
        listingIdentity: defaultListing,
        base: 'AAPL',
        name: 'Apple Inc.',
      })
    ).toEqual(defaultListing)

    expect(
      toListingValueObject({
        listingIdentity: defaultListing,
        listing_id: 'AAPL',
        base: 'AAPL',
      })
    ).toBeNull()

    expect(
      toListingValueObject({
        listingIdentity: defaultListing,
        base: 'AAPL',
        providerMetadata: 'unsupported',
      })
    ).toBeNull()
  })

  it.each([
    'base',
    'quote',
    'name',
    'iconUrl',
    'assetClass',
    'primaryMicCode',
    'marketCode',
    'countryCode',
    'cityName',
    'timeZoneName',
    'base_asset_class',
    'quote_asset_class',
  ] as const)('rejects a non-string resolved listing %s field', (field) => {
    expect(() =>
      ListingResolvedSchema.parse({
        listingIdentity: defaultListing,
        base: 'AAPL',
        [field]: 42,
      })
    ).toThrow()
  })

  it('accepts nullable and omitted optional resolved listing fields', () => {
    expect(
      ListingResolvedSchema.parse({
        listingIdentity: defaultListing,
        base: ' AAPL ',
        name: null,
      })
    ).toEqual({
      listingIdentity: defaultListing,
      base: 'AAPL',
      name: null,
    })
  })
})
