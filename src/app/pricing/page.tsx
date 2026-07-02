"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { FinancialDisclaimer } from '@/components/FinancialDisclaimer'

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Basic market data access',
    features: [
      '100 API calls/day',
      'Market data access',
      'Macro indicators',
      'News feed',
      'Basic signals',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/month',
    description: 'Full data access + signals',
    features: [
      '10,000 API calls/day',
      'All Free features',
      'On-chain analytics',
      'Alpha signals',
      'Screener tools',
      'Backtest results',
      'Position sizing',
      'Email support',
    ],
    cta: 'Upgrade to Pro',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '$99',
    period: '/month',
    description: 'Unlimited access + WebSocket',
    features: [
      '100,000 API calls/day',
      'All Pro features',
      'Historical data',
      'WebSocket streaming',
      'Priority support',
      'Custom alerts',
      'API key management',
      'Dedicated account manager',
    ],
    cta: 'Contact Sales',
    highlighted: false,
  },
]

export default function PricingPage() {
  return (
    <NexusLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold font-mono text-text-primary">Pricing Plans</h1>
          <p className="text-sm text-text-muted font-mono mt-2">
            Choose the plan that fits your trading needs
          </p>
        </div>

        <FinancialDisclaimer variant="inline" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-lg border p-6 ${
                tier.highlighted
                  ? 'border-teal-vivid bg-teal-vivid/5 scale-105'
                  : 'border-border-dim bg-bg-panel'
              }`}
            >
              {tier.highlighted && (
                <div className="text-center mb-4">
                  <span className="px-3 py-1 bg-teal-vivid text-bg-base text-[10px] font-mono font-bold rounded-full">
                    MOST POPULAR
                  </span>
                </div>
              )}

              <div className="text-center mb-6">
                <h2 className="text-xl font-bold font-mono text-text-primary">{tier.name}</h2>
                <div className="mt-2">
                  <span className="text-3xl font-bold font-mono text-text-primary">{tier.price}</span>
                  <span className="text-sm text-text-muted font-mono">{tier.period}</span>
                </div>
                <p className="text-xs text-text-muted font-mono mt-2">{tier.description}</p>
              </div>

              <ul className="space-y-3 mb-6">
                {tier.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                    <span className="text-teal-vivid mt-0.5">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                className={`w-full py-2 px-4 rounded font-mono font-bold text-sm transition-colors ${
                  tier.highlighted
                    ? 'bg-teal-vivid text-bg-base hover:bg-teal-vivid/80'
                    : 'bg-bg-raised text-text-primary hover:bg-bg-elevated'
                }`}
              >
                {tier.cta}
              </button>
            </div>
          ))}
        </div>

        <div className="text-center text-xs text-text-muted font-mono">
          <p>All plans include a 14-day free trial. No credit card required.</p>
          <p className="mt-1">
            Need a custom plan? <a href="mailto:support@aitradepulse.com" className="text-accent-cyan underline">Contact us</a>
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
