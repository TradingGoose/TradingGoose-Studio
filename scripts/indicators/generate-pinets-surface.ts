import {
  buildPinetsSurface,
  OUTPUT_PATHS,
  renderConstExport,
  renderModule,
  writeGeneratedFile,
} from './shared'

const GENERATED_BY = 'scripts/indicators/generate-pinets-surface.ts'

export const generatePinetsSurfaceArtifacts = () => {
  const surface = buildPinetsSurface()

  const pinetsSurfaceContent = renderModule({
    generatedBy: GENERATED_BY,
    statements: [renderConstExport('PINETS_SURFACE', surface)],
  })

  const outputs = [[OUTPUT_PATHS.pinetsSurface, pinetsSurfaceContent]] as const

  const changed = outputs
    .map(([filePath, content]) => ({
      filePath,
      changed: writeGeneratedFile(filePath, content),
    }))
    .filter((entry) => entry.changed)

  changed.forEach((entry) => {
    console.log(`Wrote ${entry.filePath}`)
  })

  if (changed.length === 0) {
    console.log('Indicator Pinets surface artifacts are up to date.')
  }
}

if (import.meta.main) {
  generatePinetsSurfaceArtifacts()
}
