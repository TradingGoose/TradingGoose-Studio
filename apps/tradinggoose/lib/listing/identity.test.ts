import { describe, expect, it } from 'vitest'
import {
  getListingIdentityKey,
  ListingIdentityPassthroughSchema,
  ListingIdentitySchema,
  parseListingIdentityValueStrict,
  toListingValueObject,
} from '@/lib/listing/identity'

describe('listing identity helpers', () => {
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

  it('enforces strict listing identity documents', () => {
    expect(
      ListingIdentitySchema.parse({
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      })
    ).toEqual({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })

    expect(() =>
      ListingIdentitySchema.parse({
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
        name: 'Apple',
      })
    ).toThrow()
    expect(() =>
      ListingIdentitySchema.parse({
        listing_id: '',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      })
    ).toThrow('Default listing identities require listing_id')
    expect(() =>
      ListingIdentitySchema.parse({
        listing_id: 'BTCUSD',
        base_id: 'BTC',
        quote_id: 'USD',
        listing_type: 'crypto',
      })
    ).toThrow('Pair listing identities require base_id/quote_id')
  })

  it('allows display metadata only through the passthrough listing schema', () => {
    expect(
      ListingIdentityPassthroughSchema.parse({
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
        name: 'Apple',
      })
    ).toEqual({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
      name: 'Apple',
    })

    expect(() =>
      ListingIdentityPassthroughSchema.parse({
        listing_id: '',
        base_id: 'BTC',
        quote_id: '',
        listing_type: 'crypto',
        base: 'BTC',
      })
    ).toThrow('Pair listing identities require base_id/quote_id')
  })
})
