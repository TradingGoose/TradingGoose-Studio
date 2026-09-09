import { describe, expect, it } from 'vitest'
import { normalizeIbkrTradingAccount } from '@/providers/trading/ibkr/accounts'

const context = {
  providerId: 'ibkr' as const,
  credentialId: 'cred-1',
  serviceId: 'ibkr-paper',
}

describe('normalizeIbkrTradingAccount', () => {
  it('normalizes a margin account', () => {
    const identity = normalizeIbkrTradingAccount(
      {
        id: 'DU123456',
        accountId: 'DU123456',
        accountTitle: 'Paper Trading Account',
        accountType: 'Margin',
        currency: 'USD',
        status: 'Active',
      },
      context
    )

    expect(identity).toMatchObject({
      providerId: 'ibkr',
      credentialId: 'cred-1',
      serviceId: 'ibkr-paper',
      accountId: 'DU123456',
      providerName: 'IBKR',
      accountName: 'Paper Trading Account',
      accountType: 'margin',
      baseCurrency: 'USD',
      accountStatus: 'active',
    })
  })

  it('normalizes a cash account', () => {
    const identity = normalizeIbkrTradingAccount(
      {
        id: 'U1234567',
        accountType: 'Cash',
        currency: 'eur',
      },
      context
    )

    expect(identity.accountType).toBe('cash')
    expect(identity.baseCurrency).toBe('EUR')
  })

  it('uses accountId when id is missing', () => {
    const identity = normalizeIbkrTradingAccount(
      {
        accountId: 'DU999',
        accountType: 'Individual',
      },
      context
    )

    expect(identity.accountId).toBe('DU999')
    expect(identity.accountType).toBe('margin')
  })

  it('maps unknown account types and statuses', () => {
    const identity = normalizeIbkrTradingAccount(
      {
        id: 'X1',
        accountType: 'SomethingElse',
        status: 'WeirdState',
      },
      context
    )

    expect(identity.accountType).toBe('unknown')
    expect(identity.accountStatus).toBe('unknown')
  })

  it('throws when no id is present', () => {
    expect(() => normalizeIbkrTradingAccount({ accountTitle: 'No Id' }, context)).toThrow(
      'missing account id'
    )
  })
})
