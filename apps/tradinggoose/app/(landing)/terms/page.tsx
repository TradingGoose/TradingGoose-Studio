'use client'

import Link from 'next/link'
import { useBrandConfig } from '@/lib/branding/branding'
import { LegalLayout } from '@/app/(landing)/components'

export default function TermsOfService() {
  const brand = useBrandConfig()
  const projectName = brand.name
  const supportEmail = brand.supportEmail
  const supportEmailHref = `mailto:${supportEmail}`

  return (
    <LegalLayout title='Terms of Service' path='/terms'>
      <div className='prose prose-gray mx-auto prose-h2:mt-12 prose-h3:mt-8 prose-h2:mb-6 prose-h3:mb-4 space-y-8 rounded-2xl border border-border bg-muted/50 p-12 text-accent-foreground'>
        <section>
          <p className='mb-4'>Last Updated: March 28, 2026</p>
          <p>
            These Terms of Service govern your access to and use of the {projectName} website, app,
            APIs, and any project-operated hosted services (collectively, the "Service").
          </p>
          <p className='mt-4'>
            If you are using a self-hosted deployment or a deployment operated by someone other than
            the TradingGoose project owner, that operator is responsible for its own service terms,
            privacy disclosures, security practices, billing, and compliance.
          </p>
          <p className='mt-4'>
            By accessing or using the Service, you agree to these Terms. If you do not agree, do not
            use the Service.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>1. Open-Source License</h2>
          <p className='mb-4'>
            {projectName} source code is made available separately under the project's AGPL-3.0-only
            license and applicable third-party licenses. These Terms govern the project-operated
            website and hosted Service and do not replace or reduce rights granted to you under the
            source-code license.
          </p>
          <p>
            License and attribution details are available in the repository and on the{' '}
            <Link href='/licenses' className='text-primary underline hover:text-primary-hover'>
              Licenses & Notices
            </Link>{' '}
            page.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>2. Eligibility, Accounts, and Access</h2>
          <p className='mb-4'>
            You may need an account to use some parts of the Service. You must provide accurate
            information, keep your credentials secure, and are responsible for activity that occurs
            through your account.
          </p>
          <p className='mb-4'>
            You are responsible for maintaining the confidentiality of login credentials, API keys,
            OAuth connections, broker credentials, and any other access methods linked to your
            account or workflows.
          </p>
          <p>
            We may suspend or restrict access if we reasonably believe an account is being used in a
            way that violates these Terms, threatens security, or creates legal or operational risk.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>3. Acceptable Use</h2>
          <p className='mb-4'>You may not use the Service to:</p>
          <ul className='mb-4 list-disc space-y-2 pl-6'>
            <li>Break the law or violate the rights of others.</li>
            <li>
              Upload, transmit, or automate unlawful, infringing, abusive, or malicious content.
            </li>
            <li>
              Attempt unauthorized access, interfere with the Service, or disrupt other users.
            </li>
            <li>Use the Service to distribute malware, spam, or fraudulent activity.</li>
            <li>
              Misuse connected accounts, OAuth credentials, broker accounts, or third-party APIs
              that you do not control or are not authorized to use.
            </li>
            <li>
              Use the Service in a way that would require regulatory registrations, disclosures, or
              permissions that you do not have.
            </li>
          </ul>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>
            4. Your Content, Workflows, and Integrations
          </h2>
          <p className='mb-4'>
            You retain ownership of content, files, prompts, workflow definitions, indicator
            scripts, credentials, and other data you submit or connect through the Service ("Your
            Content").
          </p>
          <p className='mb-4'>
            You grant us a limited license to host, process, store, transmit, and display Your
            Content only as needed to operate, secure, support, and improve the Service.
          </p>
          <p>
            You are responsible for making sure you have the rights and permissions needed to use
            Your Content and any third-party services, market data sources, broker accounts, or APIs
            you connect.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>
            5. Third-Party Services and Connected Accounts
          </h2>
          <p className='mb-4'>
            The Service may interoperate with third-party services, including model providers,
            storage providers, communication services, identity providers, analytics services,
            payment processors, market-data services, and broker platforms.
          </p>
          <p className='mb-4'>
            Your use of those third-party services remains subject to their own terms, privacy
            notices, fees, technical limits, and availability.
          </p>
          <p>
            We are not responsible for outages, errors, pricing changes, API changes, account
            restrictions, execution failures, or other actions taken by third-party services.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>6. Paid Features and Billing</h2>
          <p className='mb-4'>
            Some deployments may offer paid plans, usage-based billing, or subscription features. If
            you purchase paid access, you agree to pay applicable fees, taxes, and charges described
            at the time of purchase.
          </p>
          <p className='mb-4'>
            Billing may be handled by third-party payment processors such as Stripe. We do not store
            full payment card details ourselves.
          </p>
          <p>
            Failure to pay may result in suspension or downgrade of paid features. Pricing and plan
            terms may change prospectively.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>
            7. Analytics, Research, and Automation Only
          </h2>
          <p className='mb-4'>
            {projectName} is provided as software for analytics, research, charting, monitoring,
            workflow automation, and related technical operations. It is not a broker-dealer,
            exchange, investment adviser, fiduciary, or execution venue.
          </p>
          <p className='mb-4'>
            The Service does not provide financial, investment, legal, accounting, or tax advice.
            Any outputs, charts, alerts, scripts, model responses, workflow results, or automations
            are informational tools only.
          </p>
          <p>
            You are solely responsible for evaluating information, reviewing outputs, managing risk,
            determining suitability, and deciding whether to place trades, submit orders, or take
            any other action based on the Service.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>
            8. Trading Actions, Broker Integrations, and Market Data
          </h2>
          <p className='mb-4'>
            Some deployments may enable workflows or tools that interact with third-party brokers,
            exchanges, prediction markets, or market-data providers. Any such trading action is
            initiated at your direction and carried out, if at all, by the relevant third-party
            provider.
          </p>
          <p className='mb-4'>
            We are not responsible for trades, orders, cancellations, fills, partial fills, rejected
            orders, delayed execution, stale prices, incorrect symbols, model mistakes, workflow
            logic errors, unavailable APIs, market-data inaccuracies, or losses of any kind arising
            from actions taken through or based on the Service.
          </p>
          <p>
            You are responsible for configuring safeguards, testing workflows, supervising automated
            behavior, and confirming that any connected trading activity complies with applicable
            law and the third-party provider's rules.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>
            9. Availability, Experimental Features, and Changes
          </h2>
          <p className='mb-4'>
            The Service may change over time. We may add, modify, suspend, or remove features at any
            time, including integrations, hosted capabilities, and experimental features.
          </p>
          <p className='mb-4'>
            Some capabilities may be marked experimental, beta, preview, or otherwise incomplete.
            You use those features at your own risk.
          </p>
          <p>
            We may suspend or terminate access to the project-operated Service if you violate these
            Terms, create security or legal risk, or misuse the Service. You may stop using the
            Service at any time.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>10. Intellectual Property and Branding</h2>
          <p className='mb-4'>
            The Service includes open-source code, third-party components, and project-owned
            branding and content. Open-source and third-party materials remain subject to their
            respective licenses.
          </p>
          <p>
            Unless a license expressly allows otherwise, the {projectName} name, logos, and brand
            assets may not be used in a way that implies endorsement, affiliation, or source without
            permission.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>11. Disclaimers</h2>
          <p>
            The Service is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any
            kind to the fullest extent permitted by law. We do not warrant uninterrupted operation,
            accuracy, profitability, availability of integrations, suitability for a particular
            strategy, or that the Service will prevent losses or errors.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>12. Limitation of Liability</h2>
          <p className='mb-4'>
            To the fullest extent permitted by law, we are not liable for indirect, incidental,
            special, consequential, exemplary, or punitive damages, or for loss of profits, revenue,
            trading losses, brokerage losses, goodwill, data, or business interruption arising from
            or related to the Service.
          </p>
          <p>
            If liability cannot be excluded, it is limited to the amount you paid us for the
            project-operated Service during the 12 months before the claim arose.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>13. Indemnity</h2>
          <p>
            To the extent permitted by law, you will be responsible for claims, losses, and costs
            arising from your misuse of the Service, your connected accounts, your content, your
            workflows, or your violation of these Terms or applicable law.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>14. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. When we do, we will update the "Last
            Updated" date on this page. Your continued use of the project-operated Service after an
            update becomes effective means you accept the revised Terms.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>15. Contact and Copyright Notices</h2>
          <p className='mb-4'>
            If you have questions about these Terms, or if you believe material available through a
            project-operated Service infringes your rights, contact us at{' '}
            <Link
              href={supportEmailHref}
              className='text-primary underline hover:text-primary-hover'
            >
              {supportEmail}
            </Link>
            .
          </p>
          <p>
            Please include enough detail for us to understand and review your request. We do not
            currently publish a separate mailing address for legal notices on this page.
          </p>
        </section>
      </div>
    </LegalLayout>
  )
}
