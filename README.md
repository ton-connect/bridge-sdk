# bridge-sdk

## Usage: `BridgeProvider` as WalletConsumer

This guide shows how to use `BridgeProvider` to implement a wallet-side bridge connection, following the [TON Connect protocol](https://github.com/ton-blockchain/ton-connect/blob/main/bridge.md#universal-link), [session management](https://github.com/ton-blockchain/ton-connect/blob/main/session.md), and [wallet guidelines](https://github.com/ton-blockchain/ton-connect/blob/main/wallet-guidelines.md).

### 1. Prerequisites

```sh
npm install @tonconnect/protocol
```

```ts
import { SessionCrypto } from '@tonconnect/protocol';
import { BridgeProvider, WalletConsumer } from 'bridge-sdk';
```

### 2. Create Wallet Session

A `SessionCrypto` instance represents your wallet's key pair/session. You should persist this key pair for the duration of the session, as described in the [session management docs](https://github.com/ton-blockchain/ton-connect/blob/main/session.md):

```ts
const walletSession = new SessionCrypto(); // or restore from your wallet's persistent storage
```

### 3. Obtain the App's Session ID

You will receive the app's session ID (a string) as part of the connection process, typically via a universal link or QR code ([see universal link spec](https://github.com/ton-blockchain/ton-connect/blob/main/bridge.md#universal-link)):

```ts
const appSessionId = '...'; // The app's session ID (string)
```

### 4. Open a Wallet BridgeProvider

```ts
const wallet = await BridgeProvider.open<WalletConsumer>({
  bridgeUrl: 'https://walletbot.me/tonconnect-bridge/bridge', // or your bridge URL
  clients: [{ session: walletSession, clientId: appSessionId }],
  listener: (event) => {
    // event: BridgeWalletEvent
    console.log('Received from app:', event);
    // Handle requests according to TON Connect [requests-responses spec](https://github.com/ton-blockchain/ton-connect/blob/main/requests-responses.md)
    // NOTE: also do not forget to updated stored `event.lastEventId`
  },
});
```

### 5. Persistence Requirement for Reconnection and App Restarts

> **Important:**  
> If you want to support manual reconnection or survive app restarts, you **must** persist both:
> - The `clients` array (including each `SessionCrypto` and `clientId`)
> - The `lastEventId` (received in each event)
>
> When reconnecting (e.g., after an app restart), restore these values and pass them to `BridgeProvider.open` or `restoreConnection`:
>
> ```ts
> const wallet = await BridgeProvider.open<WalletConsumer>({
>   bridgeUrl,
>   clients: restoredClients, // array of { session, clientId }
>   listener,
>   options: {
>     lastEventId: restoredLastEventId,
>     heartbeatReconnectIntervalMs: 15_000, // should be 3 times bigger than actual heartbeat interval
>   }
> });
> ```
>
> This ensures you do not miss any events and maintain a consistent session, as described in the [session management documentation](https://github.com/ton-blockchain/ton-connect/blob/main/session.md).

### 6. Handling Requests

When the app sends a message, your listener will be called with the decrypted event. You should handle requests according to the [wallet guidelines](https://github.com/ton-blockchain/ton-connect/blob/main/wallet-guidelines.md):

```ts
listener: (event) => {
  // event.method, event.params, event.id, event.lastEventId, etc.
  if (event.method === 'sendTransaction') {
    // Validate and process the transaction request
    // Respond according to the protocol
  }
}
```

### 7. Closing the Provider

When done:
```ts
await wallet.close();
```

---

## Example

```ts
import { SessionCrypto } from '@tonconnect/protocol';
import { BridgeProvider, WalletConsumer } from 'bridge-sdk';

// Restore or create wallet session and app session ID
const walletSession = new SessionCrypto(); // or restore from storage
const appSessionId = '...'; // the app's session ID

// Restore lastEventId and clients if reconnecting after restart
const lastEventId = '...'; // (optional, for reconnection)
const clients = [{ session: walletSession, clientId: appSessionId }];

const wallet = await BridgeProvider.open<WalletConsumer>({
  bridgeUrl: 'https://walletbot.me/tonconnect-bridge/bridge',
  clients,
  listener: (event) => {
    console.log('Received from app:', event);
    // handle event according to TON Connect protocol
  },
  options: { lastEventId, heartbeatReconnectIntervalMs: 15000 },
});

// ... use wallet, then:
await wallet.close();
```

---

**References:**
- [TON Connect Bridge Protocol](https://github.com/ton-blockchain/ton-connect/blob/main/bridge.md#universal-link)
- [Session Management](https://github.com/ton-blockchain/ton-connect/blob/main/session.md)
- [Requests & Responses](https://github.com/ton-blockchain/ton-connect/blob/main/requests-responses.md)
- [Wallet Guidelines](https://github.com/ton-blockchain/ton-connect/blob/main/wallet-guidelines.md)
- [Workflows](https://github.com/ton-blockchain/ton-connect/blob/main/workflows.md)

---

**Notes:**
- `SessionCrypto` should be your wallet's persistent key/session.
- `clientId` is the app's session ID (string).
- You can manage multiple app connections by updating the `clients` array and calling `restoreConnection`.
- Always follow the [wallet guidelines](https://github.com/ton-blockchain/ton-connect/blob/main/wallet-guidelines.md) for security and UX best practices.
- **Persistence of `clients` and `lastEventId` is mandatory for reliable reconnection and event delivery.**
