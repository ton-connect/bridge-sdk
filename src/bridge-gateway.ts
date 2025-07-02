import { Base64, RpcMethod } from '@tonconnect/protocol';

import { BridgeSdkError } from './errors/bridge-sdk.error';
import { addPathToUrl } from './utils/url';
import '@tonconnect/isomorphic-eventsource';
import '@tonconnect/isomorphic-fetch';
import { logError } from './utils/log';
import { createResource } from './utils/resource';
import { timeout } from './utils/timeout';

export type BridgeOpenParams = {
    bridgeUrl: string;
    sessionIds: string[];
    listener: (e: MessageEvent<string>) => void;
    errorsListener: (err: Event) => void;
    lastEventId?: string;
    options?: RegisterSessionOptions;
};

export class BridgeGateway {
    private readonly ssePath = 'events';
    private readonly postPath = 'message';
    private readonly defaultTtl = 300;

    private eventSource = createResource(
        async (signal?: AbortSignal, openingDeadlineMS?: number): Promise<EventSource> => {
            const eventSourceConfig = {
                bridgeUrl: this.bridgeUrl,
                ssePath: this.ssePath,
                sessionIds: this.sessionIds,
                errorHandler: this.errorsHandler.bind(this),
                messageHandler: this.messagesHandler.bind(this),
                signal: signal,
                openingDeadlineMS: openingDeadlineMS,
                lastEventId: this.lastEventId,
            };
            return await createEventSource(eventSourceConfig);
        },
        async (resource: EventSource) => {
            resource.close();
        },
    );

    public get isReady(): boolean {
        const eventSource = this.eventSource.current();
        return eventSource?.readyState === EventSource.OPEN;
    }

    public get isClosed(): boolean {
        const eventSource = this.eventSource.current();
        return eventSource?.readyState !== EventSource.OPEN;
    }

    public get isConnecting(): boolean {
        const eventSource = this.eventSource.current();
        return eventSource?.readyState === EventSource.CONNECTING;
    }

    private constructor(
        public readonly bridgeUrl: string,
        public readonly sessionIds: string[],
        private listener: (e: MessageEvent<string>) => void,
        private errorsListener: (err: Event) => void,
        private readonly lastEventId?: string,
    ) {}

    static async open(params: BridgeOpenParams) {
        const bridgeGateway = new BridgeGateway(
            params.bridgeUrl,
            params.sessionIds,
            params.listener,
            params.errorsListener,
            params.lastEventId,
        );
        try {
            await bridgeGateway.registerSession(params.options);
            return bridgeGateway;
        } catch (error: unknown) {
            await bridgeGateway.close();
            throw error;
        }
    }

    private async registerSession(options?: RegisterSessionOptions): Promise<void> {
        await this.eventSource.create(options?.signal, options?.openingDeadlineMS);
    }

    public async send(
        message: Uint8Array,
        from: string,
        receiver: string,
        options?: {
            topic?: RpcMethod;
            ttl?: number;
            signal?: AbortSignal;
            attempts?: number;
        },
    ): Promise<void> {
        const url = new URL(addPathToUrl(this.bridgeUrl, this.postPath));
        url.searchParams.append('client_id', from);
        url.searchParams.append('to', receiver);
        url.searchParams.append('ttl', (options?.ttl ?? this.defaultTtl).toString());
        if (options?.topic) {
            url.searchParams.append('topic', options.topic);
        }
        const body = Base64.encode(message);

        const response = await this.post(url, body, options?.signal);

        if (!response.ok) {
            throw new BridgeSdkError(`Bridge send failed, status ${response.status}`);
        }
    }

    public async pause(): Promise<void> {
        await this.eventSource.dispose().catch((e) => logError(`Bridge pause failed, ${e}`));
    }

    public async unPause(): Promise<void> {
        const RECREATE_WITHOUT_DELAY = 0;
        await this.eventSource.recreate(RECREATE_WITHOUT_DELAY);
    }

    public async close(): Promise<void> {
        await this.eventSource.dispose().catch((e) => logError(`Bridge close failed, ${e}`));
    }

    public setListener(listener: (e: MessageEvent<string>) => void): void {
        this.listener = listener;
    }

    public setErrorsListener(errorsListener: (err: Event) => void): void {
        this.errorsListener = errorsListener;
    }

    private async post(url: URL, body: string, signal?: AbortSignal): Promise<Response> {
        const response = await fetch(url, {
            method: 'post',
            body,
            signal,
        });

        if (!response.ok) {
            throw new BridgeSdkError(`Bridge send failed, status ${response.status}`);
        }

        return response;
    }

    private async errorsHandler(eventSource: EventSource, e: Event): Promise<void> {
        this.errorsListener(e);
    }

    private async messagesHandler(e: MessageEvent<string>): Promise<void> {
        this.listener(e);
    }
}

/**
 * Represents options for creating an event source.
 */
export type RegisterSessionOptions = {
    /**
     * Deadline for opening the event source.
     */
    openingDeadlineMS?: number;

    /**
     * Signal to abort the operation.
     */
    signal?: AbortSignal;
};

/**
 * Configuration for creating an event source.
 */
export type CreateEventSourceConfig = {
    /**
     * URL of the bridge.
     */
    bridgeUrl: string;
    /**
     * Path to the SSE endpoint.
     */
    ssePath: string;
    /**
     * Session ID of the client.
     */
    sessionIds: string[];
    /**
     * Error handler for the event source.
     */
    errorHandler: (eventSource: EventSource, e: Event) => Promise<EventSource | void>;
    /**
     * Message handler for the event source.
     */
    messageHandler: (e: MessageEvent<string>) => void;
    /**
     * Signal to abort opening the event source and destroy it.
     */
    signal?: AbortSignal;
    /**
     * Deadline for opening the event source.
     */
    openingDeadlineMS?: number;

    /**
     * Last event id to get events from
     */
    lastEventId?: string;
};

/**
 * Creates an event source.
 * @param {CreateEventSourceConfig} config - Configuration for creating an event source.
 */
async function createEventSource(config: CreateEventSourceConfig): Promise<EventSource> {
    let lastEventId = config.lastEventId;

    return await timeout(
        async (resolve, reject, deferOptions) => {
            const { signal } = deferOptions;

            if (signal?.aborted) {
                reject(new BridgeSdkError('Bridge connection aborted'));
                return;
            }

            const url = new URL(addPathToUrl(config.bridgeUrl, config.ssePath));
            url.searchParams.append('client_id', config.sessionIds.join(','));

            if (lastEventId) {
                url.searchParams.append('last_event_id', lastEventId);
            }

            if (signal?.aborted) {
                reject(new BridgeSdkError('Bridge connection aborted'));
                return;
            }

            const eventSource = new EventSource(url.toString());

            eventSource.onerror = async (reason: Event): Promise<void> => {
                if (signal?.aborted) {
                    eventSource.close();
                    reject(new BridgeSdkError('Bridge connection aborted'));
                    return;
                }

                try {
                    await config.errorHandler(eventSource, reason);
                } catch (e) {
                    eventSource.close();
                    reject(e);
                }
            };
            eventSource.onopen = (): void => {
                if (signal?.aborted) {
                    eventSource.close();
                    reject(new BridgeSdkError('Bridge connection aborted'));
                    return;
                }
                resolve(eventSource);
            };
            eventSource.onmessage = (event: MessageEvent<string>): void => {
                lastEventId = event.lastEventId;

                if (signal?.aborted) {
                    eventSource.close();
                    reject(new BridgeSdkError('Bridge connection aborted'));
                    return;
                }

                config.messageHandler(event);
            };

            config.signal?.addEventListener('abort', () => {
                eventSource.close();
                reject(new BridgeSdkError('Bridge connection aborted'));
            });
        },
        { timeout: config.openingDeadlineMS, signal: config.signal },
    );
}
