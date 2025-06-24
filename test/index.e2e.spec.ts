import { BridgeProvider } from '../src';
import { InMemoryStorage } from './InMemoryStorage';

const BRIDGE_URL = 'http://localhost:8080/bridge';
describe('Bridge', () => {
    it('should connect to bridge', async () => {
        const provider1 = new BridgeProvider(new InMemoryStorage(), {
            bridgeUrl: BRIDGE_URL,
        });

        provider1.listen((e) => console.log(e));

        provider1.connect();

        const provider2 = new BridgeProvider(new InMemoryStorage(), {
            bridgeUrl: BRIDGE_URL,
        });
    });
});
