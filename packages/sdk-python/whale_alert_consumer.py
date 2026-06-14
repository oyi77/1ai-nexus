# Python SDK — whale alert consumer (test target: trades channel)
import asyncio
import json
import os
import websockets

WS_URL = os.getenv("TRACKER_WS_URL", "ws://localhost:4001/ws")

async def run():
    uri = WS_URL
    async with websockets.connect(uri, max_size=10_000_000) as ws:
        sub = {
            "type": "subscribe",
            "channel": "nexus:trades",
            "filter": {"chains": ["eth","arb","base","op","sol"]},
        }
        await ws.send(json.dumps(sub))
        async for raw in ws:
            msg = json.loads(raw)
            tx = msg.get("payload", msg)
            if tx.get("whaleTier") in {"high","mega"}:
                print("WHALE", tx.get("chain"), tx.get("amountUsd"), tx.get("tokenSymbol"))

if __name__ == "__main__":
    asyncio.run(run())
