import { randomUUID } from 'node:crypto';

import { Base64 } from '@tonconnect/protocol';

import { BridgeGateway } from '../src';
import { delay } from '../src/utils/delay';

const BRIDGE_URL = process.env.BRIDGE_URL || 'https://walletbot.me/tonconnect-bridge/bridge';

describe('BridgeGateway', () => {
    let sender: BridgeGateway;
    let receiver: BridgeGateway;
    let senderSession: string;

    async function getBridgeLastEventId(): Promise<string> {
        const session = randomUUID();
        const { promise, resolve, reject } = Promise.withResolvers<MessageEvent<string>>();
        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: resolve,
            errorsListener: reject,
        });

        expect(receiver.isReady).toBeTruthy();

        await sender.send(Buffer.alloc(0), senderSession, session);

        const { lastEventId } = await promise;

        return lastEventId;
    }

    beforeEach(async () => {
        senderSession = randomUUID();
        sender = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [senderSession],
            listener: console.log,
            errorsListener: console.error,
        });
        expect(sender.isReady).toBeTruthy();
    });

    afterEach(async () => {
        if (sender && !sender.isClosed) {
            await sender.close();
        }
        if (receiver && !receiver.isClosed) {
            await receiver.close();
        }
    });

    it('should connect and close', async () => {
        const session = randomUUID();
        const gateway = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: console.log,
            errorsListener: console.error,
        });

        expect(gateway.isReady).toBeTruthy();
        await gateway.close();
        expect(gateway.isClosed).toBeTruthy();
    });

    it('should receive a message over an open bridge connection', async () => {
        const receiverSession = randomUUID();

        const { promise, resolve, reject } = Promise.withResolvers<MessageEvent<string>>();
        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [receiverSession],
            listener: resolve,
            errorsListener: reject,
        });

        expect(receiver.isReady).toBeTruthy();

        await sender.send(Buffer.from('ping'), senderSession, receiverSession);

        const message = await promise;
        const { message: encoded, from } = JSON.parse(message.data);

        expect(Base64.decode(encoded).toString()).toEqual('ping');
        expect(from).toEqual(senderSession);
    });

    it('should not receive a message after reconnecting with updated lastEventId', async () => {
        const session = randomUUID();

        const res1 = Promise.withResolvers<MessageEvent<string>>();
        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: res1.resolve,
            errorsListener: res1.reject,
        });

        expect(receiver.isReady).toBeTruthy();

        await sender.send(Buffer.from('Hello!'), senderSession, session);
        const message1 = await res1.promise;

        await receiver.close();

        const res2 = Promise.withResolvers<MessageEvent<string>>();
        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: res2.resolve,
            errorsListener: res2.reject,
            lastEventId: message1.lastEventId,
        });

        setTimeout(() => res2.reject('No new message'), 1000);

        await expect(res2.promise).rejects.toBe('No new message');
    });

    it('should receive a message again after reconnecting with valid lastEventId', async () => {
        const session = randomUUID();

        const res1 = Promise.withResolvers<MessageEvent<string>>();
        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: res1.resolve,
            errorsListener: res1.reject,
        });

        expect(receiver.isReady).toBeTruthy();

        await sender.send(Buffer.from('ping'), senderSession, session);
        const message1 = await res1.promise;

        await receiver.close();

        const res2 = Promise.withResolvers<MessageEvent<string>>();

        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: res2.resolve,
            errorsListener: res2.reject,
            lastEventId: (BigInt(message1.lastEventId) - 1n).toString(),
        });

        expect(receiver.isReady).toBeTruthy();

        const message2 = await res2.promise;
        expect(message2.lastEventId).toBe(message1.lastEventId);

        const { message: encoded, from } = JSON.parse(message2.data);
        expect(Base64.decode(encoded).toString()).toEqual('ping');
        expect(from).toEqual(senderSession);
    });

    it('should not receive a message sent while disconnected if reconnecting with updated lastEventId', async () => {
        const session = randomUUID();

        await sender.send(Buffer.from('Offline message'), senderSession, session);

        const res = Promise.withResolvers<MessageEvent<string>>();

        const lastEventId = await getBridgeLastEventId();

        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: res.resolve,
            errorsListener: res.reject,
            lastEventId: (BigInt(lastEventId) + 1000000000n).toString(),
        });

        setTimeout(() => res.reject('No new message'), 1000);
        await expect(res.promise).rejects.toBe('No new message');
    });

    it('should receive a message sent while disconnected if reconnecting without lastEventId', async () => {
        const session = randomUUID();

        await sender.send(Buffer.from('Delivered later'), senderSession, session);

        const res = Promise.withResolvers<MessageEvent<string>>();
        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: res.resolve,
            errorsListener: res.reject,
        });

        const message = await res.promise;
        const { message: encoded, from } = JSON.parse(message.data);

        expect(from).toEqual(senderSession);
        expect(Base64.decode(encoded).toString()).toBe('Delivered later');
    });

    it('should not receive message after ttl expired', async () => {
        const session = randomUUID();

        await sender.send(Buffer.from('Expiring message'), senderSession, session, { ttl: 1 });

        await delay(1500);

        const res = Promise.withResolvers<MessageEvent<string>>();
        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [session],
            listener: res.resolve,
            errorsListener: res.reject,
        });

        setTimeout(() => res.reject('No new message'), 1000);
        await expect(res.promise).rejects.toBe('No new message');
    });

    it('should receive multiple messages in order', async () => {
        const receiverSession = randomUUID();

        const { promise, resolve, reject } = Promise.withResolvers<MessageEvent<string>[]>();

        let messages: MessageEvent<string>[] = [];
        const listener = (e: MessageEvent<string>) => {
            messages.push(e);
            if (messages.length === 3) {
                resolve(messages);
            }
        };

        receiver = await BridgeGateway.open({
            bridgeUrl: BRIDGE_URL,
            sessionIds: [receiverSession],
            listener,
            errorsListener: reject,
        });

        expect(receiver.isReady).toBeTruthy();

        await sender.send(Buffer.from('1'), senderSession, receiverSession);
        await sender.send(Buffer.from('2'), senderSession, receiverSession);
        await sender.send(Buffer.from('3'), senderSession, receiverSession);

        const receivedMessages = await promise;

        expect(receivedMessages.length).toBe(3);
        receivedMessages.forEach((message, index) => {
            const { message: encoded, from } = JSON.parse(message.data);

            expect(Base64.decode(encoded).toString()).toEqual(`${index + 1}`);
            expect(from).toEqual(senderSession);
        });
    });
});
