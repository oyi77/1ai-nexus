// ─────────────────────────────────────────────────────────────
// Signal IDs — Indonesian translation of tier reasons & rejection
// templates. Carved from signal-tier.ts for the 800-line gate.
// ─────────────────────────────────────────────────────────────

/**
 * Reason/missing strings originate in classifySignalTier (English, stable
 * phrasing) and in the evaluator's warnings. Translate the known templates
 * to Indonesian; pass anything unrecognized through verbatim (never invent a
 * translation that hides the original fact).
 */
const REASON_ID: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^security failure: (.+)$/, (m) => `KEAMANAN GAGAL — ${m[1]}`],
  [/^core criterion failed: (.+)$/, (m) => `Kriteria inti gagal — ${m[1]}`],
  [/^signal age (\d+)m exceeds (\d+)m freshness window$/, (m) => `Usia sinyal ${m[1]}m melewati jendela kesegaran ${m[2]}m`],
  [/^clean screen at ([\d.]+)x volume$/, (m) => `Screening bersih di ${m[1]}x volume`],
  [/^(\d+) confirmed buyer\(s\), strongest=(.+)$/, (m) => `${m[1]} wallet terverifikasi, terkuat: ${m[2]}`],
  [/^wallet evidence unavailable$/, () => 'Bukti wallet tidak tersedia'],
  [/^wallet evidence could not be read — absence is not safety$/, () => 'Bukti wallet tidak terbaca — ketiadaan bukti bukan berarti aman'],
  [/^source coverage incomplete$/, () => 'Cakupan sumber tidak lengkap'],
  [/^no classified wallet holds this token$/, () => 'Tidak ada wallet terklasifikasi memegang token ini'],
  [/^classified holders are not bullish or are stale$/, () => 'Wallet terklasifikasi tidak bullish atau sudah kadaluwarsa'],
  [/^screening passed but essential evidence is missing$/, () => 'Screening lolos tapi bukti esensial masih hilang'],
  [/^interesting but unconfirmed$/, () => 'Menarik tapi belum terkonfirmasi'],
]

export function reasonId(s: string): string {
  for (const [re, fn] of REASON_ID) {
    const m = s.match(re)
    if (m) return fn(m)
  }
  return s
}

/**
 * Translate the evaluator's rejection templates to Indonesian for the
 * operator. Unmatched text passes through verbatim — a partial translation
 * must never hide which gate fired.
 */
export function rejectionId(s: string): string {
  let out = s
  out = out.replace(
    /^Dead momentum: 5m vol\/mcap ([\d.]+)x < required ([\d.]+)x$/,
    'Volume lemah — 5m vol/mcap $1x < syarat $2x',
  )
  out = out.replace(/^Top 10 hold ([\d.]+)% \(ceiling (\d+)%\)$/, 'Top 10 pegang $1% (batas $2%)')
  out = out.replace(
    /^Linked cluster unproven — cannot rule out coordinated wallets$/,
    'Cluster belum terbukti — wallet terkoordinasi belum bisa disingkirkan',
  )
  out = out.replace(/^Dev holds ([\d.]+)%(.*)$/, 'Dev pegang $1%$2')
  out = out.replace(/^Snipers hold ([\d.]+)%(.*)$/, 'Sniper pegang $1%$2')
  out = out.replace(/^Bundlers hold ([\d.]+)%(.*)$/, 'Bundler pegang $1%$2')
  out = out.replace(/^Insiders hold ([\d.]+)%(.*)$/, 'Insider pegang $1%$2')
  out = out.replace(/^Mint authority unproven \(must be disabled\)$/, 'Mint authority belum terbukti mati')
  out = out.replace(/^Freeze authority unproven \(must be disabled\)$/, 'Freeze authority belum terbukti mati')
  out = out.replace(
    /^Honeypot status unproven \(sell-side safety unknown\)$/,
    'Status honeypot belum terbukti — keamanan sisi jual tidak diketahui',
  )
  out = out.replace(
    /^LP burn\/lock unproven \(must be 100% burnt or locked\)$/,
    'LP burn/lock belum terbukti — harus 100% burnt atau locked',
  )
  out = out.replace(/^Top-10 concentration unproven$/, 'Konsentrasi top-10 belum terbukti')
  out = out.replace(/^Insider share unproven$/, 'Porsi insider belum terbukti')
  out = out.replace(/^Sniper share unproven$/, 'Porsi sniper belum terbukti')
  out = out.replace(/^Bundler share unproven$/, 'Porsi bundler belum terbukti')
  out = out.replace(/^Dev holding unproven \(must be 0%\)$/, 'Porsi dev belum terbukti (harus 0%)')
  out = out.replace(/^Market cap is zero\/unknown — ratio uncomputable$/, 'Market cap nol/tidak diketahui — ratio tidak bisa dihitung')
  out = out.replace(/^Volume unknown — momentum uncomputable$/, 'Volume tidak diketahui — momentum tidak bisa dihitung')
  return out
}
