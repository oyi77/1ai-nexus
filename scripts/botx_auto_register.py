#!/usr/bin/env python3
"""
BotX Health Monitor & Key Manager

Since temp email services are unreliable for automated registration,
this script focuses on:
1. Health monitoring with Telegram alerts
2. Manual key import via CLI
3. Background monitoring loop

Usage:
    python3 scripts/botx_auto_register.py --health      Check key health
    python3 scripts/botx_auto_register.py --monitor     Start monitoring loop
    python3 scripts/botx_auto_register.py --add-key KEY Add a key manually
"""

import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# ── Config ───────────────────────────────────────────────────

DB_PATH = Path(__file__).parent.parent / "data" / "botx-keys.sqlite"
MIN_HEALTHY_KEYS = 2
CHECK_INTERVAL_MS = 5 * 60 * 1000  # 5 minutes

# ── Telegram Alert ───────────────────────────────────────────

def send_telegram_alert(message: str):
    """Send alert via Telegram bot."""
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_ALERT_CHAT_ID")
    
    if not bot_token or not chat_id:
        print(f"  ⚠️ Telegram not configured. Alert: {message}")
        return
    
    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        data = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            if result.get("ok"):
                print(f"  ✅ Telegram alert sent")
            else:
                print(f"  ❌ Telegram error: {result}")
    except Exception as e:
        print(f"  ❌ Telegram send failed: {e}")

# ── Health Check ─────────────────────────────────────────────

def check_key_health(api_key: str) -> dict:
    """Check if a BotX key is healthy."""
    try:
        req = urllib.request.Request(
            "https://api-data-v1.dbotx.com/kline/new?chain=solana&limit=1",
            headers={
                "x-api-key": api_key,
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"healthy": True, "status": resp.status}
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return {"healthy": False, "status": 429, "error": "rate limited"}
        if e.code == 403:
            return {"healthy": False, "status": 403, "error": "forbidden - key invalid"}
        return {"healthy": False, "status": e.code, "error": str(e)}
    except Exception as e:
        return {"healthy": False, "status": 0, "error": str(e)}

# ── Key Store ────────────────────────────────────────────────

def init_db():
    """Initialize the key store."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS botx_keys (
            id TEXT PRIMARY KEY,
            api_key TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_used INTEGER NOT NULL,
            last_checked INTEGER NOT NULL,
            is_healthy INTEGER NOT NULL DEFAULT 1,
            rate_limited INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            request_count INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.commit()
    return conn

def add_key(api_key: str, email: str = "manual"):
    """Add a key to the store."""
    import hashlib
    
    conn = init_db()
    key_id = hashlib.sha256(api_key.encode()).hexdigest()[:16]
    now = int(time.time() * 1000)
    
    conn.execute(
        "INSERT OR REPLACE INTO botx_keys (id, api_key, email, created_at, last_used, last_checked, is_healthy, rate_limited) VALUES (?, ?, ?, ?, ?, ?, 1, 0)",
        (key_id, api_key, email, now, now, now)
    )
    conn.commit()
    conn.close()
    
    return key_id

def get_all_keys():
    """Get all keys from store."""
    if not DB_PATH.exists():
        return []
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute("SELECT id, api_key, email, is_healthy, rate_limited, error_count, request_count FROM botx_keys")
    keys = cursor.fetchall()
    conn.close()
    
    return keys

# ── Monitor Loop ─────────────────────────────────────────────

def monitor_loop():
    """Background monitoring loop with Telegram alerts."""
    print(f"BotX Health Monitor started")
    print(f"  Check interval: {CHECK_INTERVAL_MS / 60000:.0f} minutes")
    print(f"  Min healthy keys: {MIN_HEALTHY_KEYS}")
    print(f"  DB: {DB_PATH}")
    
    while True:
        try:
            keys = get_all_keys()
            
            if not keys:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] No keys in store")
                send_telegram_alert("⚠️ <b>BotX Key Alert</b>\n\nNo keys in store! Add keys via:\n<code>python3 scripts/botx_auto_register.py --add-key YOUR_KEY</code>")
                time.sleep(CHECK_INTERVAL_MS)
                continue
            
            healthy = 0
            rate_limited = 0
            unhealthy = 0
            
            for key_id, api_key, email, is_healthy, rate_limited_flag, error_count, request_count in keys:
                result = check_key_health(api_key)
                if result["healthy"]:
                    healthy += 1
                elif result.get("status") == 429:
                    rate_limited += 1
                else:
                    unhealthy += 1
            
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Keys: {len(keys)} total, {healthy} healthy, {rate_limited} rate limited, {unhealthy} unhealthy")
            
            # Alert if healthy keys are below minimum
            if healthy < MIN_HEALTHY_KEYS:
                message = f"🚨 <b>BotX Key Alert</b>\n\n"
                message += f"Only {healthy} healthy keys remaining!\n"
                message += f"Rate limited: {rate_limited}\n"
                message += f"Unhealthy: {unhealthy}\n\n"
                message += f"Add new keys via:\n<code>python3 scripts/botx_auto_register.py --add-key YOUR_KEY</code>"
                send_telegram_alert(message)
            
            # Alert if any key is rate limited
            if rate_limited > 0:
                message = f"⚠️ <b>BotX Rate Limit</b>\n\n"
                message += f"{rate_limited} key(s) rate limited.\n"
                message += f"Healthy: {healthy}/{len(keys)}"
                send_telegram_alert(message)
            
        except Exception as e:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Monitor error: {e}")
        
        time.sleep(CHECK_INTERVAL_MS)

# ── CLI ──────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="BotX Health Monitor & Key Manager")
    parser.add_argument("--health", action="store_true", help="Check key health")
    parser.add_argument("--monitor", action="store_true", help="Start monitoring loop")
    parser.add_argument("--add-key", type=str, help="Manually add an API key")
    parser.add_argument("--email", type=str, default="manual", help="Email for the key")
    args = parser.parse_args()
    
    if args.add_key:
        key_id = add_key(args.add_key, args.email)
        print(f"✅ Key added: {key_id}")
        return
    
    if args.health:
        keys = get_all_keys()
        if not keys:
            print("No keys in store")
            return
        
        print(f"\n{len(keys)} keys in store:\n")
        for key_id, api_key, email, is_healthy, rate_limited, error_count, request_count in keys:
            result = check_key_health(api_key)
            status = "✅ healthy" if result["healthy"] else f"❌ {result.get('error', 'unhealthy')}"
            print(f"  {key_id[:8]}... | {email[:30]:30} | {status}")
        return
    
    if args.monitor:
        monitor_loop()
        return
    
    parser.print_help()

if __name__ == "__main__":
    main()
