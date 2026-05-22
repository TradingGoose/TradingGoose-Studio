import { describe, expect, it } from 'vitest'
import {
  getListingIdentityKey,
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
})
