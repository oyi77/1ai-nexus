import { discoverBirdeyeTokens, auditBirdeyeToken } from '../src/lib/modules/meme/birdeye'
import { auditRugcheckToken } from '../src/lib/modules/meme/rugcheck'
import { discoverGeckoTerminalTokens } from '../src/lib/modules/meme/geckoterminal'
import { explainScore } from '../src/lib/modules/meme/ranking'

async function main() {
  console.log('== Birdeye discovery ==')
  const bt = await discoverBirdeyeTokens(3)
  console.log(`tokens: ${bt.length}`)
  if (bt[0]) console.log('  first:', bt[0].symbol, '| vol24h:', bt[0].volume24h, '| liq:', bt[0].liquidity, '| top10:', bt[0].top10HolderPercent, '| holders:', bt[0].holders)

  console.log('== GeckoTerminal discovery ==')
  const gt = await discoverGeckoTerminalTokens(3)
  console.log(`tokens: ${gt.length}`)
  if (gt[0]) console.log('  first:', gt[0].symbol, '| price:', gt[0].price, '| vol24h:', gt[0].volume24h, '| buys:', gt[0].buyCount24h, '| sells:', gt[0].sellCount24h)

  const target = bt[0]?.contract
  if (target) {
    console.log('== Birdeye audit ==', target)
    const ba = await auditBirdeyeToken('solana', target)
    console.log(' ', ba ? `risk=${ba.riskLevel} ${ba.riskLabel} counts=${JSON.stringify(ba.riskCounts)} top10=${ba.top10HolderPercent}` : 'null')

    console.log('== RugCheck audit ==', target)
    const ra = await auditRugcheckToken('solana', target)
    console.log(' ', ra ? `risk=${ra.riskLevel} ${ra.riskLabel} counts=${JSON.stringify(ra.riskCounts)} top10=${ra.top10HolderPercent} freeze=${ra.canFreeze} mint=${ra.canMint}` : 'null')
  }

  console.log('== explainScore (Birdeye token) ==')
  if (bt[0]) {
    const ex = explainScore(bt[0])
    console.log(' ', 'score:', ex.score.toFixed(3), 'reasons:', ex.reasons.map(r => `${r.code}:${r.points.toFixed(3)}`).join(' '))
  }

  console.log('== explainScore (GeckoTerminal token — flowSignal) ==')
  if (gt[0]) {
    const ex = explainScore(gt[0])
    console.log(' ', 'score:', ex.score.toFixed(3), 'flow:', ex.flowSignal ? `${ex.flowSignal.code} ${ex.flowSignal.label}` : 'none')
  }
}
main().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1) })
