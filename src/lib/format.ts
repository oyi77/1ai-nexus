/**
 * Smart price formatter — adapts decimal places to price magnitude.
 * Small prices (< $1) get more precision; large prices get fewer.
 * Returns number string WITHOUT $ prefix (use formatPriceUSD for prefix).
 */
export function formatPrice(price: number): string {
  if (price === 0) return '0.00'
  
  const abs = Math.abs(price)
  
  // Very small prices (< 0.01): show up to 6 decimals
  if (abs < 0.01) return price.toFixed(6).replace(/\.?0+$/, '') || '0'
  
  // Small prices (< 1): show up to 4 decimals
  if (abs < 1) return price.toFixed(4).replace(/\.?0+$/, '') || '0'
  
  // Medium prices (< 100): 2 decimals
  if (abs < 100) return price.toFixed(2)
  
  // Large prices (< 10000): 2 decimals with comma separator
  if (abs < 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  
  // Very large prices: no decimals
  return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/**
 * Format price with $ prefix
 */
export function formatPriceUSD(price: number): string {
  return '$' + formatPrice(price)
}

/**
 * Format percentage with sign
 */
export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

/**
 * Format compact numbers (K, M, B)
 */
export function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
