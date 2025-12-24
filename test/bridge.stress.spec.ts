import { describe, afterEach, it, expect } from 'vitest';
import { SessionCrypto } from '@tonconnect/protocol';

import { AppConsumer, BridgeProvider, BridgeProviderConsumer, WalletConsumer } from '../src';
import { delay } from '../src/utils/delay';

const BRIDGE_URL = process.env.BRIDGE_URL || 'https:/connect.ton.org/bridge';

describe('Bridge stress tests', () => {
    let providers: BridgeProvider<BridgeProviderConsumer>[] = [];
    afterEach(async () => {
        await Promise.all(providers.map((provider) => provider.close()));
    });

    it('should handle 10 clients sending 100 messages each', async () => {
        const CLIENT_COUNT = 10;
        const MESSAGES_PER_CLIENT = 100;

        const clients: Array<{
            app: BridgeProvider<AppConsumer>;
            wallet: BridgeProvider<WalletConsumer>;
            appSession: SessionCrypto;
            walletSession: SessionCrypto;
            receivedMessages: { id: string }[];
        }> = [];

        // Create CLIENT_COUNT client pairs (app + wallet)
        for (let i = 0; i < CLIENT_COUNT; i++) {
            const appSession = new SessionCrypto();
            const walletSession = new SessionCrypto();
            const receivedMessages: { id: string }[] = [];

            const app = await BridgeProvider.open<AppConsumer>({
                bridgeUrl: BRIDGE_URL,
                clients: [{ session: appSession, clientId: walletSession.sessionId }],
                listener: console.log,
            });
            providers.push(app);

            const wallet = await BridgeProvider.open<WalletConsumer>({
                bridgeUrl: BRIDGE_URL,
                clients: [{ session: walletSession, clientId: appSession.sessionId }],
                listener: (message) => {
                    receivedMessages.push(message);
                },
            });
            providers.push(wallet);

            clients.push({
                app,
                wallet,
                appSession,
                walletSession,
                receivedMessages,
            });
        }

        console.log(`Created ${CLIENT_COUNT} client pairs`);

        // Send messages from all clients in parallel
        const sendPromises: Promise<void>[] = [];

        for (let clientIndex = 0; clientIndex < CLIENT_COUNT; clientIndex++) {
            const client = clients[clientIndex];

            for (let messageIndex = 0; messageIndex < MESSAGES_PER_CLIENT; messageIndex++) {
                const sendPromise = client.app.send(
                    {
                        method: 'sendTransaction',
                        params: [`client-${clientIndex}-message-${messageIndex}`],
                        id: `${clientIndex}-${messageIndex}`,
                    },
                    client.appSession,
                    client.walletSession.sessionId,
                    { attempts: 3 },
                );

                sendPromises.push(sendPromise);
            }
        }

        console.log(`Sending ${sendPromises.length} messages...`);

        // Wait for all messages to be sent
        await Promise.all(sendPromises);

        console.log('All messages sent, waiting for delivery...');

        // Wait for all messages to be received (with timeout)
        const waitForMessages = async () => {
            const maxWaitTime = 30000; // 30 seconds
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitTime) {
                const totalReceived = clients.reduce((sum, client) => sum + client.receivedMessages.length, 0);
                const expectedTotal = CLIENT_COUNT * MESSAGES_PER_CLIENT;

                console.log(`Received ${totalReceived}/${expectedTotal} messages`);

                if (totalReceived >= expectedTotal) {
                    return;
                }

                await delay(1000);
            }

            throw new Error('Timeout waiting for all messages to be received');
        };

        await waitForMessages();

        // Verify all messages were received correctly
        for (let clientIndex = 0; clientIndex < CLIENT_COUNT; clientIndex++) {
            const client = clients[clientIndex];

            expect(client.receivedMessages).toHaveLength(MESSAGES_PER_CLIENT);

            // Verify each message was received correctly
            for (let messageIndex = 0; messageIndex < MESSAGES_PER_CLIENT; messageIndex++) {
                const expectedMessage = {
                    method: 'sendTransaction',
                    params: [`client-${clientIndex}-message-${messageIndex}`],
                    id: `${clientIndex}-${messageIndex}`,
                };

                const receivedMessage = client.receivedMessages.find((msg) => msg.id === expectedMessage.id);
                expect(receivedMessage).toMatchObject(expectedMessage);
            }
        }

        console.log(
            `Successfully processed ${CLIENT_COUNT * MESSAGES_PER_CLIENT} messages across ${CLIENT_COUNT} clients`,
        );
    }, 60000); // 60 second timeout for this test
});
