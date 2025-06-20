import TonConnect from '@tonconnect/sdk';
import { InMemoryStorage } from "./InMemoryStorage";


describe('TonConnect', () => {
    const connector = new TonConnect({
        // TODO: when repo becomes public change to own url
        manifestUrl: 'https://raw.githubusercontent.com/ton-org/blueprint/refs/heads/develop/tonconnect/manifest.json',
        storage: new InMemoryStorage(),
    });

    const unsubscribe = connector.onStatusChange(
        walletInfo => {
            console.log(walletInfo);
        }
    );

    it('should connect to bridge', async () => {
        const res = connector.connect({
            universalLink: 'http://localhost:8545',
            bridgeUrl: 'http://localhost:8082'
        }, {openingDeadlineMS: 1000});
        console.log(res);
    });


});