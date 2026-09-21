import { randomBytes } from 'crypto'

export function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

export interface ReferralResult {
  success: boolean
  code?: string
  error?: string
}

export interface ReferralStats {
  code: string | null
  referralsCount: number
  credits: number
  referredBy: string | null
}
