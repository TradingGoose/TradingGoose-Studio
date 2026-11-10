import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  assertNativeCorrelation,
  COPILOT_NATIVE_REVISION,
  isNativeContractDefinition,
  parseNativeContract,
} from './contract'
import fixtures from './contract/fixtures.json'
import provenance from './contract/provenance.json'

describe('accepted canonical native contract', () => {
  it('preserves the exact accepted protocol, schema and fixture bytes', async () => {
    for (const entry of provenance.files) {
      const bytes = await readFile(new URL(`./contract/${entry.path}`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex'), entry.path).toBe(entry.sha256)
    }
  })
  it('binds flattened canonical assets to their original owner paths and sealed manifest', async () => {
    const sourceManifest: {
      protocolRevision: string
      billingTarSha256: string
      files: Array<{ path: string; sha256: string }>
    } = JSON.parse(
      await readFile(new URL('./contract/source-manifest.txt', import.meta.url), 'utf8')
    )
    const sourceChecksums: { entries: Array<{ path: string; sha256: string }> } = JSON.parse(
      await readFile(new URL('./contract/source-checksums.txt', import.meta.url), 'utf8')
    )
    expect(sourceManifest.protocolRevision).toBe(COPILOT_NATIVE_REVISION)
    expect(sourceManifest.billingTarSha256).toBe(provenance.selectedFinancialPackage.tarballSha256)
    expect(new Set(provenance.files.map((entry) => entry.path)).size).toBe(provenance.files.length)
    for (const entry of provenance.files) {
      if (entry.sourcePath === 'SHA256SUMS.json') continue
      const sealed = sourceChecksums.entries.find((owner) => owner.path === entry.sourcePath)
      expect(sealed?.sha256, entry.sourcePath).toBe(entry.sha256)
      if (entry.sourcePath.startsWith('src/')) {
        const original = sourceManifest.files.find((owner) => owner.path === entry.sourcePath)
        expect(original?.sha256, entry.sourcePath).toBe(entry.sha256)
      }
    }
  })
  for (const fixture of fixtures.fixtures) {
    const accepted =
      fixture.schemaValid && fixture.moneyValid !== false && fixture.mediaValid !== false
    it(`${fixture.id}: canonical syntax and required semantics ${accepted ? 'accept' : 'refuse'}`, async () => {
      const name = fixture.schema
      if (!isNativeContractDefinition(name)) throw new Error(`Unknown fixture definition ${name}`)
      const operation = parseNativeContract(name, fixture.value)
      if (accepted) await expect(operation).resolves.toEqual(fixture.value)
      else await expect(operation).rejects.toThrow('Invalid native')
    })
  }
  it('preserves arbitrary nested business money/image-shaped fields outside native semantic slots', async () => {
    const business = {
      financial: { accepted: true, appliedUsd: 0.02 },
      image: { type: 'image', image: 'ordinary-business-reference', mediaType: 'not-native-media' },
      error: { type: 'error', message: ' exact business content\t\n' },
    }
    await expect(parseNativeContract('Json', business)).resolves.toEqual(business)
  })
  it('correlates every response with its captured revision and request', () => {
    expect(() =>
      assertNativeCorrelation(
        { protocolRevision: COPILOT_NATIVE_REVISION, requestId: 'first' },
        'first'
      )
    ).not.toThrow()
    for (const value of [
      { protocolRevision: 'unreviewed', requestId: 'first' },
      { protocolRevision: COPILOT_NATIVE_REVISION, requestId: 'other' },
    ]) {
      expect(() => assertNativeCorrelation(value, 'first')).toThrow('does not match')
    }
  })
  it('does not treat inherited names as canonical definitions', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(isNativeContractDefinition(name)).toBe(false)
    }
  })
})
