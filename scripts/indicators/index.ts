import { spawnSync } from 'node:child_process'
import { generateCopilotIndicatorReference } from './generate-copilot-reference'
import { generatePinetsSurfaceArtifacts } from './generate-pinets-surface'
import { OUTPUT_PATHS } from './shared'

const formatGeneratedArtifacts = () => {
  const result = spawnSync('bunx', ['biome', 'format', '--write', ...Object.values(OUTPUT_PATHS)], {
    stdio: 'inherit',
  })

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      `Formatting generated indicator artifacts failed with exit code ${result.status}`
    )
  }

  if (result.error) {
    throw result.error
  }
}

const main = async () => {
  generatePinetsSurfaceArtifacts()
  await generateCopilotIndicatorReference()
  formatGeneratedArtifacts()
}

await main()
