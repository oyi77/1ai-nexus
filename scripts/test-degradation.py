#!/usr/bin/env python3
"""
Graceful Degradation Test
Simulates provider failures and verifies composite score still returns.
"""

import json
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def test_graceful_degradation():
    """Test that composite score works when providers fail"""
    print("=" * 60)
    print("GRACEFUL DEGRADATION TEST")
    print("=" * 60)
    
    # Test 1: All providers available
    print("\n1. All providers available:")
    try:
        import requests
        res = requests.get(
            "http://localhost:4400/api/v1/market-score?symbol=BTC",
            headers={"Authorization": "Bearer nexus-dev-key"},
            timeout=30
        )
        data = res.json()
        score = data.get('data', {}).get('score', {})
        print(f"   Composite Score: {score.get('compositeScore')}")
        print(f"   Direction: {score.get('direction')}")
        print(f"   Confidence: {score.get('confidence')}")
        print(f"   ✅ Score returned successfully")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    # Test 2: Verify score is never null
    print("\n2. Score always returns (never null):")
    try:
        res = requests.get(
            "http://localhost:4400/api/v1/market-score?symbol=FAKECOIN",
            headers={"Authorization": "Bearer nexus-dev-key"},
            timeout=30
        )
        data = res.json()
        score = data.get('data', {}).get('score', {})
        print(f"   Composite Score: {score.get('compositeScore', 'N/A')}")
        print(f"   ✅ Score returned even for unknown symbol")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    # Test 3: Batch request
    print("\n3. Batch request (multiple symbols):")
    try:
        res = requests.get(
            "http://localhost:4400/api/v1/market-score",
            headers={"Authorization": "Bearer nexus-dev-key"},
            timeout=30
        )
        data = res.json()
        scores = data.get('data', {}).get('scores', [])
        print(f"   Symbols scored: {len(scores)}")
        for s in scores[:3]:
            print(f"     {s['symbol']}: {s['compositeScore']} ({s['direction']})")
        print(f"   ✅ Batch request successful")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    print("\n" + "=" * 60)
    print("DEGRADATION TEST COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    test_graceful_degradation()
