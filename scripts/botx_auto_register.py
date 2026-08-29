#!/usr/bin/env python3
"""
BotX Auto-Registration & Health Monitor

Commands:
    python3 scripts/botx_auto_register.py --test       Test mail.tm API
    python3 scripts/botx_auto_register.py --batch N     Register N accounts
    python3 scripts/botx_auto_register.py --health      Check key health
    python3 scripts/botx_auto_register.py --monitor     Start monitoring loop
"""

import json
import os
import random
import re
import string
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# ── Config ───────────────────────────────────────────────────

MAIL_TM_BASE = "https://api.mail.tm"
BOTX_URL = "https://dbotx.com"
DB_PATH = Path(__file__).parent.parent / "data" / "botx-keys.sqlite"
MIN_HEALTHY_KEYS = 2
MAX_KEYS = 10
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

# ── Temp Email API ───────────────────────────────────────────

def get_domains():
    """Get available mail.tm domains."""
    try:
        req = urllib.request.Request(f"{MAIL_TM_BASE}/domains")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return [d["domain"] for d in data.get("hydra:member", [])]
    except Exception as e:
        print(f"  Error getting domains: {e}")
        return []

def create_email(domain: str, retries: int = 3):
    """Create a mail.tm account with retry. Returns {address, token, password} or None."""
    for attempt in range(retries):
        address = f"botx.{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}@{domain}"
        password = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))
        
        try:
            # Create account
            body = json.dumps({"address": address, "password": password}).encode()
            req = urllib.request.Request(
                f"{MAIL_TM_BASE}/accounts",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read())
                print(f"  Created: {result.get('address')}")
            
            # Wait for account to propagate
            time.sleep(3)
            
            # Try login with retries
            for login_attempt in range(5):
                try:
                    body = json.dumps({"address": address, "password": password}).encode()
                    req = urllib.request.Request(
                        f"{MAIL_TM_BASE}/token",
                        data=body,
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        token_data = json.loads(resp.read())
                        token = token_data.get("token")
                        if token:
                            print(f"  Login success")
                            return {"address": address, "token": token, "password": password}
                except urllib.error.HTTPError:
                    pass
                time.sleep(2)
            
            print(f"  Login failed after retries")
        except urllib.error.HTTPError as e:
            print(f"  Attempt {attempt+1}: HTTP {e.code}")
            time.sleep(2)
    
    return None

def get_messages(token: str):
    """Get messages from mail.tm inbox."""
    try:
        req = urllib.request.Request(
            f"{MAIL_TM_BASE}/messages",
            headers={"Authorization": f"Bearer {token}"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()).get("hydra:member", [])
    except:
        return []

def get_message(token: str, msg_id: str):
    """Get a specific message."""
    try:
        req = urllib.request.Request(
            f"{MAIL_TM_BASE}/messages/{msg_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except:
        return {}

def wait_for_email(token: str, timeout: int = 120):
    """Wait for an email to arrive. Returns email body or None."""
    for _ in range(timeout // 3):
        messages = get_messages(token)
        if messages:
            msg_id = messages[0]["id"]
            full = get_message(token, msg_id)
            return full.get("text", "") or full.get("html", "")
        time.sleep(3)
    return None

def extract_code(email_body: str) -> str:
    """Extract verification code from email."""
    codes = re.findall(r'\b\d{4,8}\b', email_body)
    return codes[0] if codes else None

# ── BotX Browser Automation ──────────────────────────────────

async def register_botx_account(email: str, password: str) -> str:
    """Start BotX registration. Returns 'NEEDS_CODE' or None."""
    from playwright.async_api import async_playwright
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720},
        )
        page = await context.new_page()
        
        try:
            print(f"    1. Going to {BOTX_URL}/login...")
            await page.goto(f"{BOTX_URL}/login", wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(3000)
            
            # Dismiss modal
            got_it = page.locator("text=Got it").first
            if await got_it.is_visible():
                await got_it.click()
                await page.wait_for_timeout(1000)
            
            # Click Email tab
            email_tab = page.locator("text=Email").first
            if await email_tab.is_visible():
                print(f"    2. Clicking Email tab...")
                await email_tab.click()
                await page.wait_for_timeout(2000)
            
            # Enter email
            email_input = page.locator("input[placeholder='Email address']").first
            if await email_input.is_visible():
                print(f"    3. Entering email: {email}")
                await email_input.fill(email)
                await page.wait_for_timeout(500)
            
            # Click Send
            send_btn = page.locator("button:has-text('Send')").first
            if await send_btn.is_visible():
                print(f"    4. Clicking Send...")
                await send_btn.click()
                await page.wait_for_timeout(5000)
            
            # Check for verification code input
            code_input = page.locator("input[placeholder='Verification code']").first
            if await code_input.is_visible():
                print(f"    ✅ Verification code input found!")
                return "NEEDS_CODE"
            
            print(f"    ⚠️ No verification code input visible")
            return None
            
        except Exception as e:
            print(f"    Error: {e}")
            return None
        finally:
            await browser.close()

async def complete_botx_login(email: str, code: str) -> str:
    """Complete BotX login and extract API key."""
    from playwright.async_api import async_playwright
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720},
        )
        page = await context.new_page()
        
        try:
            print(f"    6. Going to {BOTX_URL}/login...")
            await page.goto(f"{BOTX_URL}/login", wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(3000)
            
            # Dismiss modal
            got_it = page.locator("text=Got it").first
            if await got_it.is_visible():
                await got_it.click()
                await page.wait_for_timeout(1000)
            
            # Click Email tab
            email_tab = page.locator("text=Email").first
            if await email_tab.is_visible():
                await email_tab.click()
                await page.wait_for_timeout(2000)
            
            # Enter email
            email_input = page.locator("input[placeholder='Email address']").first
            if await email_input.is_visible():
                await email_input.fill(email)
                await page.wait_for_timeout(500)
            
            # Click Send
            send_btn = page.locator("button:has-text('Send')").first
            if await send_btn.is_visible():
                await send_btn.click()
                await page.wait_for_timeout(3000)
            
            # Enter verification code
            code_input = page.locator("input[placeholder='Verification code']").first
            if await code_input.is_visible():
                print(f"    7. Entering code: {code}")
                await code_input.fill(code)
                await page.wait_for_timeout(500)
            
            # Click Log in
            login_btn = page.locator("button:has-text('Log in')").first
            if await login_btn.is_visible():
                print(f"    8. Clicking Log in...")
                await login_btn.click()
                await page.wait_for_timeout(5000)
            
            # Look for API key
            text = await page.inner_text("body")
            api_match = re.search(r'[a-zA-Z0-9]{32,}', text)
            if api_match and len(api_match.group()) >= 32:
                print(f"    ✅ Found API key!")
                return api_match.group()
            
            # Try clicking View/Refresh buttons
            for btn_text in ["View", "Refresh", "Show"]:
                btn = page.locator(f"button:has-text('{btn_text}')").first
                if await btn.is_visible():
                    print(f"    9. Clicking {btn_text}...")
                    await btn.click()
                    await page.wait_for_timeout(2000)
                    text = await page.inner_text("body")
                    api_match = re.search(r'[a-zA-Z0-9]{32,}', text)
                    if api_match and len(api_match.group()) >= 32:
                        return api_match.group()
            
            print(f"    ⚠️ Could not find API key")
            return None
            
        except Exception as e:
            print(f"    Error: {e}")
            return None
        finally:
            await browser.close()

# ── Registration Flow ────────────────────────────────────────

async def register_single():
    """Register a single BotX account."""
    print(f"\n{'='*50}")
    print(f"BotX Auto-Registration")
    print(f"{'='*50}")
    
    # Get domains
    print(f"\n1. Getting mail.tm domains...")
    domains = get_domains()
    if not domains:
        print("   ❌ No domains available")
        return None
    domain = domains[0]
    print(f"   ✅ Using domain: {domain}")
    
    # Create email
    print(f"\n2. Creating temp email...")
    account = create_email(domain)
    if not account or not account.get("token"):
        print("   ❌ Failed to create email")
        return None
    print(f"   ✅ Email: {account['address']}")
    
    # Start BotX registration
    print(f"\n3. Starting BotX registration...")
    result = await register_botx_account(account['address'], account['password'])
    
    if result != "NEEDS_CODE":
        print("   ❌ Registration flow failed")
        return None
    
    # Wait for email
    print(f"\n4. Waiting for verification email...")
    body = await wait_for_email(account["token"], timeout=120)
    
    if not body:
        print("   ❌ No email received")
        return None
    
    # Extract code
    code = extract_code(body)
    if not code:
        print("   ❌ Could not extract code")
        print(f"   Email body: {body[:500]}")
        return None
    print(f"   ✅ Code: {code}")
    
    # Complete login
    print(f"\n5. Completing BotX login...")
    api_key = await complete_botx_login(account['address'], code)
    
    if api_key:
        print(f"\n{'='*50}")
        print(f"✅ SUCCESS!")
        print(f"   Email: {account['address']}")
        print(f"   API Key: {api_key}")
        print(f"{'='*50}")
        return {"apiKey": api_key, "email": account['address']}
    else:
        print(f"\n❌ Failed to get API key")
        return None

# ── Health Monitor ───────────────────────────────────────────

def check_key_health(api_key: str) -> dict:
    """Check if a BotX key is healthy."""
    try:
        req = urllib.request.Request(
            "https://api-data-v1.dbotx.com/kline/new?chain=solana&limit=1",
            headers={"x-api-key": api_key, "Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"healthy": True, "status": resp.status}
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return {"healthy": False, "status": 429, "error": "rate limited"}
        return {"healthy": False, "status": e.code, "error": str(e)}
    except Exception as e:
        return {"healthy": False, "status": 0, "error": str(e)}

def monitor_loop():
    """Background monitoring loop with Telegram alerts."""
    import sqlite3
    
    print(f"BotX Health Monitor started")
    print(f"  Check interval: {CHECK_INTERVAL_MS / 60000:.0f} minutes")
    print(f"  Min healthy keys: {MIN_HEALTHY_KEYS}")
    print(f"  Max keys: {MAX_KEYS}")
    
    while True:
        try:
            if not DB_PATH.exists():
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] No key store found")
                time.sleep(CHECK_INTERVAL_MS)
                continue
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.execute("SELECT id, api_key, email FROM botx_keys")
            keys = cursor.fetchall()
            conn.close()
            
            if not keys:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] No keys in store")
                send_telegram_alert("⚠️ <b>BotX Key Alert</b>\n\nNo keys in store! Add keys via:\n<code>npm run botx:register</code>")
                time.sleep(CHECK_INTERVAL_MS)
                continue
            
            healthy = 0
            rate_limited = 0
            unhealthy = 0
            
            for key_id, api_key, email in keys:
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
                message += f"Add new keys via:\n<code>npm run botx:register</code>"
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
    parser = argparse.ArgumentParser(description="BotX Auto-Registration & Monitor")
    parser.add_argument("--test", action="store_true", help="Test mail.tm API")
    parser.add_argument("--batch", type=int, default=0, help="Register N accounts")
    parser.add_argument("--health", action="store_true", help="Check key health")
    parser.add_argument("--monitor", action="store_true", help="Start monitoring loop")
    parser.add_argument("--add-key", type=str, help="Manually add an API key")
    args = parser.parse_args()
    
    if args.test:
        print("Test mode - checking mail.tm API...")
        domains = get_domains()
        print(f"Domains: {domains}")
        if domains:
            account = create_email(domains[0])
            print(f"Account: {account}")
        return
    
    if args.add_key:
        # Add key to store manually
        import sqlite3
        import hashlib
        
        api_key = args.add_key
        email = input("Email (or press Enter to skip): ").strip() or "manual"
        
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
        
        key_id = hashlib.sha256(api_key.encode()).hexdigest()[:16]
        now = int(time.time() * 1000)
        
        conn.execute(
            "INSERT OR REPLACE INTO botx_keys (id, api_key, email, created_at, last_used, last_checked, is_healthy, rate_limited) VALUES (?, ?, ?, ?, ?, ?, 1, 0)",
            (key_id, api_key, email, now, now, now)
        )
        conn.commit()
        conn.close()
        
        print(f"✅ Key added: {key_id}")
        return
    
    if args.health:
        import sqlite3
        
        if not DB_PATH.exists():
            print("No key store found")
            return
        
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.execute("SELECT id, api_key, email FROM botx_keys")
        keys = cursor.fetchall()
        conn.close()
        
        if not keys:
            print("No keys in store")
            return
        
        print(f"\n{len(keys)} keys in store:\n")
        for key_id, api_key, email in keys:
            result = check_key_health(api_key)
            status = "✅ healthy" if result["healthy"] else f"❌ {result.get('error', 'unhealthy')}"
            print(f"  {key_id[:8]}... | {email[:30]:30} | {status}")
        return
    
    if args.monitor:
        monitor_loop()
        return
    
    if args.batch > 0:
        import asyncio
        
        async def run_batch():
            results = []
            for i in range(args.batch):
                print(f"\n{'='*50}")
                print(f"Registration {i+1}/{args.batch}")
                print(f"{'='*50}")
                
                result = await register_single()
                if result:
                    results.append(result)
                
                if i < args.batch - 1:
                    delay = random.uniform(5, 10)
                    print(f"\nWaiting {delay:.1f}s...")
                    await asyncio.sleep(delay)
            
            print(f"\n{'='*50}")
            print(f"SUMMARY: {len(results)}/{args.batch} registered")
            print(f"{'='*50}")
        
        asyncio.run(run_batch())
        return
    
    parser.print_help()

if __name__ == "__main__":
    main()
