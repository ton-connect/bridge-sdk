import { SessionCrypto } from '@tonconnect/protocol';

import { AppConsumer, WalletConsumer, BridgeProvider, BridgeProviderConsumer, BridgeAppEvent } from '../src';

const BRIDGE_URL = process.env.BRIDGE_URL || 'https://walletbot.me/tonconnect-bridge/bridge';

jest.setTimeout(10000);

const block = (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        /* empty */
    }
};

describe('BridgeProvider', () => {
    let providers: BridgeProvider<BridgeProviderConsumer>[] = [];
    afterEach(async () => {
        await Promise.all(providers.map((provider) => provider.close()));
        providers.length = 0;
    });

    it('should send message and retrieve it', async () => {
        const appSession = new SessionCrypto();
        const walletSession = new SessionCrypto();

        const app = await BridgeProvider.open<AppConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: appSession, clientId: walletSession.sessionId }],
            listener: console.log,
        });
        providers.push(app);

        const { promise, resolve } = Promise.withResolvers();

        const wallet = await BridgeProvider.open<WalletConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: walletSession, clientId: appSession.sessionId }],
            listener: resolve,
        });
        providers.push(wallet);

        await app.send({ method: 'sendTransaction', params: [''], id: '1' }, appSession, walletSession.sessionId, {
            attempts: 3,
        });

        const result = await promise;
        expect(result).toMatchObject({ method: 'sendTransaction', params: [''], id: '1' });
    });

    it('should reconnect to another wallet and receive message', async () => {
        const appSession = new SessionCrypto();
        const walletSession = new SessionCrypto();

        const app = await BridgeProvider.open<AppConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: appSession, clientId: walletSession.sessionId }],
            listener: console.log,
        });
        providers.push(app);

        const { promise, resolve } = Promise.withResolvers();

        const wallet = await BridgeProvider.open<WalletConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: walletSession, clientId: appSession.sessionId }],
            listener: resolve,
        });
        providers.push(wallet);

        await app.send({ method: 'sendTransaction', params: ['abc'], id: '1' }, appSession, walletSession.sessionId, {
            attempts: 3,
        });

        const result = await promise;
        expect(result).toMatchObject({ method: 'sendTransaction', params: ['abc'], id: '1' });

        const app2Session = new SessionCrypto();
        const wallet2Session = new SessionCrypto();
        const res2 = Promise.withResolvers();
        const wallet2 = await BridgeProvider.open<WalletConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: wallet2Session, clientId: app2Session.sessionId }],
            listener: res2.resolve,
        });
        providers.push(wallet2);

        await app.restoreConnection([
            { session: appSession, clientId: walletSession.sessionId },
            { session: app2Session, clientId: wallet2Session.sessionId },
        ]);

        await app.send({ method: 'disconnect', params: [], id: '2' }, app2Session, wallet2Session.sessionId, {
            attempts: 3,
        });

        const result2 = await res2.promise;
        expect(result2).toMatchObject({ method: 'disconnect', params: [], id: '2' });
    });

    it('should receive message after reconnect', async () => {
        const appSession = new SessionCrypto();
        const walletSession = new SessionCrypto();

        const app = await BridgeProvider.open<AppConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: appSession, clientId: walletSession.sessionId }],
            listener: console.log,
        });
        providers.push(app);

        const { promise, resolve } = Promise.withResolvers<BridgeAppEvent>();
        const wallet = await BridgeProvider.open<WalletConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: walletSession, clientId: appSession.sessionId }],
            listener: resolve,
        });
        providers.push(wallet);

        await app.send({ method: 'sendTransaction', params: ['abc'], id: '1' }, appSession, walletSession.sessionId, {
            attempts: 3,
        });

        const result = await promise;
        expect(result).toMatchObject({ method: 'sendTransaction', params: ['abc'], id: '1' });

        const res2 = Promise.withResolvers<BridgeAppEvent>();

        await wallet.close();

        await wallet.restoreConnection([{ session: walletSession, clientId: appSession.sessionId }], {
            lastEventId: result.lastEventId,
        });
        wallet.listen(res2.resolve);

        await app.send({ method: 'disconnect', params: [], id: '2' }, appSession, walletSession.sessionId, {
            attempts: 3,
        });

        const result2 = await res2.promise;
        expect(result2).toMatchObject({ method: 'disconnect', params: [], id: '2' });
    });

    it('should works fine with blocking loop', async () => {
        const appSession = new SessionCrypto();
        const walletSession = new SessionCrypto();

        const app = await BridgeProvider.open<AppConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: appSession, clientId: walletSession.sessionId }],
            listener: console.log,
        });
        providers.push(app);

        const { promise, resolve, reject } = Promise.withResolvers();
        const wallet = await BridgeProvider.open<WalletConsumer>({
            bridgeUrl: BRIDGE_URL,
            clients: [{ session: walletSession, clientId: appSession.sessionId }],
            listener: resolve,
            errorListener: reject,
            options: {
                heartbeatReconnectIntervalMs: 9_000,
            },
        });
        providers.push(wallet);

        // emulate user folds app
        block(10_000);
        await app.send({ method: 'sendTransaction', params: ['abc'], id: '1' }, appSession, walletSession.sessionId, {
            attempts: 3,
        });
        const res = await promise;
        console.log(res);
    }, 40_000);
});
