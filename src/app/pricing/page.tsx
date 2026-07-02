"use client"

import { useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { FinancialDisclaimer } from '@/components/FinancialDisclaimer'

const tiers = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    priceIdr: 'Rp0',
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
    id: 'pro',
    name: 'Pro',
    price: '$29',
    priceIdr: 'Rp449.500',
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
    id: 'enterprise',
    name: 'Enterprise',
    price: '$99',
    priceIdr: 'Rp1.534.500',
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

const paymentMethods = [
  { id: 'tripay', name: 'Tripay', icon: '🏦', description: 'QRIS, VA (BCA, BNI, BRI, Mandiri)' },
  { id: 'midtrans', name: 'Midtrans', icon: '💳', description: 'Credit Card, Gopay, OVO, Dana' },
  { id: 'duitku', name: 'Duitku', icon: '🏧', description: 'Virtual Account, Alfamart' },
  { id: 'nowpayments', name: 'Crypto', icon: '₿', description: 'BTC, ETH, USDT, SOL, 100+' },
]

export default function PricingPage() {
  const [selectedMethod, setSelectedMethod] = useState('tripay')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePayment = async (tierId: string) => {
    if (tierId === 'free') {
      window.location.href = '/alpha-engine'
      return
    }

    if (!email) {
      setError('Please enter your email')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: selectedMethod,
          tier: tierId,
          email,
        }),
      })

      const data = await res.json()

      if (data.data?.paymentUrl) {
        window.location.href = data.data.paymentUrl
      } else {
        setError(data.error ?? 'Payment failed')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

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

        {/* Payment Method Selector */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">Payment Method</h2>
          <div className="grid grid-cols-4 gap-4">
            {paymentMethods.map((method) => (
              <button
                key={method.id}
                onClick={() => setSelectedMethod(method.id)}
                className={`p-4 rounded-lg border text-left transition-colors ${
                  selectedMethod === method.id
                    ? 'border-teal-vivid bg-teal-vivid/10'
                    : 'border-border-dim hover:border-border-active'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{method.icon}</span>
                  <span className="font-mono font-bold text-text-primary">{method.name}</span>
                </div>
                <p className="text-[10px] text-text-muted font-mono">{method.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Email Input */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">Your Email</h2>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full px-4 py-2 bg-bg-raised border border-border-dim rounded font-mono text-text-primary placeholder-text-muted focus:outline-none focus:border-teal-vivid"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="bg-data-bear/10 border border-data-bear/30 rounded-lg p-4 text-sm text-data-bear font-mono">
            {error}
          </div>
        )}

        {/* Pricing Cards */}
        <div className="grid grid-cols-3 gap-6">
          {tiers.map((tier) => (
            <div
              key={tier.id}
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
                <p className="text-xs text-text-muted font-mono mt-1">
                  {selectedMethod === 'nowpayments' ? tier.price : tier.priceIdr}
                </p>
                <p className="text-xs text-text-muted font-mono mt-1">{tier.description}</p>
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
                onClick={() => handlePayment(tier.id)}
                disabled={loading}
                className={`w-full py-2 px-4 rounded font-mono font-bold text-sm transition-colors ${
                  tier.highlighted
                    ? 'bg-teal-vivid text-bg-base hover:bg-teal-vivid/80'
                    : 'bg-bg-raised text-text-primary hover:bg-bg-elevated'
                } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {loading ? 'Processing...' : tier.cta}
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
