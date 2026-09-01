import { randomBytes } from 'crypto'

const REFERRAL_REWARD_MONTHS = 1
const MAX_REFERRAL_CREDITS = 5

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
