export type NumericValue = number | string

/**
 * Prisma Decimal is serialized as a string by some endpoints. Convert it once
 * at the API boundary so views never depend on JavaScript's implicit coercion.
 */
export function toFiniteNumber(value: NumericValue, field: string): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError(`${field} must be a finite number`)
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') {
    throw new TypeError(`${field} must be a finite number`)
  }
  const number = typeof normalized === 'number' ? normalized : Number(normalized)
  if (!Number.isFinite(number)) {
    throw new TypeError(`${field} must be a finite number`)
  }
  return number
}

export function toOptionalFiniteNumber(
  value: NumericValue | null | undefined,
  field: string,
): number | null | undefined {
  if (value == null) return value
  return toFiniteNumber(value, field)
}
