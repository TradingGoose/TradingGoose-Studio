export function requireDatabaseDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Database returned an invalid ${field}`)
  }

  return date
}

export function requireNullableDatabaseDate(value: unknown, field: string): Date | null {
  return value === null ? null : requireDatabaseDate(value, field)
}
