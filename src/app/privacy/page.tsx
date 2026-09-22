"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'

export default function PrivacyPolicyPage() {
  return (
    <NexusLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Privacy Policy</h1>
          <p className="text-sm text-text-muted mt-2">Last updated: {new Date().toLocaleDateString()}</p>
        </div>

        <section className="space-y-4">
          <h2 className="page-title text-lg">1. Data We Collect</h2>
          <p className="text-sm text-text-secondary">
            Account data: email address and password hash (bcrypt) when you sign up. Optional profile
            fields you provide (Telegram username for alerts). Usage data: API call counts for rate
            limiting, alert configurations you create, watchlists and portfolios you save. Payment data:
            plan and subscription status — card details are processed by our payment gateway
            (Midtrans/Tripay) and never touch our servers. Market data we display is public and contains
            no personal information.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">2. How We Use It</h2>
          <p className="text-sm text-text-secondary">
            Authentication and account security. Enforcing plan rate limits. Delivering alerts you
            configured to your Telegram. Processing payments and activating subscriptions. Improving
            the Service in aggregate (never sold, never shared with advertisers).
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">3. Cookies</h2>
          <p className="text-sm text-text-secondary">
            A single HttpOnly session cookie (<code>nexus-session</code>) keeps you signed in. No
            third-party tracking cookies, no advertising pixels. Analytics are first-party pageview
            counts only.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">4. Data Sharing</h2>
          <p className="text-sm text-text-secondary">
            We share data only with processors required to run the Service: the payment gateway (to
            take your payment), the SMTP provider (to send verify/reset emails), and Telegram (to
            deliver alerts you asked for). No sale of personal data, ever.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">5. Retention & Deletion</h2>
          <p className="text-sm text-text-secondary">
            Account data is kept while your account exists. Delete your account by emailing
            support@aitradepulse.com — we remove your profile, alerts, keys, and watchlists within
            30 days. Anonymized market-signal history (no personal data) may be retained for
            calibration. Payment records are kept 7 years for tax compliance.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">6. Security</h2>
          <p className="text-sm text-text-secondary">
            Passwords are bcrypt-hashed, sessions are HttpOnly cookies, API keys are stored hashed,
            integration secrets are AES-256-GCM encrypted at rest. No system is impenetrable; report
            vulnerabilities to support@aitradepulse.com.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">7. Your Rights</h2>
          <p className="text-sm text-text-secondary">
            Request a copy, correction, or deletion of your personal data at any time via
            support@aitradepulse.com. EU/UK users: our lawful basis is contract performance (account,
            billing) and consent (alerts). You may withdraw consent by disabling alerts or deleting
            your account.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">8. Contact</h2>
          <p className="text-sm text-text-secondary">
            Privacy questions: support@aitradepulse.com
          </p>
        </section>
      </div>
    </NexusLayout>
  )
}
