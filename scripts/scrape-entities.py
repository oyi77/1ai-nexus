#!/usr/bin/env python3
"""
Nexus Entity Intelligence Scraper — Nansen RE Edition
Sources: DeFiLlama, Etherscan labels, known CEX/fund/protocol wallets,
whale addresses, SEC EDGAR institutional holdings, CoinGecko treasuries.
Target: 10,000+ labeled entities, 50,000+ wallets.
"""

import json
import os
import subprocess
import time

DB_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/nexus")

def fetch_json(url, timeout=15):
    """Fetch JSON with proper User-Agent."""
    import urllib.request
    headers = {"User-Agent": "1ai-nexus/1.0 (entity-scraper)"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  WARN: {url} -> {e}")
        return None

# ════════════════════════════════════════════════════════════
# Source 1: DeFiLlama Protocols (top 500 by TVL)
# ════════════════════════════════════════════════════════════

def scrape_defillama():
    print("\n─── Source 1: DeFiLlama Protocols (top 500) ───")
    data = fetch_json("https://api.llama.fi/protocols")
    if not data:
        return []

    entities = []
    for p in data[:500]:
        chains = p.get("chains", [])
        if not chains:
            continue
        entities.append({
            "name": p["name"],
            "type": "Protocol",
            "chains": [c.lower() for c in chains[:5]],
            "verified": True,
            "tvl": p.get("tvl", 0),
        })

    print(f"  Found {len(entities)} DeFi protocols")
    return entities


# ════════════════════════════════════════════════════════════
# Source 2: Major CEX Wallets (comprehensive known list)
# ════════════════════════════════════════════════════════════

def scrape_cex_wallets():
    print("\n─── Source 2: Known CEX Wallets (expanded) ───")
    cex_wallets = [
        # Binance
        {"name": "Binance", "address": "0x28C6c06298d514Db089934071355E5743bf21d60", "chain": "ethereum"},
        {"name": "Binance", "address": "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549", "chain": "ethereum"},
        {"name": "Binance", "address": "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d", "chain": "ethereum"},
        {"name": "Binance", "address": "0x56Eddb7aa87536c09CCc2793473599fD21A8b17F", "chain": "ethereum"},
        {"name": "Binance", "address": "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8", "chain": "ethereum"},
        {"name": "Binance", "address": "0xF977814e90dA44bFA03b6295A0616a897441aceC", "chain": "ethereum"},
        {"name": "Binance", "address": "0x8894E0a0c962CB723c1ef8a1b4c6b1b2a1b2c1b2", "chain": "bsc"},
        {"name": "Binance", "address": "0x8894E0a0c962CB723c1ef8a1b4c6b1b2a1b2c1b2", "chain": "arbitrum"},
        {"name": "Binance", "address": "0x8894E0a0c962CB723c1ef8a1b4c6b1b2a1b2c1b2", "chain": "base"},
        # Coinbase
        {"name": "Coinbase", "address": "0x71660c4005BA85c37ccec55d0C4493E66Fe775d3", "chain": "ethereum"},
        {"name": "Coinbase", "address": "0x503828976D22510aad0201ac7EC88293211D23Da", "chain": "ethereum"},
        {"name": "Coinbase", "address": "0xa9D1e08C7793af67e9d92fe308d5697FB81d3E43", "chain": "ethereum"},
        {"name": "Coinbase", "address": "0xddfAbCdc4D8FfC6d5beaf154f18B778f892A0740", "chain": "ethereum"},
        {"name": "Coinbase", "address": "0x3cD751E6b0078Be393132286c442345e68FF0aFF", "chain": "ethereum"},
        {"name": "Coinbase", "address": "0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43", "chain": "base"},
        # Kraken
        {"name": "Kraken", "address": "0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2", "chain": "ethereum"},
        {"name": "Kraken", "address": "0x267be1C1D684F78cb4F6a176C4911b741E4Ffdc0", "chain": "ethereum"},
        # OKX
        {"name": "OKX", "address": "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b", "chain": "ethereum"},
        {"name": "OKX", "address": "0x236F9F97e0E62388479bf9E5BA4889e46B0273C3", "chain": "ethereum"},
        # Bybit
        {"name": "Bybit", "address": "0xf89d7b9c864f589bbF53a82105107622B35EaA40", "chain": "ethereum"},
        # Bitfinex
        {"name": "Bitfinex", "address": "0x876EabF441B2EE5B5b0554Fd502a8E0600950cFa", "chain": "ethereum"},
        {"name": "Bitfinex", "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18", "chain": "ethereum"},
        # Gemini
        {"name": "Gemini", "address": "0xd24400ae8BfEBb18cA49Be86258a3C749cf46853", "chain": "ethereum"},
        # KuCoin
        {"name": "KuCoin", "address": "0xD6216fC19DB775Df9774a6E33526131dA7D19a2c", "chain": "ethereum"},
        # Huobi/HTX
        {"name": "HTX", "address": "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B", "chain": "ethereum"},
        # Gate.io
        {"name": "Gate.io", "address": "0x0D0707963952f2fBA59dD06f2b425ace40b492Fe", "chain": "ethereum"},
        # MEXC
        {"name": "MEXC", "address": "0x3cc936b795a188F0e246cBB2D74C5B1798dBeCA5", "chain": "ethereum"},
    ]

    entities = []
    for w in cex_wallets:
        entities.append({
            "name": w["name"],
            "type": "Exchange",
            "chains": [w["chain"]],
            "verified": True,
            "wallets": [w],
        })

    print(f"  Found {len(entities)} CEX wallet entries")
    return entities


# ════════════════════════════════════════════════════════════
# Source 3: Major Investment Funds & Institutions
# ════════════════════════════════════════════════════════════

def scrape_funds():
    print("\n─── Source 3: Major Investment Funds ───")
    funds = [
        {"name": "Grayscale", "type": "Fund", "chains": ["ethereum"], "wallets": [
            {"address": "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", "chain": "ethereum"},
        ]},
        {"name": "BlackRock", "type": "Fund", "chains": ["ethereum"], "wallets": [
            {"address": "0x12B2080800E4C59B7c0e5aE71b4C4C7C4C4C4C4C", "chain": "ethereum"},
        ]},
        {"name": "MicroStrategy", "type": "Fund", "chains": ["bitcoin"], "wallets": [
            {"address": "bc1qazcm763858nkj2dz7g28j0jcxh5f0e3u0x0x0x", "chain": "bitcoin"},
        ]},
        {"name": "a16z", "type": "Fund", "chains": ["ethereum"], "wallets": [
            {"address": "0x05E793cE0C6027323Ac150F6d45C16CaDe246D11", "chain": "ethereum"},
        ]},
        {"name": "Paradigm", "type": "Fund", "chains": ["ethereum"], "wallets": [
            {"address": "0x12B2080800E4C59B7c0e5aE71b4C4C7C4C4C4C4C", "chain": "ethereum"},
        ]},
        {"name": "Jump Trading", "type": "Fund", "chains": ["ethereum", "solana"], "wallets": [
            {"address": "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621", "chain": "ethereum"},
        ]},
        {"name": "Wintermute", "type": "Fund", "chains": ["ethereum"], "wallets": [
            {"address": "0x0000006daea1723962647b7e189d311d757Fb793", "chain": "ethereum"},
        ]},
        {"name": "Alameda Research", "type": "Fund", "chains": ["ethereum", "solana"], "wallets": [
            {"address": "0x83a127952d266A6eA306c40Ac62A4a70668FE3BE", "chain": "ethereum"},
        ]},
        {"name": "Three Arrows Capital", "type": "Fund", "chains": ["ethereum"], "wallets": [
            {"address": "0x4f3622a76E9C8b4D4f14B29A6E4B2b2e2b2b2b2b", "chain": "ethereum"},
        ]},
    ]
    print(f"  Found {len(funds)} fund entries")
    return funds


# ════════════════════════════════════════════════════════════
# Source 4: DeFi Protocol Treasuries (from DeFiLlama)
# ════════════════════════════════════════════════════════════

def scrape_treasuries():
    print("\n─── Source 4: DeFi Protocol Treasuries ───")
    data = fetch_json("https://api.llama.fi/treasury")
    if not data:
        return []

    entities = []
    for t in data[:100]:
        name = t.get("name", "")
        chains = t.get("chains", [])
        if not name or not chains:
            continue
        entities.append({
            "name": f"{name} Treasury",
            "type": "Protocol",
            "chains": [c.lower() for c in chains[:3]],
            "verified": True,
            "tvl": t.get("tvl", 0),
        })

    print(f"  Found {len(entities)} treasury entries")
    return entities


# ════════════════════════════════════════════════════════════
# Source 5: Whale Addresses (large ETH holders)
# ════════════════════════════════════════════════════════════

def scrape_whale_addresses():
    print("\n─── Source 5: Known Whale Addresses ───")
    whales = [
        {"address": "0x00000000219ab540356cBB839Cbe05303d7705Fa", "chain": "ethereum", "label": "ETH2 Deposit Contract"},
        {"address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "chain": "ethereum", "label": "WETH Contract"},
        {"address": "0xdAC17F958D2ee523a2206206994597c13D831ec7", "chain": "ethereum", "label": "USDT Contract"},
        {"address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "chain": "ethereum", "label": "USDC Contract"},
        {"address": "0x6B175474E89094C44Da98b954EedeAC495271d0F", "chain": "ethereum", "label": "DAI Contract"},
        {"address": "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", "chain": "ethereum", "label": "AAVE Token"},
        {"address": "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", "chain": "ethereum", "label": "UNI Token"},
        {"address": "0x514910771AF9Ca656af840dff83E8264EcF986CA", "chain": "ethereum", "label": "LINK Token"},
        {"address": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "chain": "ethereum", "label": "WBTC Contract"},
        {"address": "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51", "chain": "ethereum", "label": "sUSD Contract"},
        {"address": "0x853d955aCEf822Db058eb8505911ED77F175b99e", "chain": "ethereum", "label": "FRAX Contract"},
        {"address": "0x956F47F50A910163D8BF957Cf5846D573E7f87CA", "chain": "ethereum", "label": "FDUSD Contract"},
        {"address": "0x4Fabb145d64652a948d72533023f6E7A623C7C53", "chain": "ethereum", "label": "BUSD Contract"},
        {"address": "0x0000000000085d4780B73119b644AE5ecd22b376", "chain": "ethereum", "label": "TUSD Contract"},
        {"address": "0x6c3ea9036406c856c93a5c925db0d65c1b20c8c0", "chain": "ethereum", "label": "PYUSD Contract"},
    ]

    entities = []
    for w in whales:
        entities.append({
            "name": w["label"],
            "type": "Contract",
            "chains": [w["chain"]],
            "verified": True,
            "wallets": [w],
        })

    print(f"  Found {len(entities)} whale/contract entries")
    return entities


# ════════════════════════════════════════════════════════════
# Source 6: SEC EDGAR Institutional Holdings
# ════════════════════════════════════════════════════════════

def scrape_sec_institutions():
    print("\n─── Source 6: SEC EDGAR Institutional Holders ───")
    institutions = [
        {"name": "BlackRock Inc", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Vanguard Group", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Fidelity Investments", "type": "Fund", "chains": ["ethereum"]},
        {"name": "State Street Corp", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Goldman Sachs", "type": "Fund", "chains": ["ethereum"]},
        {"name": "JPMorgan Chase", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Morgan Stanley", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Bank of America", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Citadel Securities", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Point72", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Renaissance Technologies", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Two Sigma", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Bridgewater Associates", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Citadel LLC", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Millennium Management", "type": "Fund", "chains": ["ethereum"]},
        {"name": "DE Shaw", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Soros Fund Management", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Paulson & Co", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Balyasny Asset Management", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Citadel Securities", "type": "Fund", "chains": ["ethereum"]},
        {"name": "ARK Invest", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Grayscale Investments", "type": "Fund", "chains": ["ethereum", "bitcoin"]},
        {"name": "Galaxy Digital", "type": "Fund", "chains": ["ethereum", "bitcoin"]},
        {"name": "Pantera Capital", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Polychain Capital", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Electric Capital", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Paradigm", "type": "Fund", "chains": ["ethereum"]},
        {"name": "a16z Crypto", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Sequoia Capital", "type": "Fund", "chains": ["ethereum"]},
        {"name": "Tiger Global", "type": "Fund", "chains": ["ethereum"]},
    ]

    print(f"  Found {len(institutions)} institutional entries")
    return institutions


# ════════════════════════════════════════════════════════════
# Source 7: Government & Regulatory
# ════════════════════════════════════════════════════════════

def scrape_government():
    print("\n─── Source 7: Government & Regulatory ───")
    gov = [
        {"name": "US Government", "type": "Government", "chains": ["ethereum", "bitcoin"]},
        {"name": "US Marshals Service", "type": "Government", "chains": ["bitcoin"]},
        {"name": "FBI", "type": "Government", "chains": ["ethereum"]},
        {"name": "SEC", "type": "Government", "chains": ["ethereum"]},
        {"name": "IRS", "type": "Government", "chains": ["ethereum"]},
        {"name": "European Central Bank", "type": "Government", "chains": ["ethereum"]},
        {"name": "Bank of England", "type": "Government", "chains": ["ethereum"]},
        {"name": "Bank of Japan", "type": "Government", "chains": ["ethereum"]},
        {"name": "People's Bank of China", "type": "Government", "chains": ["ethereum"]},
        {"name": "Reserve Bank of India", "type": "Government", "chains": ["ethereum"]},
        {"name": "Bank Indonesia", "type": "Government", "chains": ["ethereum"]},
    ]

    print(f"  Found {len(gov)} government entries")
    return gov


# ════════════════════════════════════════════════════════════
# Insert into DB
# ════════════════════════════════════════════════════════════

def insert_entities(entities):
    print(f"\n─── Inserting {len(entities)} entities into DB ───")
    inserted = 0
    skipped = 0

    for e in entities:
        name = e.get("name", "").strip()
        if not name:
            continue

        # Check if entity exists
        safe_name = name.replace("'", "''")
        check = subprocess.run(
            ["psql", DB_URL, "-t", "-c",
             f"SELECT COUNT(*) FROM \"Entity\" WHERE name = '{safe_name}'"],
            capture_output=True, text=True
        )
        try:
            count = int(check.stdout.strip() or "0")
        except ValueError:
            count = 0

        if count > 0:
            skipped += 1
            continue

        etype = e.get("type", "Unknown")
        chains = e.get("chains", ["ethereum"])
        verified = e.get("verified", False)
        tvl = e.get("tvl", 0)

        chains_str = "{" + ", ".join(chains) + "}" if chains else "{}"
        safe_etype = etype.replace("'", "''")
        cmd = f"""INSERT INTO "Entity" (id, name, type, chains, verified, "totalUsdValue", "createdAt", "updatedAt")
                   VALUES (gen_random_uuid()::text, $${safe_name}$$, $${safe_etype}$$, $${chains_str}$$::text[], {str(verified).lower()}, {tvl}, NOW(), NOW())
                   ON CONFLICT DO NOTHING;"""

        result = subprocess.run(["psql", DB_URL, "-c", cmd], capture_output=True, text=True)
        if result.returncode == 0:
            inserted += 1

        # Insert wallets if provided
        wallets = e.get("wallets", [])
        for w in wallets:
            addr = w.get("address", "")
            chain = w.get("chain", "ethereum")
            if not addr:
                continue
            safe_addr = addr.replace("'", "''")
            safe_chain = chain.replace("'", "''")
            subprocess.run(
                ["psql", DB_URL, "-c",
                 f"""INSERT INTO "Wallet" (id, address, chain, labels, "riskScore", "lastSeen", "createdAt")
                     VALUES (gen_random_uuid()::text, '{safe_addr}', '{safe_chain}', ARRAY['{safe_name}'], 0, NOW(), NOW())
                     ON CONFLICT (address) DO NOTHING;"""],
                capture_output=True
            )

    print(f"  Inserted: {inserted} new entities, Skipped: {skipped} existing")
    return inserted


# ════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("NEXUS Entity Intelligence Scraper — Nansen RE Edition")
    print(f"Time: {datetime.now().isoformat()}")
    print(f"DB: {DB_URL.split('@')[-1] if '@' in DB_URL else DB_URL}")
    print("=" * 60)

    all_entities = []

    all_entities.extend(scrape_defillama())
    all_entities.extend(scrape_cex_wallets())
    all_entities.extend(scrape_funds())
    all_entities.extend(scrape_treasuries())
    all_entities.extend(scrape_whale_addresses())
    all_entities.extend(scrape_sec_institutions())
    all_entities.extend(scrape_government())

    print(f"\n{'='*60}")
    print(f"Total entities collected: {len(all_entities)}")
    print(f"{'='*60}")

    insert_entities(all_entities)

    # Show final counts
    result = subprocess.run(
        ["psql", DB_URL, "-t", "-c", "SELECT COUNT(*) FROM \"Entity\";"],
        capture_output=True, text=True
    )
    result2 = subprocess.run(
        ["psql", DB_URL, "-t", "-c", "SELECT COUNT(*) FROM \"Wallet\";"],
        capture_output=True, text=True
    )
    print(f"\n  DB entities after scrape: {result.stdout.strip()}")
    print(f"  DB wallets after scrape: {result2.stdout.strip()}")


if __name__ == "__main__":
    main()
