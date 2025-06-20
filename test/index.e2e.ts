import {TonConnectSSEBridge} from "../src";

describe('Bridge', () => {

    it("should connect to bridge", async () => {
        const client1 = new TonConnectSSEBridge('1');
        client1.connect();
        const client2 = new TonConnectSSEBridge('2');
        client2.connect();

        await new Promise(resolve => setTimeout(resolve, 1000));
        client1.send('1');
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
});