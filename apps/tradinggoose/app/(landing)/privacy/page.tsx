import type { Metadata } from 'next'
import Link from 'next/link'
import LegalLayout from '@/app/(landing)/components/legal-layout'
import { getBrandConfig } from '@/lib/branding/branding'

export const metadata: Metadata = {
  title: 'Privacy Policy | TradingGoose',
  description:
    'Privacy Policy for TradingGoose Studio, covering account data, workflows, connected services, analytics, billing, and retention practices.',
  alternates: {
    canonical: '/privacy',
  },
}

export default function PrivacyPolicy() {
  const brand = getBrandConfig()
  const projectName = brand.name
  const supportEmail = brand.supportEmail
  const supportEmailHref = `mailto:${supportEmail}`

  return (
    <LegalLayout title='Privacy Policy' path='/privacy'>
      <div className='prose prose-gray mx-auto prose-h2:mt-12 prose-h3:mt-8 prose-h2:mb-6 prose-h3:mb-4 space-y-8 rounded-2xl border border-border bg-muted/50 p-12 text-accent-foreground'>
        <section>
          <p className='mb-4'>Last Updated: March 28, 2026</p>
          <p>
            This Privacy Policy describes how {projectName} handles personal data when the
            TradingGoose project owner operates the website, app, APIs, or hosted services
            (collectively, the "Service").
          </p>
          <p className='mt-4'>
            If you use a self-hosted deployment or a deployment operated by someone else, that
            operator is responsible for its own privacy notice, data handling, cookies, analytics,
            integrations, and security practices.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>1. Scope and Roles</h2>
          <p className='mb-4'>
            This Privacy Policy applies to project-operated deployments of {projectName}. For
            self-hosted deployments or deployments operated by someone else, that operator controls
            its own configuration, storage, integrations, analytics, retention, and compliance.
          </p>
          <p>
            In those cases, the third-party operator, not the TradingGoose project owner, is the
            primary controller or operator for that deployment's user data.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>2. Information We Collect</h2>

          <h3 className='mb-2 font-medium text-xl'>Account and authentication data</h3>
          <p className='mb-4'>
            We may collect information you provide when creating or using an account, such as your
            name, email address, login method, profile details, organization membership, and account
            settings.
          </p>

          <h3 className='mb-2 font-medium text-xl'>Content and workflow data</h3>
          <p className='mb-4'>
            We may process prompts, chats, files, documents, workflow definitions, logs, indicator
            scripts, watchlists, templates, and other content you submit or generate through the
            Service.
          </p>

          <h3 className='mb-2 font-medium text-xl'>Connected account and integration data</h3>
          <p className='mb-4'>
            If you connect third-party services, we may receive account identifiers, OAuth tokens,
            metadata, and the third-party data you authorize us to access. Depending on what you
            enable, this may include services such as Google, GitHub, Microsoft, Slack, Stripe, and
            broker or market-data providers.
          </p>

          <h3 className='mb-2 font-medium text-xl'>Payment and subscription data</h3>
          <p className='mb-4'>
            If paid plans or usage billing are enabled, billing is handled through payment providers
            such as Stripe. We may receive billing metadata such as customer IDs, subscription
            status, invoices, and payment outcomes, but we do not store full payment card details
            ourselves.
          </p>

          <h3 className='mb-2 font-medium text-xl'>Technical and usage data</h3>
          <p className='mb-4'>
            We may automatically collect information such as IP address, browser type, device
            information, timestamps, error data, request logs, feature usage, page visits, and
            performance metrics.
          </p>

          <h3 className='mb-2 font-medium text-xl'>Cookies, local storage, and analytics</h3>
          <p className='mb-4'>
            The Service uses cookies, local storage, and similar technologies for authentication,
            session management, preferences, security, and product analytics.
          </p>
          <p className='mb-4'>
            If analytics features are enabled by the deployment, they may include OpenTelemetry
            event collection and PostHog analytics. PostHog may collect page views, clicks, form
            interactions, and session replay data. Password fields are masked in replay, but other
            form inputs may not be.
          </p>

          <h3 className='mb-2 font-medium text-xl'>Optional training dataset exports</h3>
          <p>
            Some deployments may enable optional copilot-training features. If you explicitly use
            those features, the recorded workflow-edit dataset you choose to submit may be sent to a
            configured indexing or training service.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>3. Sources of Information</h2>
          <p className='mb-4'>We may collect information directly from:</p>
          <ul className='mb-4 list-disc space-y-2 pl-6'>
            <li>
              You, when you create an account, upload content, connect services, or contact us.
            </li>
            <li>Your browser, device, and use of the Service.</li>
            <li>Third-party accounts and APIs that you choose to connect.</li>
            <li>
              Payment providers, analytics providers, hosting vendors, and operational vendors.
            </li>
          </ul>
          <p>
            We may also derive operational or diagnostic information from logs, execution results,
            billing events, and system telemetry.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>4. How We Use Information</h2>
          <p className='mb-4'>We may use information we collect to:</p>
          <ul className='mb-4 list-disc space-y-2 pl-6'>
            <li>Provide, maintain, and secure the Service.</li>
            <li>Authenticate users and manage accounts, organizations, and permissions.</li>
            <li>Store, execute, and troubleshoot workflows, chats, files, and integrations.</li>
            <li>Process payments, subscriptions, usage limits, and billing communications.</li>
            <li>Respond to support requests, bug reports, and product feedback.</li>
            <li>Monitor performance, reliability, fraud, abuse, and security incidents.</li>
            <li>Improve the Service and develop new features.</li>
            <li>Comply with legal obligations and enforce our terms and policies.</li>
          </ul>
          <p>
            If you use AI or automation features, your content may be processed by model providers
            or integration providers selected by you or configured by the deployment in order to
            deliver the requested feature.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>5. How We Share Information</h2>
          <p className='mb-4'>We may share information with:</p>
          <ul className='mb-4 list-disc space-y-2 pl-6'>
            <li>
              Service providers that help us operate the Service, such as hosting, storage, email,
              analytics, logging, and payment vendors.
            </li>
            <li>
              Third-party platforms, model providers, and APIs when needed to run the workflows,
              integrations, or features you enable.
            </li>
            <li>Law enforcement, regulators, courts, or other parties when legally required.</li>
            <li>
              A successor or buyer in connection with a merger, acquisition, financing, or transfer
              of the Service.
            </li>
          </ul>
          <p>
            We do not sell personal information for money. Third-party service transfers may still
            occur when you enable connected features or when a deployment uses analytics or other
            operational vendors.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>
            6. Google, AI Providers, Broker Integrations, and Other Connected-Service Data
          </h2>
          <p className='mb-4'>
            If you connect Google or other third-party services, we access and use that data only as
            needed to provide the features you enable, subject to your permissions and the connected
            provider's terms.
          </p>
          <p className='mb-4'>
            We do not use Google user data obtained through Google APIs to train generalized AI or
            ML models.
          </p>
          <p>
            Outside the optional training-dataset feature described above, we do not use your
            workflow content to train generalized models for the Service.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>
            7. Cookies, Local Storage, Telemetry, and Analytics
          </h2>
          <p className='mb-4'>
            The Service uses cookies, local storage, and related technologies for login sessions,
            authentication state, UI preferences, account settings, security, product analytics, and
            similar operational functions.
          </p>
          <p className='mb-4'>
            For project-operated deployments, anonymous telemetry may be enabled by default and may
            be controllable through product settings depending on the deployment and your account
            state.
          </p>
          <p>
            Some deployments may also enable PostHog or similar analytics tooling for page
            analytics, interaction analytics, and session replay. If you run a self-hosted
            deployment, your operator controls whether such tooling is enabled and where data is
            sent.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>8. International Processing</h2>
          <p>
            Information may be processed in the United States and other countries where our vendors,
            infrastructure, or connected service providers operate. Data-protection laws may differ
            between jurisdictions.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>9. Retention</h2>
          <p className='mb-4'>
            We keep information for as long as reasonably necessary to operate the Service, maintain
            your account, process billing, investigate abuse, comply with legal obligations, and
            resolve disputes.
          </p>
          <p>
            Retention periods may vary by data type and deployment configuration. Self-hosted or
            third-party operators control their own retention settings for their deployments.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>10. Security</h2>
          <p>
            We use reasonable administrative, technical, and organizational safeguards to protect
            information, but no system is completely secure. You are also responsible for protecting
            your account credentials, API keys, and connected third-party accounts.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>11. Your Choices and Rights</h2>
          <p className='mb-4'>
            Depending on where you live, you may have rights to access, correct, delete, export, or
            object to certain uses of your personal data.
          </p>
          <p className='mb-4'>
            You may also be able to control some collection directly through product settings, such
            as anonymous telemetry preferences, or by disconnecting third-party accounts.
          </p>
          <p className='mb-4'>
            If you are in the EEA, UK, or another jurisdiction with similar rights, you may also
            have rights related to restriction, objection, withdrawal of consent where consent is
            used, and complaint to a supervisory authority.
          </p>
          <p className='mb-4'>
            If you are a California resident, you may have rights to know, access, correct, delete,
            and receive information about categories of personal information we collect, use, and
            disclose for project-operated deployments, subject to legal exceptions.
          </p>
          <p>
            To make a privacy-related request for a project-operated deployment, contact{' '}
            <Link
              href={supportEmailHref}
              className='text-primary underline hover:text-primary-hover'
            >
              {supportEmail}
            </Link>
            . If you use a self-hosted or third-party deployment, contact that operator instead.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>12. Children's Privacy</h2>
          <p>
            The Service is not intended for children under 18, and we do not knowingly collect
            personal data from children through the project-operated Service.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>13. External Services</h2>
          <p>
            This Privacy Policy does not cover third-party services, brokerages, model providers,
            market-data providers, or sites that you connect to or visit through the Service. Review
            those providers' own terms and privacy notices.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>14. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. When we do, we will update the
            "Last Updated" date on this page. Material changes will apply when posted unless a
            longer notice period is required by law.
          </p>
        </section>

        <section>
          <h2 className='mb-4 font-semibold text-2xl'>15. Contact</h2>
          <p className='mb-4'>
            If you have questions, requests, or complaints regarding this Privacy Policy for a
            project-operated deployment, contact us at{' '}
            <Link
              href={supportEmailHref}
              className='text-primary underline hover:text-primary-hover'
            >
              {supportEmail}
            </Link>
            .
          </p>
          <p>
            We do not currently publish a separate mailing address on this page. If that changes, we
            will update this policy.
          </p>
        </section>
      </div>
    </LegalLayout>
  )
}
