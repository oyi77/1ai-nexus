# 1ai-tracker Python SDK

## Install
```bash
cd ~/projects/1ai-tracker/packages/sdk-python
pip install -r requirements.txt
```

## Example: subscribe to trades
```python
import asyncio
import json
import os
import websockets

WS_URL = os.getenv("TRACKER_WS_URL", "ws://localhost:4001/ws")
API_KEY = os.getenv("TRACKER_API_KEY", "dev")

async def run():
    uri = f"{WS_URL}?apiKey={API_KEY}"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({
            "type": "subscribe",
            "channel": "nexus:trades",
            "filters": {"chains": ["eth","arb"]},
        }))
        async for raw in ws:
            msg = json.loads(raw)
            print(msg)

asyncio.run(run())
```
