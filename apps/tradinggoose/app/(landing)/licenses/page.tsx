import { LegalLayout } from '@/app/(landing)/components'

export default function LicensesPage() {
  return (
    <LegalLayout title='Licenses & Notices' path='/licenses'>
      <div className='prose prose-gray mx-auto prose-h2:mt-12 prose-h3:mt-8 prose-h2:mb-6 prose-h3:mb-4 space-y-8 rounded-2xl border border-border bg-muted/50 p-12 text-accent-foreground'>
        <section>
          <p className='mb-4'>Last Updated: March 28, 2026</p>
          <p>
            TradingGoose Studio is released as an AGPL-3.0-only combined project. This page
            summarizes the third-party code and notices that travel with the distribution.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>Project License</h2>
          <p className='mb-4'>
            The repository-level license for the combined project is AGPL-3.0-only. The root{' '}
            <code>NOTICE</code> file preserves the TradingGoose Studio attribution required by the upstream
            Apache-2.0 source on which this project is based.
          </p>
          <p className='mb-4'>
            The reason the combined project is AGPL-3.0-only is PineTS integration. TradingGoose
            Studio uses PineTS directly for indicator execution, verification, monitoring, and the
            landing-page market preview. Rather than use a separate commercial PineTS license, this
            repository keeps the combined application fully free and open under AGPL terms.
          </p>
          <p>
            The full third-party license bundle lives in the root <code>THIRD-PARTY-LICENSES</code>{' '}
            file, the preserved Apache-2.0 text lives in <code>LICENSES/Apache-2.0.txt</code>, and
            the vendored chart drawing tools keep their own MPL-2.0 license in{' '}
            <code>apps/tradinggoose/widgets/widgets/data_chart/plugins/LICENSE</code>.
          </p>
          <p className='mb-4'>
            That MPL-covered plugin directory remains MPL-2.0-covered at the file level. The
            project's overall AGPL-3.0-only distribution does not replace or remove the MPL-2.0
            terms that continue to apply to those vendored modified source files.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>Why AGPL-3.0-only</h2>
          <p className='mb-4'>
            TradingGoose Studio, the upstream base project, is Apache-2.0 and its required notices remain
            preserved here. The AGPL status of TradingGoose Studio comes from PineTS, which is used
            as an integrated runtime dependency under AGPL terms in this project.
          </p>
          <p>
            This project intentionally stays on the free-software path. The goal is for users to be
            able to use the project freely, inspect how it works, modify it, self-host it, and share
            improvements under the same terms instead of moving the PineTS-dependent portions behind
            a separate proprietary license.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>Third-Party Components</h2>
          <ul className='mb-4 list-disc space-y-2 pl-6'>
            <li>
              <strong>Sim Studio</strong> - upstream Apache-2.0 project this repository derives
              from. Source:{' '}
              <a
                href='https://github.com/simstudioai/sim/releases/tag/v0.4.25'
                target='_blank'
                rel='noopener noreferrer'
              >
                simstudioai/sim v0.4.25 release
              </a>
              .
            </li>
            <li>
              <strong>TradingView Lightweight Charts</strong> - Apache-2.0 package dependency used
              for chart rendering. Source:{' '}
              <a
                href='https://github.com/tradingview/lightweight-charts'
                target='_blank'
                rel='noopener noreferrer'
              >
                tradingview/lightweight-charts
              </a>
              .
            </li>
            <li>
              <strong>PineTS</strong> - AGPL-3.0-only package dependency used for indicator
              execution. Upstream also offers a commercial license option. Source:{' '}
              <a
                href='https://github.com/QuantForgeOrg/PineTS'
                target='_blank'
                rel='noopener noreferrer'
              >
                QuantForgeOrg/PineTS
              </a>
              .
            </li>
            <li>
              <strong>lightweight-charts-line-tools-core</strong> - MPL-2.0 vendored source in
              <code>apps/tradinggoose/widgets/widgets/data_chart/plugins/</code>.
            </li>
          </ul>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>Source Availability</h2>
          <p className='mb-4'>
            PineTS is used here as an integrated AGPL-3.0-only dependency. As a result, the combined
            TradingGoose Studio distribution is offered under AGPL-3.0-only, and AGPL-3.0 Section 13
            requires offering corresponding source to network users of the deployed application.
          </p>
          <p className='mb-4'>
            Corresponding source for this project is available at{' '}
            <a
              href='https://github.com/TradingGoose/TradingGoose-Studio'
              target='_blank'
              rel='noopener noreferrer'
            >
              github.com/TradingGoose/TradingGoose-Studio
            </a>
            .
          </p>
          <p>
            For the exact legal texts, read the root <code>LICENSE</code>, <code>NOTICE</code>, and{' '}
            <code>THIRD-PARTY-LICENSES</code> files in the repository.
          </p>
        </section>
      </div>
    </LegalLayout>
  )
}
