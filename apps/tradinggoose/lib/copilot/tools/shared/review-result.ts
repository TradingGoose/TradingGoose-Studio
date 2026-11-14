import { z } from 'zod'

/** A server token decision, never a client assertion or an applied draft projection. */
export function serverToolReviewRejectedSchema<const Name extends string>(toolName: Name) {
  return z
    .object({
      success: z.literal(false),
      rejected: z.literal(true),
      toolName: z.literal(toolName),
    })
    .strict()
}

export function withServerToolReviewRejection<const Name extends string, Schema extends z.ZodType>(
  toolName: Name,
  schema: Schema
) {
  return z.union([serverToolReviewRejectedSchema(toolName), schema])
}

export function isServerToolReviewRejectedResult(
  toolName: string,
  result: unknown
): result is { success: false; rejected: true; toolName: string } {
  return serverToolReviewRejectedSchema(toolName).safeParse(result).success
}
