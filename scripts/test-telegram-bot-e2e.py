#!/usr/bin/env python3
"""
Telethon E2E Test — test @vilona_nexus_bot as an authenticated user.
Sends commands to the bot and verifies responses.
Run: .venv/bin/python scripts/test-telegram-bot-e2e.py
"""
import asyncio
import sys
import os

# Use the vilona session (authenticated user)
SESSION_PATH = os.path.expanduser("~/.openclaw/workspace/vilona_session")
API_ID = 23913448
API_HASH = "78d168f985edf365a5cd9679a917a0b2"
BOT_USERNAME = "vilona_nexus_bot"

passed = 0
failed = 0

def check(name, ok, detail=""):
    global passed, failed
    passed += 1 if ok else 0
    failed += 0 if ok else 1
    print(f"  {'✅' if ok else '❌'} {name}" + (f" — {detail}" if detail else ""))

async def main():
    global passed, failed
    from telethon import TelegramClient

    print("=" * 60)
    print("  NEXUS Telegram Bot — Telethon E2E Test")
    print("=" * 60)

    # ── Connect with existing session ──
    print("\n─── 1. Connect with authenticated session ───")
    client = TelegramClient(SESSION_PATH, API_ID, API_HASH)
    await client.connect()
    check("Connected", client.is_connected())

    me = await client.get_me()
    check("Authenticated", me is not None, f"@{me.username} ({me.first_name})")
    print(f"  ℹ️  Logged in as: {me.first_name} (@{me.username}) ID:{me.id}")

    # ── Get bot entity ──
    print("\n─── 2. Find bot ───")
    try:
        bot = await client.get_entity(BOT_USERNAME)
        check("Bot found", True, f"@{bot.username} ID:{bot.id}")
    except Exception as e:
        check("Bot found", False, str(e))
        await client.disconnect()
        return

    # ── Send /start command ──
    print("\n─── 3. Send /start to bot ───")
    try:
        await client.send_message(bot, "/start")
        await asyncio.sleep(3)  # Wait for bot to respond
        # Get last message from bot
        messages = [m async for m in client.iter_messages(bot, limit=3)]
        if messages:
            last_msg = messages[0]
            check("Bot responded", True, f"msg_id={last_msg.id}")
            check("Response has text", bool(last_msg.text), last_msg.text[:80] if last_msg.text else "empty")
            # Check if it's a /start response
            check("Contains 'NEXUS'", "NEXUS" in (last_msg.text or ""), "Start confirmation")
            check("Contains 'alert'", "alert" in (last_msg.text or "").lower(), "Alert registration")
            print(f"\n  📨 Bot response:\n  {'─' * 50}")
            for line in (last_msg.text or "").split("\n")[:15]:
                print(f"  {line}")
            print(f"  {'─' * 50}")
        else:
            check("Bot responded", False, "No messages from bot")
    except Exception as e:
        check("Send /start", False, str(e))

    # ── Send /status command ──
    print("\n─── 4. Send /status to bot ───")
    try:
        await client.send_message(bot, "/status")
        await asyncio.sleep(3)
        messages = [m async for m in client.iter_messages(bot, limit=1)]
        if messages:
            msg = messages[0]
            check("Bot responded to /status", True)
            check("Contains 'Status'", "status" in (msg.text or "").lower() or "NEXUS" in (msg.text or ""), msg.text[:80] if msg.text else "empty")
            print(f"\n  📨 Bot response:\n  {'─' * 50}")
            for line in (msg.text or "").split("\n")[:10]:
                print(f"  {line}")
            print(f"  {'─' * 50}")
        else:
            check("Bot responded to /status", False, "No response")
    except Exception as e:
        check("Send /status", False, str(e))

    # ── Send /help command ──
    print("\n─── 5. Send /help to bot ───")
    try:
        await client.send_message(bot, "/help")
        await asyncio.sleep(3)
        messages = [m async for m in client.iter_messages(bot, limit=1)]
        if messages:
            msg = messages[0]
            check("Bot responded to /help", True)
            check("Contains commands", "/" in (msg.text or ""), "Shows command list")
        else:
            check("Bot responded to /help", False, "No response")
    except Exception as e:
        check("Send /help", False, str(e))

    # ── Send /whale command ──
    print("\n─── 6. Send /whale to bot ───")
    try:
        await client.send_message(bot, "/whale")
        await asyncio.sleep(3)
        messages = [m async for m in client.iter_messages(bot, limit=1)]
        if messages:
            msg = messages[0]
            check("Bot responded to /whale", True)
            check("Contains 'whale'", "whale" in (msg.text or "").lower(), msg.text[:60] if msg.text else "empty")
        else:
            check("Bot responded to /whale", False, "No response")
    except Exception as e:
        check("Send /whale", False, str(e))

    # ── Send random text (should get help or no response) ──
    print("\n─── 7. Send random text ───")
    try:
        await client.send_message(bot, "hello this is a test")
        await asyncio.sleep(3)
        messages = [m async for m in client.iter_messages(bot, limit=1)]
        if messages:
            msg = messages[0]
            check("Bot handled random text", True, msg.text[:60] if msg.text else "no text")
        else:
            check("Bot handled random text", True, "No response (expected for unknown commands)")
    except Exception as e:
        check("Send random text", False, str(e))

    # ── Send /stop command ──
    print("\n─── 8. Send /stop to bot ───")
    try:
        await client.send_message(bot, "/stop")
        await asyncio.sleep(3)
        messages = [m async for m in client.iter_messages(bot, limit=1)]
        if messages:
            msg = messages[0]
            check("Bot responded to /stop", True)
            check("Contains 'Unregistered'", "unregistered" in (msg.text or "").lower() or "stop" in (msg.text or "").lower(), msg.text[:60] if msg.text else "empty")
        else:
            check("Bot responded to /stop", False, "No response")
    except Exception as e:
        check("Send /stop", False, str(e))

    # ── Disconnect ──
    await client.disconnect()
    check("Disconnected cleanly", not client.is_connected())

    # ── Summary ──
    print("\n" + "=" * 60)
    print(f"  Results: {passed} passed, {failed} failed")
    print(f"  {'✅ ALL TELETHON E2E TESTS PASSED' if failed == 0 else f'❌ {failed} FAILURES'}")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0 if failed == 0 else 1)
