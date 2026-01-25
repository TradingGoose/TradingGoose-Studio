/**
 * Generates mock data based on the output type definition
 */
function generateMockValue(type: string, _description?: string, fieldName?: string): unknown {
  const name = fieldName || 'value'

  switch (type) {
    case 'string':
      return `mock_${name}`
    case 'number':
      return 42
    case 'boolean':
      return true
    case 'array':
      return [
        {
          id: 'item_1',
          name: 'Sample Item',
          value: 'Sample Value',
        },
      ]
    case 'json':
    case 'object':
      return {
        id: 'sample_id',
        name: 'Sample Object',
        status: 'active',
      }
    default:
      return null
  }
}

/**
 * Recursively processes nested output structures
 */
function processOutputField(key: string, field: unknown, depth = 0, maxDepth = 10): unknown {
  if (depth > maxDepth) {
    return null
  }

  if (field && typeof field === 'object' && 'type' in field) {
    const typedField = field as { type: string; description?: string }
    return generateMockValue(typedField.type, typedField.description, key)
  }

  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const nestedObject: Record<string, unknown> = {}
    for (const [nestedKey, nestedField] of Object.entries(field)) {
      nestedObject[nestedKey] = processOutputField(nestedKey, nestedField, depth + 1, maxDepth)
    }
    return nestedObject
  }

  return null
}

/**
 * Generates mock payload from outputs object
 */
function generateMockPayloadFromOutputs(outputs: Record<string, unknown>): Record<string, unknown> {
  const mockPayload: Record<string, unknown> = {}

  for (const [key, output] of Object.entries(outputs)) {
    if (key === 'visualization') {
      continue
    }
    mockPayload[key] = processOutputField(key, output)
  }

  return mockPayload
}

/**
 * Generates a mock payload based on outputs definition
 */
export function generateMockPayloadFromOutputsDefinition(
  outputs: Record<string, unknown>
): Record<string, unknown> {
  return generateMockPayloadFromOutputs(outputs)
}
