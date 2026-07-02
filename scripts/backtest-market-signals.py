#!/usr/bin/env python3
"""
Market-Moving Signal Backtest Engine
Tests signal forward-correlation against realized price moves.
Uses HuggingFace OpenMedallion dataset for historical data.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
import json

DATA_DIR = Path(__file__).parent.parent / "data" / "historical"

# ─── Data Loading ────────────────────────────────────────────

def load_btc_daily() -> pd.DataFrame:
    """Load BTC daily OHLCV data"""
    df = pd.read_parquet(DATA_DIR / "btc_daily.parquet")
    df['date'] = pd.to_datetime(df['timestamp'], unit='ms')
    df = df.sort_values('date').reset_index(drop=True)
    return df

def load_fear_greed() -> pd.DataFrame:
    """Load Fear & Greed Index"""
    df = pd.read_parquet(DATA_DIR / "fear_greed.parquet")
    return df

# ─── Signal Generators ──────────────────────────────────────

def compute_funding_proxy(df: pd.DataFrame) -> pd.Series:
    """
    Proxy for funding rate: price momentum vs volume
    High volume + price up = crowded long (positive funding proxy)
    """
    df = df.copy()
    df['price_change'] = df['close'].pct_change()
    df['volume_zscore'] = (df['volume'] - df['volume'].rolling(20).mean()) / df['volume'].rolling(20).std()
    # Funding proxy: positive = longs paying shorts
    df['funding_proxy'] = df['price_change'] * df['volume_zscore']
    return df['funding_proxy']

def compute_oi_proxy(df: pd.DataFrame) -> pd.Series:
    """
    Proxy for open interest: cumulative volume delta
    Rising CVD + rising price = fresh trend money
    """
    df = df.copy()
    df['cvd'] = (df['taker_buy_base'] - (df['volume'] - df['taker_buy_base'])).cumsum()
    df['oi_proxy'] = df['cvd'].pct_change(periods=5)
    return df['oi_proxy']

def compute_volatility_regime(df: pd.DataFrame) -> pd.Series:
    """
    ATR-based volatility regime: low/medium/high
    """
    df = df.copy()
    df['atr'] = (df['high'] - df['low']).rolling(14).mean()
    df['atr_pct'] = df['atr'] / df['close'] * 100
    df['vol_regime'] = pd.cut(df['atr_pct'], bins=[0, 2, 5, 100], labels=['low', 'medium', 'high'])
    return df['vol_regime']

def compute_momentum_score(df: pd.DataFrame) -> pd.Series:
    """
    RSI-based momentum score (0-100)
    """
    df = df.copy()
    delta = df['close'].diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / loss
    df['rsi'] = 100 - (100 / (1 + rs))
    return df['rsi']

def compute_composite_score(df: pd.DataFrame) -> pd.DataFrame:
    """
    Combine signals into composite score (0-100)
    """
    df = df.copy()
    df['funding_proxy'] = compute_funding_proxy(df)
    df['oi_proxy'] = compute_oi_proxy(df)
    df['rsi'] = compute_momentum_score(df)
    df['vol_regime'] = compute_volatility_regime(df)
    
    # Normalize each signal to 0-100
    def normalize(s, min_val=None, max_val=None):
        if min_val is None:
            min_val = s.min()
        if max_val is None:
            max_val = s.max()
        if max_val == min_val:
            return pd.Series(50, index=s.index)
        return ((s - min_val) / (max_val - min_val) * 100).clip(0, 100)
    
    df['funding_norm'] = normalize(df['funding_proxy'].rolling(20).mean())
    df['oi_norm'] = normalize(df['oi_proxy'].rolling(10).mean())
    df['momentum_norm'] = df['rsi']  # Already 0-100
    
    # Composite: weighted average
    df['composite'] = (
        df['funding_norm'].fillna(50) * 0.35 +
        df['oi_norm'].fillna(50) * 0.25 +
        df['momentum_norm'].fillna(50) * 0.25 +
        50 * 0.15  # Sentiment placeholder
    )
        # Calculate PnL as percentage
        if direction == 'bullish':
            pnl_pct = ((exit_price - entry_price) / entry_price) * 100
            max_pnl = ((max_price - entry_price) / entry_price) * 100
            min_pnl = ((min_price - entry_price) / entry_price) * 100
            win = exit_price > entry_price
        else:  # bearish
            pnl_pct = ((entry_price - exit_price) / entry_price) * 100
            max_pnl = ((entry_price - min_price) / entry_price) * 100
            min_pnl = ((entry_price - max_price) / entry_price) * 100
            win = exit_price < entry_price
            continue
        
        entry_price = row['close']
        direction = row['direction']
        
        if direction == 'neutral':
            continue
        
        # Check price movement over next N days
        future_prices = df.iloc[i+1:i+1+lookforward_days]['close']
        future_highs = df.iloc[i+1:i+1+lookforward_days]['high']
        future_lows = df.iloc[i+1:i+1+lookforward_days]['low']
        
        if len(future_prices) < lookforward_days:
            continue
        
        exit_price = future_prices.iloc[-1]
        max_price = future_highs.max()
        min_price = future_lows.min()
        
        # Calculate PnL
        if direction == 'bullish':
            pnl_pct = (exit_price - entry_price) / entry_price * 100
            max_pnl = (max_price - entry_price) / entry_price * 100
            min_pnl = (min_price - entry_price) / entry_price * 100
            win = exit_price > entry_price
        else:  # bearish
            pnl_pct = (entry_price - exit_price) / entry_price * 100
            max_pnl = (entry_price - min_price) / entry_price * 100
            min_pnl = (entry_price - max_price) / entry_price * 100
            win = exit_price < entry_price
        
        results.append({
            'date': row['date'],
            'direction': direction,
            'composite': row['composite'],
            'entry_price': entry_price,
            'exit_price': exit_price,
            'pnl_pct': pnl_pct,
            'max_pnl': max_pnl,
            'min_pnl': min_pnl,
            'win': win,
            'funding_norm': row.get('funding_norm', 50),
            'oi_norm': row.get('oi_norm', 50),
            'momentum_norm': row.get('momentum_norm', 50),
        })
    
    return pd.DataFrame(results)

def compute_stats(results: pd.DataFrame) -> dict:
    """Compute backtest statistics"""
    if len(results) == 0:
        return {'error': 'No signals to backtest'}
    
    wins = results['win'].sum()
    losses = len(results) - wins
    win_rate = wins / len(results) * 100
    
    avg_win = results[results['win']]['pnl_pct'].mean() if wins > 0 else 0
    avg_loss = results[~results['win']]['pnl_pct'].mean() if losses > 0 else 0
    
    # Profit factor
    gross_profit = results[results['win']]['pnl_pct'].sum() if wins > 0 else 0
    gross_loss = abs(results[~results['win']]['pnl_pct'].sum()) if losses > 0 else 0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')
    
    # Max drawdown
    cumulative = (1 + results['pnl_pct'] / 100).cumprod()
    peak = cumulative.cummax()
    drawdown = (peak - cumulative) / peak * 100
    max_drawdown = drawdown.max()
    
    # By direction
    bullish = results[results['direction'] == 'bullish']
    bearish = results[results['direction'] == 'bearish']
    
    return {
        'total_signals': len(results),
        'wins': int(wins),
        'losses': int(losses),
        'win_rate': round(win_rate, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'profit_factor': round(profit_factor, 2),
        'max_drawdown': round(max_drawdown, 2),
        'total_pnl': round(results['pnl_pct'].sum(), 2),
        'avg_pnl': round(results['pnl_pct'].mean(), 2),
        'bullish_signals': len(bullish),
        'bullish_win_rate': round(bullish['win'].mean() * 100, 2) if len(bullish) > 0 else 0,
        'bearish_signals': len(bearish),
        'bearish_win_rate': round(bearish['win'].mean() * 100, 2) if len(bearish) > 0 else 0,
    }

# ─── Walk-Forward Validation ────────────────────────────────

def walk_forward_validate(df: pd.DataFrame, train_pct: float = 0.7) -> dict:
    """
    Split data into train/test and validate
    """
    split_idx = int(len(df) * train_pct)
    train = df.iloc[:split_idx]
    test = df.iloc[split_idx:]
    
    # Backtest on both periods
    train_results = backtest_signals(train)
    test_results = backtest_signals(test)
    
    train_stats = compute_stats(train_results)
    test_stats = compute_stats(test_results)
    
    return {
        'train': {
            'period': f"{train.iloc[0]['date']} to {train.iloc[-1]['date']}",
            'samples': len(train),
            **train_stats
        },
        'test': {
            'period': f"{test.iloc[0]['date']} to {test.iloc[-1]['date']}",
            'samples': len(test),
            **test_stats
        },
        'overfitting_risk': abs(train_stats.get('win_rate', 0) - test_stats.get('win_rate', 0)) > 15
    }

# ─── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("MARKET-MOVING SIGNAL BACKTEST")
    print("=" * 60)
    
    # Load data
    print("\nLoading BTC daily data...")
    df = load_btc_daily()
    print(f"  Loaded {len(df)} candles: {df.iloc[0]['date']} to {df.iloc[-1]['date']}")
    
    # Compute signals
    print("\nComputing signals...")
    df = compute_composite_score(df)
    
    # Backtest
    print("\nRunning backtest (7-day forward)...")
    results = backtest_signals(df, lookforward_days=7)
    stats = compute_stats(results)
    
    print("\n" + "=" * 60)
    print("BACKTEST RESULTS (7-day forward)")
    print("=" * 60)
    for k, v in stats.items():
        print(f"  {k}: {v}")
    
    # Walk-forward validation
    print("\n" + "=" * 60)
    print("WALK-FORWARD VALIDATION")
    print("=" * 60)
    wf = walk_forward_validate(df)
    
    print("\n  TRAIN SET:")
    for k, v in wf['train'].items():
        print(f"    {k}: {v}")
    
    print("\n  TEST SET:")
    for k, v in wf['test'].items():
        print(f"    {k}: {v}")
    
    print(f"\n  Overfitting risk: {'HIGH' if wf['overfitting_risk'] else 'LOW'}")
    
    # Save results
    output = {
        'backtest_stats': stats,
        'walk_forward': wf,
        'generated_at': datetime.now().isoformat()
    }
    
    output_path = Path(__file__).parent.parent / "data" / "backtest_results.json"
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, default=str)
    
    print(f"\n✅ Results saved to {output_path}")
