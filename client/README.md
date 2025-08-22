# Bridge Client Demo

This is a minimal React client demonstrating how to use `BridgeProvider` from the local workspace.

## Install & Run

```bash
cd client
npm install
# Set env inline or export beforehand
VITE_BRIDGE_URL=http://localhost:8081 VITE_HEARTBEAT_MS=15000 npm run dev
```

Open the printed URL. Click Connect, then Send Buy to send a test message from the app to the wallet listener.

If your bridge URL differs, replace `VITE_BRIDGE_URL` accordingly.

## Notes
- The demo persists a generated `SessionCrypto`