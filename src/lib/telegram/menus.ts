// NEXUS Telegram Bot — inline keyboards per domain.

import { keyboard, type Button } from './core'

export const MAIN_MENU = keyboard([
  [{ text: '📊 Market Overview', callback_data: 'menu:market' }, { text: '🐋 Whale Intel', callback_data: 'menu:whale' }],
  [{ text: '💹 Trading', callback_data: 'menu:trading' }, { text: '🧠 Smart Money', callback_data: 'menu:smart' }],
  [{ text: '⛽ Gas & Network', callback_data: 'menu:network' }, { text: '📡 Signals', callback_data: 'menu:signals' }],
  [{ text: '📰 News & Macro', callback_data: 'menu:intel' }, { text: '🔔 Alerts', callback_data: 'menu:alerts' }],
  [{ text: '📊 Bot Status', callback_data: 'act:status' }, { text: '❓ Help', callback_data: 'act:help' }],
])

export const BACK_ROW: Button[] = [{ text: '🔙 Back', callback_data: 'menu:main' }]
export const MARKET_MENU = keyboard([
  [{ text: '🔥 Fear & Greed', callback_data: 'data:fear-greed' }, { text: '💲 Top Prices', callback_data: 'data:prices' }],
  [{ text: '📈 Sectors', callback_data: 'data:sectors' }, { text: '🌐 Macro', callback_data: 'data:macro' }],
  [{ text: '📊 Correlations', callback_data: 'data:correlations' }, { text: '💱 Forex', callback_data: 'data:forex' }],
  [{ text: '🏦 Equities', callback_data: 'data:equities' }, { text: '🌾 Commodities', callback_data: 'data:commodities' }],
  BACK_ROW,
])

export const WHALE_MENU = keyboard([
  [{ text: '🐋 Whale Clusters', callback_data: 'data:whale-cluster' }, { text: '💰 Exchange Flows', callback_data: 'data:exchange-flow' }],
  [{ text: '📡 Mempool Radar', callback_data: 'data:mempool' }, { text: '🔍 Insider Detector', callback_data: 'data:insider' }],
  [{ text: '🏦 Entities', callback_data: 'data:entities' }],
  BACK_ROW,
])

export const TRADING_MENU = keyboard([
  [{ text: '📊 Derivatives', callback_data: 'data:derivatives' }, { text: '💦 Liquidations', callback_data: 'data:liquidations' }],
  [{ text: '🔄 DEX Monitor', callback_data: 'data:dex' }, { text: '📡 New Pairs', callback_data: 'data:scanner' }],
  [{ text: '🪙 Tokens', callback_data: 'data:tokens' }, { text: '🔍 Token Search', callback_data: 'act:token-search' }],
  BACK_ROW,
])

export const SMART_MENU = keyboard([
  [{ text: '🧠 Smart Money', callback_data: 'data:smart-money' }, { text: '📋 Copy Trades', callback_data: 'data:copy-trade' }],
  [{ text: '📈 Edge Report', callback_data: 'data:edge-report' }, { text: '📊 Signal Confidence', callback_data: 'data:signal-confidence' }],
  BACK_ROW,
])

export const NETWORK_MENU = keyboard([
  [{ text: '⛽ Gas Tracker', callback_data: 'data:gas' }, { text: '📡 Mempool Stats', callback_data: 'data:mempool-stats' }],
  [{ text: '🔗 Stablecoins', callback_data: 'data:stablecoins' }, { text: '📊 DeFi TVL', callback_data: 'data:defi-tvl' }],
  [{ text: '💰 DeFi Yields', callback_data: 'data:defi-yields' }],
  BACK_ROW,
])

export const SAFETY_MENU = keyboard([
  [{ text: '🛡 RugCheck', callback_data: 'act:rugcheck' }, { text: '📊 System Status', callback_data: 'data:status' }],
  BACK_ROW,
])

export const INTEL_MENU = keyboard([
  [{ text: '📰 News Feed', callback_data: 'data:news' }, { text: '🌤 Weather Signals', callback_data: 'data:weather' }],
  [{ text: '📊 Alt Data', callback_data: 'data:alt-data' }, { text: '📰 Feed Sources', callback_data: 'data:feeds' }],
  BACK_ROW,
])

export const SIGNALS_MENU = keyboard([
  [{ text: '📡 Latest Signals', callback_data: 'data:signals' }],
  [{ text: '🔔 Subscribe Signals', callback_data: 'act:signal-sub' }, { text: '🔕 Unsubscribe', callback_data: 'act:signal-unsub' }],
  BACK_ROW,
])

export const ALERTS_MENU = keyboard([
  [{ text: '🔔 My Alerts', callback_data: 'data:alerts' }, { text: '📋 Templates', callback_data: 'data:alert-templates' }],
  [{ text: '➕ Create Alert', callback_data: 'act:create-alert' }],
  BACK_ROW,
])

export const MENU_MAP: Record<string, { inline_keyboard: Button[][] }> = {
  main: MAIN_MENU,
  market: MARKET_MENU,
  whale: WHALE_MENU,
  trading: TRADING_MENU,
  smart: SMART_MENU,
  network: NETWORK_MENU,
  safety: SAFETY_MENU,
  intel: INTEL_MENU,
  alerts: ALERTS_MENU,
  signals: SIGNALS_MENU,
}
