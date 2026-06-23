import { apiSuccess, apiError } from '@/lib/api/response'

export async function GET() {
  try {
    const res = await fetch('https://t.me/s/whale_alert_io', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      next: { revalidate: 60 }
    })

    if (!res.ok) {
      return apiError(`Failed to fetch from Telegram: ${res.statusText}`, res.status)
    }

    const html = await res.text()
    const alerts = []
    
    // Find all message divs
    const messageRegex = /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g
    let match
    
    while ((match = messageRegex.exec(html)) !== null) {
      let text = match[1].replace(/<br\s*\/?>/gi, ' \n ')
      text = text.replace(/<[^>]+>/g, '') // Strip HTML tags
      text = text.replace(/&#036;/g, '$') // Fix dollar signs
      
      if (text.includes('🚨') && text.includes('transferred from')) {
        const clean = text.replace(/🚨/g, '').trim()
        
        // Parse the text: " 101,665,000 $USDT (101,543,713 USD) transferred from #Bitfinex to Tether Treasury Details"
        const regex = /([0-9,.]+)\s*\$?([A-Za-z]+)\s*\(([0-9,.]+)\s*USD\)\s*transferred from\s*(.+?)\s*to\s*(.+?)(?:\n|$|Details)/i
        const parsed = regex.exec(clean)
        
        if (parsed) {
          const amount = parseFloat(parsed[1].replace(/,/g, ''))
          const symbol = parsed[2].toUpperCase()
          const usd = parseFloat(parsed[3].replace(/,/g, ''))
          const from = parsed[4].trim()
          const to = parsed[5].replace(/Details/g, '').trim()
          
          // Extract link if present
          let link = ''
          const linkRegex = /href="(https:\/\/whale-alert\.io\/transaction\/[^"]+)"/
          const linkMatch = linkRegex.exec(match[1])
          if (linkMatch) {
            link = linkMatch[1]
          }
          
          alerts.push({
            id: `wa-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            amount,
            symbol,
            usd,
            from,
            to,
            link
          })
        }
      }
    }
    
    // Reverse to get newest first (Telegram HTML typically has newest at the bottom or top depending on the view, but web view has newest at the bottom)
    alerts.reverse()

    const r = apiSuccess({ items: alerts.slice(0, 20), count: alerts.length })
    r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    return r
  } catch (error) {
    console.error('Whale Alert scrape error:', error)
    return apiError('Failed to fetch Whale Alerts', 500)
  }
}
