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
  out = out.replace(/^(\d+) hard-rule breaches — (.+)$/, (_m, n: string, first: string) => {
    return `${n} pelanggaran hard-rule — ${rejectionId(first)}`
  })
  out = out.replace(/^1 hard-rule breach — (.+)$/, (_m, first: string) => {
    return `1 pelanggaran hard-rule — ${rejectionId(first)}`
  })
  out = out.replace(
    /^Screening passed but security evidence is incomplete — (.+) \(not a rejection, but never a top signal on missing data\)$/,
    (_m, missing: string) =>
      `Screening lolos tapi bukti keamanan belum lengkap — ${rejectionId(missing)} (bukan penolakan, tapi tidak pernah jadi sinyal utama saat data hilang)`,
  )
  out = out.replace(
    /^Setup is clean and volume is live \(([^)]+)\), but top holders sit on \+([\d.]+)% — wait for the flush before entry$/,
    "Setup bersih dan volume hidup ($1), tapi holder teratas masih duduk di +$2% — tunggu flush sebelum masuk",
  )
  out = out.replace(
    /^Clean distribution with top holders still accumulating \(\+([\d.]+)% avg PnL\), ([\d.]+x) volume, plus confirmed smart money \((.*?)\) — candidate for the downstream executor$/,
    "Distribusi bersih dengan holder teratas masih mengakumulasi (+$1% avg PnL), volume $2, plus smart money terkonfirmasi ($3) — kandidat untuk executor hilir",
  )
  out = out.replace(
    /^All hard filters passed with live ([\d.]+x) volume, no concentrated exits, plus confirmed smart money \((.*?)\) — candidate for the downstream executor$/,
    "Semua hard filter lolos dengan volume hidup $1, tidak ada exit terkonsentrasi, plus smart money terkonfirmasi ($2) — kandidat untuk executor hilir",
  )
  out = out.replace(
    /^Screening passed but no verified smart-money buyer — hold for wallet confirmation before it becomes a signal \(volume ([\d.]+x), accumulating\)$/,
    "Screening lolos tapi belum ada pembeli smart-money terverifikasi — tahan sampai wallet terkonfirmasi sebelum jadi sinyal (volume $1, akumulasi)",
  )
  out = out.replace(
    /^Hard filters clean, volume ([\d.]+x), but no verified smart-money buyer — hold for wallet confirmation$/,
    "Hard filter bersih, volume $1, tapi belum ada pembeli smart-money terverifikasi — tahan sampai wallet terkonfirmasi",
  )
  out = out.replace(
    /^Dead momentum: 5m vol\/mcap ([\d.]+)x < required ([\d.]+)x$/,
    'Volume lemah — 5m vol/mcap $1x < syarat $2x',
  )
  out = out.replace(/^Top 10 hold ([\d.]+)% \(ceiling (\d+)%\)$/, 'Top 10 pegang $1% (batas $2%)')
  out = out.replace(
    /^Linked cluster unproven — cannot rule out coordinated wallets$/,
    'Cluster belum terbukti — wallet terkoordinasi belum bisa disingkirkan',
  )
  out = out.replace(
    /^Linked cluster holds ([\d.]+)% \(ceiling ([\d.]+)%\)$/,
    'Cluster terhubung pegang $1% (batas $2%)',
  )
  out = out.replace(/^Dev holds (<[\d.]+)%(.*)$/, 'Dev pegang $1%$2')
  out = out.replace(/^Dev holds ([\d.]+)%(.*)$/, 'Dev pegang $1%$2')
  out = out.replace(/^Snipers hold ([\d.]+)%(.*)$/, 'Sniper pegang $1%$2')
  out = out.replace(
    /^Launch cohort still holds ([\d.]+)% \(sold ([\d.]+)%, needs ([\d.]+)%\)$/,
    'Kohort peluncuran masih pegang $1% (terjual $2%, wajib $3%)',
  )
  out = out.replace(
    /^Launch cohort exit unproven — share and exit both unreported$/,
    'Exit kohort peluncuran belum terbukti — porsi dan exit sama-sama tidak dilaporkan',
  )
  out = out.replace(
    /^Bundlers hold ([\d.]+)% and have not fully exited \(sold ([\d.]+)%\) — ceiling ([\d.]+)%$/,
    'Bundler masih pegang $1% dan belum keluar penuh (terjual $2%) — batas $3%',
  )
  out = out.replace(
    /^Bundlers hold ([\d.]+)% and their exit is unproven — ceiling ([\d.]+)%$/,
    'Bundler pegang $1% dan exit-nya belum terbukti — batas $2%',
  )
  out = out.replace(/^Bundlers hold ([\d.]+)%(.*)$/, 'Bundler pegang $1%$2')
  out = out.replace(/^Insiders hold ([\d.]+)%(.*)$/, 'Insider pegang $1%$2')
  out = out.replace(/^Mint authority unproven \(must be disabled\)$/, 'Mint authority belum terbukti mati')
  out = out.replace(
    /^Mint authority ENABLED — dev can inflate$/,
    'Mint authority AKTIF — dev bisa mencetak token baru',
  )
  out = out.replace(/^Freeze authority unproven \(must be disabled\)$/, 'Freeze authority belum terbukti mati')
  out = out.replace(
    /^Freeze authority ENABLED — holders can be frozen$/,
    'Freeze authority AKTIF — holder bisa dibekukan',
  )
  out = out.replace(
    /^Honeypot status unproven \(sell-side safety unknown\)$/,
    'Status honeypot belum terbukti — keamanan sisi jual tidak diketahui',
  )
  out = out.replace(/^Honeypot: sells are blocked$/, 'Honeypot — penjualan diblokir')
  out = out.replace(
    /^LP burn\/lock unproven — no source measured it \(not a breach, but never a pass\)$/,
    'LP burn/lock belum terbukti — tidak ada sumber yang mengukurnya (bukan pelanggaran, tapi tidak pernah lolos)',
  )
  out = out.replace(
    /^LP only ([\d.]+)% burnt\+locked — exit liquidity exposed$/,
    'LP baru $1% dibakar+dikunci — likuiditas keluar terbuka',
  )
  out = out.replace(
    /^LP burn only ([\d.]+)% — exit liquidity exposed$/,
    'LP baru dibakar $1% — likuiditas keluar terbuka',
  )
  out = out.replace(
    /^LP lock only ([\d.]+)% — exit liquidity exposed$/,
    'LP baru dikunci $1% — likuiditas keluar terbuka',
  )
  out = out.replace(/^Top-10 concentration unproven$/, 'Konsentrasi top-10 belum terbukti')
  out = out.replace(/^Insider share unproven$/, 'Porsi insider belum terbukti')
  out = out.replace(/^Sniper share unproven$/, 'Porsi sniper belum terbukti')
  out = out.replace(
    /^Bundler share unproven — launch cohort sold ([\d.]+)% of its position$/,
    'Porsi bundler belum terbukti — kohort peluncuran sudah keluar $1% dari posisinya',
  )
  out = out.replace(/^Bundler share unproven$/, 'Porsi bundler belum terbukti')
  out = out.replace(
    /^Top 1-3 holder identities unproven \((\d+) of (\d+) known\) — concentration unverifiable$/,
    'Identitas holder top 1-3 belum terbukti ($1 dari $2 diketahui) — konsentrasi tidak bisa diverifikasi',
  )
  out = out.replace(
    /^Top 1-3 holder classification unproven — cannot rule out taint$/,
    'Klasifikasi holder top 1-3 belum terbukti — taint belum bisa disingkirkan',
  )
  out = out.replace(
    /^Top wallet ([1-9A-HJ-NP-Za-km-z]{4,})… is a (sniper|dev|bundler|insider|fresh) wallet \(([\d.]+)%\) — not a clean holder$/,
    'Wallet top $1… adalah wallet $2 ($3%) — bukan holder bersih',
  )
  out = out.replace(/^Dev holding unproven \(must be 0%\)$/, 'Porsi dev belum terbukti (harus 0%)')
  out = out.replace(/^Market cap is zero\/unknown — ratio uncomputable$/, 'Market cap nol/tidak diketahui — ratio tidak bisa dihitung')
  out = out.replace(/^Volume unknown — momentum uncomputable$/, 'Volume tidak diketahui — momentum tidak bisa dihitung')
  return out
}
