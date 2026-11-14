import { PostgresStore } from '@mastra/pg'
import { db, user } from '@tradinggoose/db'
import { user as userSchema } from '@tradinggoose/db/schema'
import pg, { Client, DatabaseError, Pool } from 'pg'
import postgres, { PostgresError } from 'postgres'
import { expect, it } from 'vitest'

it('keeps unit tests disconnected while preserving actual schema exports', () => {
  expect(process.env.DATABASE_URL).toBe('')
  expect(user).toBe(userSchema)
  expect(db).toEqual({})
  expect(() => db.select()).toThrow(TypeError)
})

it.each([Pool, Client, pg.Pool, pg.Client])(
  'blocks an unmocked PostgreSQL constructor %s before connection defaults apply',
  (Constructor) => {
    expect(() => new Constructor()).toThrow('Database connections are disabled in unit tests')
  }
)

it('blocks an unmocked postgres.js client and preserves driver error types', () => {
  expect(() => postgres()).toThrow('Database connections are disabled in unit tests')
  expect(DatabaseError).toBeTypeOf('function')
  expect(PostgresError).toBeTypeOf('function')
})

it('blocks database constructors inside native Mastra storage', () => {
  expect(
    () =>
      new PostgresStore({
        id: 'test',
        connectionString: 'postgresql://studio@studio-test.invalid/test',
      })
  ).toThrow('Database connections are disabled in unit tests')
})
