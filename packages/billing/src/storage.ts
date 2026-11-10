import { sql } from 'drizzle-orm'
import { FinancialPolicyError, type FinancialTransaction } from './index'

// Canonical application-owned PG17 definitions, verified through public catalog deparsing.
// Only presentation whitespace is normalized; predicate/column/operator changes refuse.
const expectedIndexes = {
  idempotency_billing_dispatch_due_idx: {
    unique: false,
    definition:
      "CREATE INDEX idempotency_billing_dispatch_due_idx ON public.idempotency_key USING btree (( CASE WHEN (((result ->> 'dispatchAtMs'::text) COLLATE \"C\") ~ '^[0-9]{1,15}$'::text) THEN ((result ->> 'dispatchAtMs'::text))::bigint ELSE (0)::bigint END), namespace, key) WHERE ((namespace ~~ 'billing-usage:%'::text) AND ((result ->> 'dispatchState'::text) = 'pending'::text))",
    predicate:
      "((namespace ~~ 'billing-usage:%'::text) AND ((result ->> 'dispatchState'::text) = 'pending'::text))",
  },
  idempotency_billing_member_registrations_idx: {
    unique: false,
    definition:
      "CREATE INDEX idempotency_billing_member_registrations_idx ON public.idempotency_key USING btree (namespace, key) WHERE ((namespace ~~ 'billing-usage:%'::text) AND ((result ->> 'recordType'::text) = 'member-registration'::text))",
    predicate:
      "((namespace ~~ 'billing-usage:%'::text) AND ((result ->> 'recordType'::text) = 'member-registration'::text))",
  },
  idempotency_billing_outstanding_idx: {
    unique: false,
    definition:
      "CREATE INDEX idempotency_billing_outstanding_idx ON public.idempotency_key USING btree (namespace, key) WHERE ((namespace ~~ 'billing-usage:%'::text) AND ((result ->> 'recordType'::text) = 'operation'::text) AND ((result ->> 'holdState'::text) = 'outstanding'::text))",
    predicate:
      "((namespace ~~ 'billing-usage:%'::text) AND ((result ->> 'recordType'::text) = 'operation'::text) AND ((result ->> 'holdState'::text) = 'outstanding'::text))",
  },
  idempotency_billing_target_blockers_idx: {
    unique: false,
    definition:
      "CREATE INDEX idempotency_billing_target_blockers_idx ON public.idempotency_key USING btree (namespace, key) WHERE ((namespace ~~ 'billing-usage:%'::text) AND (((result ->> 'financialClosureState'::text) IS DISTINCT FROM 'closed'::text) OR (((result ->> 'recordType'::text) = 'operation'::text) AND ((result ->> 'holdState'::text) = 'outstanding'::text)) OR ((result ->> 'dispatchState'::text) = 'pending'::text) OR ((result ->> 'invoiceObligationState'::text) = 'open'::text)))",
    predicate:
      "((namespace ~~ 'billing-usage:%'::text) AND (((result ->> 'financialClosureState'::text) IS DISTINCT FROM 'closed'::text) OR (((result ->> 'recordType'::text) = 'operation'::text) AND ((result ->> 'holdState'::text) = 'outstanding'::text)) OR ((result ->> 'dispatchState'::text) = 'pending'::text) OR ((result ->> 'invoiceObligationState'::text) = 'open'::text)))",
  },
  idempotency_key_namespace_unique: {
    unique: true,
    definition:
      'CREATE UNIQUE INDEX idempotency_key_namespace_unique ON public.idempotency_key USING btree (key, namespace)',
    predicate: null,
  },
} as const
const verifiedTransactions = new WeakMap<object, true>()
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim()

/** Read-only owner/consumer readiness; no DDL and no pool/global success cache. */
export async function assertFinancialStorageReady(tx: FinancialTransaction): Promise<void> {
  if (verifiedTransactions.has(tx)) return
  const rows = await tx.execute<{
    name: string
    valid: boolean
    unique: boolean
    definition: string
    predicate: string | null
  }>(sql`SELECT idx.relname AS name, (i.indisvalid AND i.indisready AND i.indislive) AS valid,
    i.indisunique AS unique, pg_get_indexdef(i.indexrelid) AS definition,
    pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'public' AND tbl.relname = 'idempotency_key'`)
  for (const [name, expected] of Object.entries(expectedIndexes)) {
    const actual = rows.find((row) => row.name === name)
    if (
      !actual ||
      !actual.valid ||
      actual.unique !== expected.unique ||
      normalized(actual.definition) !== expected.definition ||
      (actual.predicate === null ? null : normalized(actual.predicate)) !== expected.predicate
    )
      throw new FinancialPolicyError(
        `Required financial index is missing, invalid or inconsistent: ${name}`,
        503
      )
  }
  verifiedTransactions.set(tx, true)
}
