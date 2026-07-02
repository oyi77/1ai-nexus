#!/usr/bin/env python3
"""
Signal Redundancy Pruning
Analyzes pairwise correlation between signals to identify redundant ones.
"""

import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data" / "historical"

def compute_signal_correlations():
    """Compute pairwise correlation between all signal types"""
    df = pd.read_parquet(DATA_DIR / "btc_daily.parquet")
    df = df[df['symbol'] == 'BTCUSDT'].copy()
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # Compute all signals
    df['price_change'] = df['close'].pct_change()
    df['volume_zscore'] = (df['volume'] - df['volume'].rolling(20).mean()) / df['volume'].rolling(20).std()
    df['funding_proxy'] = df['price_change'] * df['volume_zscore'].fillna(0)
    
    delta = df['close'].diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / loss
    df['rsi'] = 100 - (100 / (1 + rs))
    
    df['atr'] = (df['high'] - df['low']).rolling(14).mean()
    df['atr_pct'] = df['atr'] / df['close'] * 100
    
    df['momentum'] = df['close'].pct_change(periods=5)
    df['volatility'] = df['close'].rolling(20).std() / df['close'] * 100
    
    # Select signal columns
    signal_cols = ['funding_proxy', 'rsi', 'atr_pct', 'momentum', 'volatility', 'volume_zscore']
    signals = df[signal_cols].dropna()
    
    # Compute correlation matrix
    corr = signals.corr()
    
    print("=" * 60)
    print("SIGNAL CORRELATION MATRIX")
    print("=" * 60)
    print(corr.round(2).to_string())
    
    # Find highly correlated pairs
    print("\n" + "=" * 60)
    print("HIGHLY CORRELATED PAIRS (|r| > 0.7)")
    print("=" * 60)
    
    redundant = []
    for i in range(len(signal_cols)):
        for j in range(i+1, len(signal_cols)):
            r = corr.iloc[i, j]
            if abs(r) > 0.7:
                redundant.append((signal_cols[i], signal_cols[j], r))
                print(f"  {signal_cols[i]} <-> {signal_cols[j]}: {r:.3f}")
    
    if not redundant:
        print("  No highly correlated pairs found")
    
    print(f"\nRecommendation: {'Prune redundant signals' if redundant else 'All signals are independent'}")
    
    return corr, redundant

if __name__ == "__main__":
    compute_signal_correlations()
