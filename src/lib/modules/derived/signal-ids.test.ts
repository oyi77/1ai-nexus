import { describe, expect, it } from 'vitest'
import { reasonId, rejectionId } from './signal-ids'

const REJECTIONS: Array<[string, string]> = [
  ['Dead momentum: 5m vol/mcap 0.12x < required 0.5x', 'Volume lemah — 5m vol/mcap 0.12x < syarat 0.5x'],
  ['Top 10 hold 31.2% (ceiling 25%)', 'Top 10 pegang 31.2% (batas 25%)'],
  [
    'Linked cluster unproven — cannot rule out coordinated wallets',
    'Cluster belum terbukti — wallet terkoordinasi belum bisa disingkirkan',
  ],
  ['Linked cluster holds 33.3% (ceiling 15%)', 'Cluster terhubung pegang 33.3% (batas 15%)'],
  ['Dev holds 4.5% (must be 0%; hard ceiling 10%)', 'Dev pegang 4.5% (must be 0%; hard ceiling 10%)'],
  ['Dev holds 12.3% — beyond hard ceiling', 'Dev pegang 12.3% — beyond hard ceiling'],
  ['Snipers hold 31.2% (ceiling 20%)', 'Sniper pegang 31.2% (ceiling 20%)'],
  [
    'Bundlers hold 25% and have not fully exited (sold 12.5%) — ceiling 20%',
    'Bundler masih pegang 25% dan belum keluar penuh (terjual 12.5%) — batas 20%',
  ],
  ['Bundlers hold 44.1% — above tolerated max 40%', 'Bundler pegang 44.1% — above tolerated max 40%'],
  ['Insiders hold 9.9% (ceiling 5%)', 'Insider pegang 9.9% (ceiling 5%)'],
  ['Mint authority unproven (must be disabled)', 'Mint authority belum terbukti mati'],
  ['Mint authority ENABLED — dev can inflate', 'Mint authority AKTIF — dev bisa mencetak token baru'],
  ['Freeze authority unproven (must be disabled)', 'Freeze authority belum terbukti mati'],
  ['Freeze authority ENABLED — holders can be frozen', 'Freeze authority AKTIF — holder bisa dibekukan'],
  ['Honeypot: sells are blocked', 'Honeypot — penjualan diblokir'],
  [
    'Honeypot status unproven (sell-side safety unknown)',
    'Status honeypot belum terbukti — keamanan sisi jual tidak diketahui',
  ],
  [
    'LP burn/lock unproven — no source measured it (not a breach, but never a pass)',
    'LP burn/lock belum terbukti — tidak ada sumber yang mengukurnya (bukan pelanggaran, tapi tidak pernah lolos)',
  ],
  ['LP only 12.3% burnt+locked — exit liquidity exposed', 'LP baru 12.3% dibakar+dikunci — likuiditas keluar terbuka'],
  ['LP burn only 4.5% — exit liquidity exposed', 'LP baru dibakar 4.5% — likuiditas keluar terbuka'],
  ['LP lock only 88% — exit liquidity exposed', 'LP baru dikunci 88% — likuiditas keluar terbuka'],
  ['Top-10 concentration unproven', 'Konsentrasi top-10 belum terbukti'],
  ['Insider share unproven', 'Porsi insider belum terbukti'],
  ['Sniper share unproven', 'Porsi sniper belum terbukti'],
  [
    'Bundler share unproven — launch cohort sold 44.4% of its position',
    'Porsi bundler belum terbukti — kohort peluncuran sudah keluar 44.4% dari posisinya',
  ],
  ['Bundler share unproven', 'Porsi bundler belum terbukti'],
  [
    'Top 1-3 holder identities unproven (2 of 3 known) — concentration unverifiable',
    'Identitas holder top 1-3 belum terbukti (2 dari 3 diketahui) — konsentrasi tidak bisa diverifikasi',
  ],
  [
    'Top 1-3 holder classification unproven — cannot rule out taint',
    'Klasifikasi holder top 1-3 belum terbukti — taint belum bisa disingkirkan',
  ],
  [
    'Top wallet 9xQeWv… is a sniper wallet (8.8%) — not a clean holder',
    'Wallet top 9xQeWv… adalah wallet sniper (8.8%) — bukan holder bersih',
  ],
  [
    'Top wallet ABCDEFGH… is a fresh wallet (4.2%) — not a clean holder',
    'Wallet top ABCDEFGH… adalah wallet fresh (4.2%) — bukan holder bersih',
  ],
  ['Dev holding unproven (must be 0%)', 'Porsi dev belum terbukti (harus 0%)'],
  [
    'Market cap is zero/unknown — ratio uncomputable',
    'Market cap nol/tidak diketahui — ratio tidak bisa dihitung',
  ],
  ['Volume unknown — momentum uncomputable', 'Volume tidak diketahui — momentum tidak bisa dihitung'],
  [
    'Bundlers hold 25% and their exit is unproven — ceiling 20%',
    'Bundler pegang 25% dan exit-nya belum terbukti — batas 20%',
  ],
  [
    '3 hard-rule breaches — Top 10 hold 31.2% (ceiling 25%)',
    '3 pelanggaran hard-rule — Top 10 pegang 31.2% (batas 25%)',
  ],
  [
    '2 hard-rule breaches — Bundlers hold 25% and their exit is unproven — ceiling 20%',
    '2 pelanggaran hard-rule — Bundler pegang 25% dan exit-nya belum terbukti — batas 20%',
  ],
  [
    'Setup is clean and volume is live (3.20x), but top holders sit on +260.0% — wait for the flush before entry',
    'Setup bersih dan volume hidup (3.20x), tapi holder teratas masih duduk di +260.0% — tunggu flush sebelum masuk',
  ],
  [
    'Screening passed but security evidence is incomplete — LP burn/lock unproven — no source measured it (not a breach, but never a pass) (not a rejection, but never a top signal on missing data)',
    'Screening lolos tapi bukti keamanan belum lengkap — LP burn/lock belum terbukti — tidak ada sumber yang mengukurnya (bukan pelanggaran, tapi tidak pernah lolos) (bukan penolakan, tapi tidak pernah jadi sinyal utama saat data hilang)',
  ],
  [
    'Clean distribution with top holders still accumulating (+12.5% avg PnL), 3.20x volume, plus confirmed smart money (7xKq9d2) — candidate for the downstream executor',
    'Distribusi bersih dengan holder teratas masih mengakumulasi (+12.5% avg PnL), volume 3.20x, plus smart money terkonfirmasi (7xKq9d2) — kandidat untuk executor hilir',
  ],
  [
    'All hard filters passed with live 3.20x volume, no concentrated exits, plus confirmed smart money (7xKq9d2) — candidate for the downstream executor',
    'Semua hard filter lolos dengan volume hidup 3.20x, tidak ada exit terkonsentrasi, plus smart money terkonfirmasi (7xKq9d2) — kandidat untuk executor hilir',
  ],
  [
    'Screening passed but no verified smart-money buyer — hold for wallet confirmation before it becomes a signal (volume 3.20x, accumulating)',
    'Screening lolos tapi belum ada pembeli smart-money terverifikasi — tahan sampai wallet terkonfirmasi sebelum jadi sinyal (volume 3.20x, akumulasi)',
  ],
  [
    'Hard filters clean, volume 3.20x, but no verified smart-money buyer — hold for wallet confirmation',
    'Hard filter bersih, volume 3.20x, tapi belum ada pembeli smart-money terverifikasi — tahan sampai wallet terkonfirmasi',
  ],
]

const REASONS: Array<[string, string]> = [
  ['security failure: honeypot', 'KEAMANAN GAGAL — honeypot'],
  ['core criterion failed: liquidity', 'Kriteria inti gagal — liquidity'],
  ['signal age 41m exceeds 30m freshness window', 'Usia sinyal 41m melewati jendela kesegaran 30m'],
  ['clean screen at 1.20x volume', 'Screening bersih di 1.20x volume'],
  ['3 confirmed buyer(s), strongest=ABCD…', '3 wallet terverifikasi, terkuat: ABCD…'],
  ['wallet evidence unavailable', 'Bukti wallet tidak tersedia'],
  [
    'wallet evidence could not be read — absence is not safety',
    'Bukti wallet tidak terbaca — ketiadaan bukti bukan berarti aman',
  ],
  ['source coverage incomplete', 'Cakupan sumber tidak lengkap'],
  ['no classified wallet holds this token', 'Tidak ada wallet terklasifikasi memegang token ini'],
  ['classified holders are not bullish or are stale', 'Wallet terklasifikasi tidak bullish atau sudah kadaluwarsa'],
  ['screening passed but essential evidence is missing', 'Screening lolos tapi bukti esensial masih hilang'],
  ['interesting but unconfirmed', 'Menarik tapi belum terkonfirmasi'],
]

describe('rejectionId', () => {
  it('translates every evaluator rejection template', () => {
    for (const [template, expected] of REJECTIONS) {
      expect(rejectionId(template), template).toBe(expected)
    }
  })

  it('renders substituted values in place and never leaks a literal placeholder', () => {
    for (const [template] of REJECTIONS) {
      expect(rejectionId(template), template).not.toMatch(/\$\d/)
    }
  })

  it('never rewrites an unmatched template', () => {
    const unknown = 'A brand new gate nobody translated yet'
    expect(rejectionId(unknown)).toBe(unknown)
  })

  it('keeps a fact the rule does not name, so a deviation is never hidden', () => {
    const rendered = rejectionId('Dev holds 7% (must be 0%; hard ceiling 10%)')
    expect(rendered).toContain('7%')
    expect(rendered).toContain('hard ceiling 10%')
  })

  it('leaves an unproven cohort exit ratio out of the sentence when unmeasured', () => {
    expect(rejectionId('Bundler share unproven')).not.toContain('%')
  })
})

describe('reasonId', () => {
  it('translates every tier reason template', () => {
    for (const [template, expected] of REASONS) {
      expect(reasonId(template), template).toBe(expected)
    }
  })

  it('passes an unknown reason through verbatim', () => {
    const unknown = 'a reason nobody translated'
    expect(reasonId(unknown)).toBe(unknown)
  })
})
