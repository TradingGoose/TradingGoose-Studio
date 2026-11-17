#!/usr/bin/env bun

import postgres from 'postgres'

// Explicit one-off data migration, following this directory's standalone script pattern.
// Collision handling adapts PostgreSQL's documented unique_violation retry example:
// https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const sql = postgres(databaseUrl, { max: 1, prepare: false })

try {
  await sql`
    DO $$
    DECLARE
      target record;
      candidate text;
      conflict_constraint text;
      attempts integer;
    BEGIN
      FOR target IN SELECT id FROM "user" WHERE username IS NULL ORDER BY id LOOP
        attempts := 0;
        LOOP
          attempts := attempts + 1;
          candidate := substring(gen_random_uuid()::text, 1, 6);
          BEGIN
            UPDATE "user"
            SET username = candidate, display_username = upper(candidate)
            WHERE id = target.id AND username IS NULL;
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS conflict_constraint = CONSTRAINT_NAME;
            IF conflict_constraint IS DISTINCT FROM 'user_username_unique' OR attempts >= 100 THEN
              RAISE;
            END IF;
          END;
        END LOOP;
      END LOOP;
    END $$;
  `
  console.log('Assigned usernames to existing users without one.')
} finally {
  await sql.end({ timeout: 5 })
}
