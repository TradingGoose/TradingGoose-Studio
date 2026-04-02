#!/usr/bin/env bun
/**
 * Resolve trigger outputs by directly importing trigger files.
 * This runs the actual TypeScript at build time to resolve function calls like buildMeetingOutputs().
 * Outputs a JSON map of triggerId → outputs.
 */
import fs from 'fs'
import path from 'path'

const TRIGGERS_DIR = path.resolve(import.meta.dir, '../../apps/tradinggoose/triggers')
const OUTPUT_FILE = path.resolve(import.meta.dir, 'resolved-trigger-outputs.json')

async function main() {
  const result: Record<string, Record<string, any>> = {}
  const dirs = fs.readdirSync(TRIGGERS_DIR).filter((d) => {
    const full = path.join(TRIGGERS_DIR, d)
    return fs.statSync(full).isDirectory() && !['blocks', 'core'].includes(d)
  })

  for (const dir of dirs) {
    const fullDir = path.join(TRIGGERS_DIR, dir)
    const tsFiles = fs.readdirSync(fullDir).filter(
      (f) => f.endsWith('.ts') && !f.startsWith('utils') && !f.startsWith('types') && !f.startsWith('index')
    )

    for (const file of tsFiles) {
      try {
        const mod = require(path.join(fullDir, file))
        const trigger = mod.default || Object.values(mod).find(
          (v: any) => v && typeof v === 'object' && 'id' in v && 'outputs' in v
        )
        if (trigger && trigger.id && trigger.outputs) {
          result[trigger.id] = serializeOutputs(trigger.outputs)
        }
      } catch {
        // Skip files that fail to import
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2))
  console.log(`  Resolved outputs for ${Object.keys(result).length} triggers → ${OUTPUT_FILE}`)
}

function serializeOutputs(outputs: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(outputs)) {
    if (typeof value === 'object' && value !== null) {
      const serialized: Record<string, any> = {}
      if (value.type) serialized.type = String(value.type)
      if (value.description) serialized.description = String(value.description)

      // Recurse for nested output fields
      for (const [k, v] of Object.entries(value)) {
        if (k !== 'type' && k !== 'description' && typeof v === 'object' && v !== null) {
          serialized[k] = serializeOutputs({ [k]: v })[k]
        }
      }

      result[key] = serialized
    }
  }
  return result
}

main().catch(console.error)
