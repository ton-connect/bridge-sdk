import { v4 as uuidV4 } from 'uuid';

import { Event, SharedEventData } from './event';
import { logDebug, logError } from '../utils/log';

export type BridgeEventsCollectorOptions = {
    sharedEventData: SharedEventData;
    batchTimeoutMs?: number;
    maxBatchSize?: number;
    analyticsUrl?: string;
};

export class BridgeEventsCollector {
    private events: Event[] = [];
    private timeoutId: ReturnType<typeof setTimeout> | null = null;
    private isProcessing = false;
    private readonly options: Required<BridgeEventsCollectorOptions>;

    constructor(options: BridgeEventsCollectorOptions) {
        this.options = {
            batchTimeoutMs: 5000,
            maxBatchSize: 100,
            analyticsUrl: 'https://analytics.ton.org',
            ...options,
        };
    }

    emit(event: Partial<Event>): void {
        const { bridgeUrl, userId, subsystem, clientEnvironment, networkId, version } = this.options.sharedEventData;

        const enrichedEvent: Event = {
            bridge_url: bridgeUrl,
            user_id: userId,
            subsystem,
            client_environment: clientEnvironment,
            network_id: networkId,
            version,
            ...event,
            event_id: event.event_id || uuidV4(),
            client_timestamp: event.client_timestamp || Math.floor(Date.now() / 1000),
        } as Event;

        this.events.push(enrichedEvent);

        if (this.events.length >= this.options.maxBatchSize) {
            void this.flush();
            return;
        }

        this.startTimeout();
    }

    private startTimeout(): void {
        if (this.timeoutId || this.isProcessing) {
            return;
        }

        this.timeoutId = setTimeout(() => {
            void this.flush();
        }, this.options.batchTimeoutMs);
    }

    async flush(): Promise<void> {
        if (this.isProcessing || this.events.length === 0) {
            return;
        }

        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        this.isProcessing = true;
        const eventsToSend = [...this.events];
        this.events = [];

        try {
            logDebug('Sending events...', eventsToSend);
            await this.sendEvents(eventsToSend);
        } catch (error) {
            this.events.unshift(...eventsToSend);
            logError('Failed to send analytics events:', error);
        } finally {
            this.isProcessing = false;

            if (this.events.length > 0) {
                this.startTimeout();
            }
        }
    }

    private async sendEvents(events: Event[]): Promise<void> {
        const url = `${this.options.analyticsUrl}/events`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-Timestamp': Math.floor(Date.now() / 1000).toString(),
            },
            body: JSON.stringify(events),
        });

        if (!response.ok) {
            throw new Error(`Analytics API error: ${response.status} ${response.statusText}`);
        }
    }
}
