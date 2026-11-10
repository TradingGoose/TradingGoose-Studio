import { monetary } from '@tradinggoose/billing/money'
import { z } from 'zod'

export const adminMoneySchema = z
  .string()
  .refine((value) => {
    try {
      monetary(value)
      return true
    } catch {
      return false
    }
  }, 'Expected a nonnegative finite decimal string within the PostgreSQL NUMERIC range')
  .transform(monetary)
