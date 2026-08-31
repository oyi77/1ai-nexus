#!/usr/bin/env python3
"""
Telethon E2E Test — test NEXUS bot with inline keyboards.
Run: .venv/bin/python scripts/test-telegram-bot-e2e.py
"""
import asyncio, sys, os

SESSION_PATH = os.path.expanduser("~/.openclaw/workspace/vilona_session")
API_ID = 23913448
# API credentials come from env (Telegram requires API_ID + API_HASH).
# Set TELEGRAM_API_ID / TELEGRAM_API_HASH — never commit real values.
API_ID = int(os.environ.get("TELEGRAM_API_ID", "23913448"))
API_HASH = os.environ.get("TELEGRAM_API_HASH") or ""
if not API_HASH:
    print("Set TELEGRAM_API_HASH env var (Telegram app credentials) and retry.")
    sys.exit(2)
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
    from telethon.tl.types import UpdateBotCallbackQuery

    print("=" * 60)
    print("  NEXUS Bot — Telethon E2E (Inline Buttons)")
    print("=" * 60)

    client = TelegramClient(SESSION_PATH, API_ID, API_HASH)
    await client.connect()
    check("Connected", client.is_connected())
    me = await client.get_me()
    check("Authenticated", me is not None, f"@{me.username}")
    print(f"  ℹ️  Logged in as: {me.first_name} (@{me.username})")

    bot = await client.get_entity(BOT_USERNAME)
    check("Bot found", True, f"@{bot.username}")

    # ── Test 1: /start shows inline keyboard ──
    print("\n─── 1. /start → Main Menu with buttons ───")
    await client.send_message(bot, "/start")
    await asyncio.sleep(4)
    msgs = [m async for m in client.iter_messages(bot, limit=1)]
    if msgs:
        msg = msgs[0]
        check("Bot responded", True, f"msg_id={msg.id}")
        check("Has text", bool(msg.text), msg.text[:60] if msg.text else "empty")
        check("Contains 'NEXUS'", "NEXUS" in (msg.text or ""))
        has_buttons = msg.reply_markup is not None
        check("Has inline keyboard", has_buttons, "buttons attached" if has_buttons else "no buttons")
        if has_buttons:
            buttons = []
            for row in msg.reply_markup.rows:
                for btn in row.buttons:
                    if hasattr(btn, 'text'):
                        buttons.append(btn.text)
            check("Has Market button", any('Market' in b for b in buttons), f"{len(buttons)} total buttons")
            check("Has Whale button", any('Whale' in b for b in buttons))
            check("Has Trading button", any('Trading' in b for b in buttons))
            check("Has Smart Money button", any('Smart' in b for b in buttons))
            print(f"\n  📋 Buttons found: {', '.join(buttons[:10])}")
    else:
        check("Bot responded", False, "No response")

    # ── Test 2: Click Market button ──
    print("\n─── 2. Click '📊 Market Overview' button ───")
    if msgs and msgs[0].reply_markup:
        market_btn = None
        for row in msgs[0].reply_markup.rows:
            for btn in row.buttons:
                if hasattr(btn, 'text') and 'Market' in btn.text:
                    market_btn = btn
                    break
        if market_btn:
            await msgs[0].click(text=market_btn.text)
            await asyncio.sleep(4)
            msgs2 = [m async for m in client.iter_messages(bot, limit=1)]
            if msgs2:
                msg2 = msgs2[0]
                check("Market submenu opened", "market" in (msg2.text or "").lower() or "Market" in (msg2.text or ""), msg2.text[:80] if msg2.text else "empty")
                has_sub_buttons = msg2.reply_markup is not None
                check("Has sub-buttons", has_sub_buttons)
                if has_sub_buttons:
                    sub_buttons = []
                    for row in msg2.reply_markup.rows:
                        for btn in row.buttons:
                            if hasattr(btn, 'text'):
                                sub_buttons.append(btn.text)
                    check("Has Fear & Greed", any('Fear' in b for b in sub_buttons))
                    check("Has Prices", any('Price' in b for b in sub_buttons))
                    check("Has Back button", any('Back' in b for b in sub_buttons))
                    print(f"  📋 Sub-buttons: {', '.join(sub_buttons[:8])}")
            else:
                check("Market submenu", False, "No response")
        else:
            check("Market button found", False, "Button not in markup")

    # ── Test 3: Click Fear & Greed ──
    print("\n─── 3. Click '🔥 Fear & Greed' → Real data ───")
    if msgs2 and msgs2[0].reply_markup:
        fg_btn = None
        for row in msgs2[0].reply_markup.rows:
            for btn in row.buttons:
                if hasattr(btn, 'text') and 'Fear' in btn.text:
                    fg_btn = btn
                    break
        if fg_btn:
            await msgs2[0].click(text=fg_btn.text)
            await asyncio.sleep(5)
            msgs3 = [m async for m in client.iter_messages(bot, limit=1)]
            if msgs3:
                msg3 = msgs3[0]
                text3 = msg3.text or ""
                check("Fear & Greed data loaded", "Fear" in text3 and "Score" in text3, text3[:80])
                check("Contains score", "/100" in text3 or "score" in text3.lower())
                has_back = msg3.reply_markup is not None
                check("Has Back button", has_back)
                print(f"\n  📊 Response preview:\n  {'─' * 50}")
                for line in text3.split("\n")[:8]:
                    print(f"  {line}")
                print(f"  {'─' * 50}")
            else:
                check("F&G data", False, "No response")

    # ── Test 4: Click Back → Main Menu ──
    print("\n─── 4. Click '🔙 Back' → Main Menu ───")
    if msgs3 and msgs3[0].reply_markup:
        await msgs3[0].click(text='🔙 Back')
        await asyncio.sleep(3)
        msgs4 = [m async for m in client.iter_messages(bot, limit=1)]
        if msgs4:
            check("Back to main menu", "NEXUS" in (msgs4[0].text or ""), msgs4[0].text[:60] if msgs4[0].text else "")
        else:
            check("Back to main menu", False, "No response")

    # ── Test 5: Random text → shows main menu ──
    print("\n─── 5. Random text → Main menu ───")
    await client.send_message(bot, "hello random text")
    await asyncio.sleep(3)
    msgs5 = [m async for m in client.iter_messages(bot, limit=1)]
    if msgs5:
        check("Shows main menu", "NEXUS" in (msgs5[0].text or ""))
        check("Has buttons", msgs5[0].reply_markup is not None)

    # ── Test 6: /stop ──
    print("\n─── 6. /stop ───")
    await client.send_message(bot, "/stop")
    await asyncio.sleep(3)
    msgs6 = [m async for m in client.iter_messages(bot, limit=1)]
    if msgs6:
        check("Unregistered", "unregistered" in (msgs6[0].text or "").lower())

    await client.disconnect()
    check("Disconnected", not client.is_connected())

    print("\n" + "=" * 60)
    print(f"  Results: {passed} passed, {failed} failed")
    print(f"  {'✅ ALL TELETHON E2E TESTS PASSED' if failed == 0 else f'❌ {failed} FAILURES'}")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0 if failed == 0 else 1)
