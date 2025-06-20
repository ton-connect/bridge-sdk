import axios from "axios";

export class TonConnectSSEBridge {
    private eventSource: EventSource | null = null;
    bridgeUrl = 'http://localhost:8080/bridge';

    constructor(readonly clientId: string) {
    }

    send(to: string) {
        let url = `${this.bridgeUrl}/message?client_id=${this.clientId}&to=${to}&ttl=300`;

        void axios.post(url, Buffer.from('hello!').toString('base64'))
    }

    connect() {
        let url = `${this.bridgeUrl}/events?client_id=${this.clientId}`;
        this.eventSource = new EventSource(url);
        this.eventSource.addEventListener(
            'message',
            (m) => console.log('message', m),
        );
        this.eventSource.addEventListener('open', (ev) => {
            console.log('open', ev);
        });
        this.eventSource.addEventListener('error', (er) => {
            console.log('error', er);
            console.error('eventSource closed');
        });
    }
}
