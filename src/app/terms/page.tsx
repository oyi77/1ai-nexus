"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'

export default function TermsOfServicePage() {
  return (
    <NexusLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold font-mono text-text-primary">Terms of Service</h1>
          <p className="text-sm text-text-muted font-mono mt-2">Last updated: {new Date().toLocaleDateString()}</p>
        </div>

        <section className="space-y-4">
          <h2 className="page-title text-lg">1. Acceptance of Terms</h2>
          <p className="text-sm text-text-secondary">
            By accessing or using the Nexus Alpha Engine service (&quot;Service&quot;), you agree to be bound by these Terms of Service.
            If you do not agree to these terms, do not use the Service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">2. Not Financial Advice</h2>
          <div className="bg-data-bear/10 border border-data-bear/30 rounded-lg p-4">
            <p className="text-sm text-data-bear font-bold font-mono mb-2">⚠️ IMPORTANT DISCLAIMER</p>
            <p className="text-sm text-text-secondary">
              The signals, analysis, and information provided through this Service are for <strong>educational and informational purposes only</strong>.
              They do NOT constitute financial advice, investment advice, trading advice, or any other form of professional advice.
            </p>
            <p className="text-sm text-text-secondary mt-2">
              You should NOT rely on any information provided through this Service to make investment decisions.
              Always consult with a qualified financial advisor before making any investment.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">3. No Guarantee of Profit</h2>
          <p className="text-sm text-text-secondary">
            Past performance does not guarantee future results. The signals and analysis provided through this Service
            are based on historical data and mathematical models, which may not accurately predict future market movements.
          </p>
          <p className="text-sm text-text-secondary">
            You acknowledge that trading cryptocurrencies and other financial instruments involves significant risk,
            including the potential loss of your entire investment. You trade at your own risk.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">4. User Responsibilities</h2>
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-2">
            <li>You are solely responsible for your trading decisions and any resulting profits or losses.</li>
            <li>You must conduct your own research and due diligence before making any investment.</li>
            <li>You must comply with all applicable laws and regulations in your jurisdiction.</li>
            <li>You must not use the Service for any illegal or unauthorized purpose.</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">5. Limitation of Liability</h2>
          <p className="text-sm text-text-secondary">
            To the maximum extent permitted by law, the Service and its operators shall not be liable for any
            direct, indirect, incidental, special, consequential, or punitive damages, including but not limited to
            loss of profits, data, or goodwill, arising from your use of the Service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">6. API Usage</h2>
          <p className="text-sm text-text-secondary">
            API keys are provided for your use only. You must not share your API key with others.
            We reserve the right to revoke API keys that are misused or shared.
          </p>
          <p className="text-sm text-text-secondary">
            Rate limits are enforced per tier. Exceeding rate limits may result in temporary or permanent suspension of access.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">7. Changes to Terms</h2>
          <p className="text-sm text-text-secondary">
            We reserve the right to modify these terms at any time. We will notify users of significant changes
            via email or through the Service. Continued use of the Service after changes constitutes acceptance
            of the new terms.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="page-title text-lg">8. Contact</h2>
          <p className="text-sm text-text-secondary">
            If you have any questions about these Terms of Service, please contact us at support@aitradepulse.com
          </p>
        </section>
      </div>
    </NexusLayout>
  )
}
