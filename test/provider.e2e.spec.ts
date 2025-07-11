import { SessionCrypto } from '@tonconnect/protocol';

import { AppConsumer, WalletConsumer, BridgeProvider, BridgeProviderConsumer } from '../src';

const BRIDGE_URL = process.env.BRIDGE_URL || 'https://walletbot.me/tonconnect-bridge/bridge';

describe('BridgeProvider', () => {
    let providers: BridgeProvider<BridgeProviderConsumer>[] = [];
    afterEach(async () => {
        await Promise.all(providers.map((provider) => provider.close()));
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
});
