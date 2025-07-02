import { randomUUID } from 'node:crypto';

import { Base64 } from '@tonconnect/protocol';

import { BridgeGateway } from '../src';

//const BRIDGE_URL = 'http://localhost:8080/bridge';
const BRIDGE_URL = 'https://bridge.tonapi.io/bridge';

describe('Bridge', () => {
    it('connects and closes properly', async () => {
        const session = randomUUID();
        const gateway = await BridgeGateway.open(BRIDGE_URL, [session], console.log, console.error);

        expect(gateway.isReady).toBeTruthy();
        await gateway.close();
        expect(gateway.isClosed).toBeTruthy();
    });

    it('sends and receives event', async () => {
        const receiverSession = randomUUID();
        const senderSession = randomUUID();

        const { promise, resolve, reject } = Promise.withResolvers<MessageEvent<string>>();
        const receiver = await BridgeGateway.open(BRIDGE_URL, [receiverSession], resolve, reject);
        const sender = await BridgeGateway.open(BRIDGE_URL, [senderSession], console.log, console.error);

        expect(receiver.isReady).toBeTruthy();
        expect(sender.isReady).toBeTruthy();

        await sender.send(Buffer.from('Hello!'), senderSession, receiverSession);

        const message = await promise;
        const { message: encoded, from } = JSON.parse(message.data);

        expect(Base64.decode(encoded).toString()).toEqual('Hello!');
        expect(from).toEqual(senderSession);

        await sender.close();
        await receiver.close();
    });

    it('receives event after reopen with lastEventId - 1', async () => {
        const session = randomUUID();
        const senderSession = randomUUID();

        const res1 = Promise.withResolvers<MessageEvent<string>>();
        const receiver = await BridgeGateway.open(BRIDGE_URL, [session], res1.resolve, res1.reject);
        const sender = await BridgeGateway.open(BRIDGE_URL, [senderSession], console.log, console.error);

        expect(receiver.isReady).toBeTruthy();
        expect(sender.isReady).toBeTruthy();

        await sender.send(Buffer.from('Hello!'), senderSession, session);
        const message1 = await res1.promise;

        await receiver.close();

        const res2 = Promise.withResolvers<MessageEvent<string>>();

        const newReceiver = await BridgeGateway.open(
            BRIDGE_URL,
            [session],
            res2.resolve,
            res2.reject,
            (BigInt(message1.lastEventId) - 1n).toString(),
        );

        expect(newReceiver.isReady).toBeTruthy();

        const message2 = await res2.promise;
        expect(message2.lastEventId).toBe(message1.lastEventId);

        const { message: encoded, from } = JSON.parse(message2.data);
        expect(Base64.decode(encoded).toString()).toEqual('Hello!');
        expect(from).toEqual(senderSession);

        await newReceiver.close();
        await sender.close();
    });

    it('not receives event after reopen with lastEventId', async () => {
        const session = randomUUID();
        const senderSession = randomUUID();

        const res1 = Promise.withResolvers<MessageEvent<string>>();
        const receiver = await BridgeGateway.open(BRIDGE_URL, [session], res1.resolve, res1.reject);
        const sender = await BridgeGateway.open(BRIDGE_URL, [senderSession], console.log, console.error);

        expect(receiver.isReady).toBeTruthy();
        expect(sender.isReady).toBeTruthy();

        await sender.send(Buffer.from('Hello!'), senderSession, session);
        const message1 = await res1.promise;

        await receiver.close();

        const res2 = Promise.withResolvers<MessageEvent<string>>();

        const newReceiver = await BridgeGateway.open(
            BRIDGE_URL,
            [session],
            res2.resolve,
            res2.reject,
            message1.lastEventId,
        );

        setTimeout(() => res2.reject('No new message'), 1000);

        await expect(res2.promise).rejects.toBe('No new message');

        await newReceiver.close();
        await sender.close();
    });
});
