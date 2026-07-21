import { describe, expect, it } from 'vitest'
import {
  getListingIdentityKey,
  ListingIdentityPassthroughSchema,
  ListingIdentitySchema,
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
  const schemas = [
    ['strict', ListingIdentitySchema],
    ['passthrough', ListingIdentityPassthroughSchema],
  ] as const

  it('normalizes listing identities and builds canonical keys from one source', () => {
    const listing = toListingValueObject({
      listing_id: ' AAPL ',
      base_id: 'ignored',
      quote_id: 'ignored',
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
    expect(parseListingIdentityValueStrict({ ...listing, base: 'AAPL' })).toEqual(listing)
    expect(() => parseListingIdentityValueStrict('{"listing_type":"stock"}')).toThrow(
      'Invalid listingIdentity value'
    )
    expect(() => parseListingIdentityValueStrict('{invalid}')).toThrow(
      'Invalid listingIdentity value'
    )
  })

  it.each(schemas)('normalizes and validates %s listing identities', (_, schema) => {
    expect(
      schema.parse({ ...defaultListing, listing_id: ' AAPL ', base_id: ' ', quote_id: '\t' })
    ).toEqual(defaultListing)
    expect(
      schema.parse({ ...pairListing, listing_id: ' ', base_id: ' BTC ', quote_id: ' USD ' })
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
      expect(() => schema.parse(listing)).toThrow(message)
    }
  })

  it('allows display metadata only through the passthrough listing schema', () => {
    const resolved = { ...defaultListing, listing_id: ' AAPL ', name: ' Apple ' }

    expect(() => ListingIdentitySchema.parse(resolved)).toThrow()
    expect(ListingIdentityPassthroughSchema.parse(resolved)).toEqual({
      ...defaultListing,
      name: ' Apple ',
    })
  })
})
