import { randomUUID } from 'node:crypto';

import { Base64 } from '@tonconnect/protocol';

import { BridgeGateway, BridgeProvider } from '../src';
import { InMemoryStorage } from './InMemoryStorage';

const BRIDGE_URL = 'http://localhost:8080/bridge';
describe('Bridge', () => {
    it('should connect to bridge', async () => {
        const session1 = randomUUID();
        const gateway1 = new BridgeGateway(
            new InMemoryStorage(),
            BRIDGE_URL,
            session1,
            (e) => {
                console.log('BRIDGE 1 e', Base64.decode(e.message).toString());
            },
            (err) => console.error('BRIDGE 1 err', err),
        );
        const session2 = randomUUID();
        const gateway2 = new BridgeGateway(
            new InMemoryStorage(),
            BRIDGE_URL,
            session2,
            (e) => console.log('BRIDGE 2 e', Base64.decode(e.message).toString()),
            (err) => console.error('BRIDGE 2 err', err),
        );

        await gateway1.registerSession();
        await gateway2.registerSession();

        await gateway2.send(Buffer.from('Hey!'), session1);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await gateway1.close();
        await gateway2.close();
    });
});
