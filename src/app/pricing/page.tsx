"use client"

import { useState } from 'react'
import { PLAN_PRICING } from '@/lib/pricing'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { FinancialDisclaimer } from '@/components/FinancialDisclaimer'

// Presentation-only metadata (not pricing data — amounts/features come from PLAN_PRICING).
const tierMeta: Record<string, { name: string; cta: string; highlighted: boolean }> = {
  free: { name: 'Free', cta: 'Get Started', highlighted: false },
  pro: { name: 'Pro', cta: 'Upgrade to Pro', highlighted: true },
  enterprise: { name: 'Enterprise', cta: 'Contact Sales', highlighted: false },
}

const IDR_RATE = 15500 // USD → IDR for Indonesian gateways

const formatUsd = (cents: number) => `$${cents / 100}`
const formatIdr = (cents: number) => `Rp${Math.round((cents / 100) * IDR_RATE).toLocaleString('id-ID')}`

// Single source of truth: derive every display price from PLAN_PRICING.
const tiers = Object.entries(PLAN_PRICING).map(([id, plan]) => ({
  id,
  name: tierMeta[id]?.name ?? id,
  price: formatUsd(plan.amount),
  priceIdr: formatIdr(plan.amount),
  period: '/month',
  description: plan.description,
  features: plan.features,
  cta: tierMeta[id]?.cta ?? id,
  highlighted: tierMeta[id]?.highlighted ?? false,
}))

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
      // eslint-disable-next-line react-hooks/immutability
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
      const res = await fetch('/api/v1/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: tierId,
          email,
          gateway: selectedMethod,
        }),
      })

      const data = await res.json()

      if (res.status === 401 || (data.error && String(data.error).includes('Authentication required'))) {
        // eslint-disable-next-line react-hooks/immutability
        window.location.href = '/signup?redirect=/pricing'
        return
      }

      if (data.data?.paymentUrl) {
        // eslint-disable-next-line react-hooks/immutability
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
          <h1 className="text-3xl font-bold text-text-primary">Pricing Plans</h1>
          <p className="text-sm text-text-muted mt-2">
            Choose the plan that fits your trading needs
          </p>
        </div>

        <FinancialDisclaimer variant="inline" />

        {/* Payment Method Selector */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="page-title text-lg mb-4">Payment Method</h2>
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
                <p className="text-xs text-text-muted">{method.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Email Input */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
          <h2 className="page-title text-lg mb-4">Your Email</h2>
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
                  <span className="px-3 py-1 bg-teal-vivid text-bg-base text-xs font-mono font-bold rounded-full">
                    MOST POPULAR
                  </span>
                </div>
              )}

              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-text-primary">{tier.name}</h2>
                <div className="mt-2">
                  <span className="text-3xl font-bold font-mono text-text-primary">{tier.price}</span>
                  <span className="text-sm text-text-muted font-mono">{tier.period}</span>
                </div>
                <p className="text-xs text-text-muted mt-1">
                  {selectedMethod === 'nowpayments' ? tier.price : tier.priceIdr}
                </p>
                <p className="text-xs text-text-muted mt-1">{tier.description}</p>
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
