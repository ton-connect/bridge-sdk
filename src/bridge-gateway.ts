import { Base64, RpcMethod } from '@tonconnect/protocol';

import { BridgeSdkError } from './errors/bridge-sdk.error';
import { addPathToUrl } from './utils/url';
import '@tonconnect/isomorphic-eventsource';
import '@tonconnect/isomorphic-fetch';
import { logDebug, logError } from './utils/log';
import { createResource } from './utils/resource';
import { timeout } from './utils/timeout';
import { HeartbeatFormat } from './models/heartbeat';
import { BridgeVerifyParams, BridgeVerifyResponse } from './models/bridge-messages';

export type BridgeGatewayOpenParams = {
    bridgeUrl: string;
    sessionIds: string[];
    listener: (e: MessageEvent<string>) => void;
    errorsListener: (err: Event) => void;
    lastEventId?: string;
    options?: RegisterSessionOptions;
    heartbeatFormat?: HeartbeatFormat;
    enableQueueDoneEvent?: boolean;
};

export class BridgeGateway {
    private static readonly ssePath = 'events';
    private static readonly postPath = 'message';
    private static readonly verifyPath = 'verify';

    private static readonly defaultTtl = 300;

    private eventSource = createResource(
        async (signal?: AbortSignal, connectingDeadlineMS?: number): Promise<EventSource> => {
            return await createEventSource({
                bridgeUrl: this.bridgeUrl,
                ssePath: BridgeGateway.ssePath,
                sessionIds: this.sessionIds,
                errorHandler: this.errorsHandler.bind(this),
                messageHandler: this.messagesHandler.bind(this),
                signal: signal,
                connectingDeadlineMS: connectingDeadlineMS,
                lastEventId: this.lastEventId,
                heartbeatFormat: this.heartbeatFormat,
                enableQueueDoneEvent: this.enableQueueDoneEvent,
            });
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

    constructor(
        public readonly bridgeUrl: string,
        public readonly sessionIds: string[],
        private listener: (e: MessageEvent<string>) => void,
        private errorsListener: (err: Event) => void,
        private readonly lastEventId?: string,
        private readonly heartbeatFormat?: HeartbeatFormat,
        private readonly enableQueueDoneEvent?: boolean,
    ) {}

    static async open(params: BridgeGatewayOpenParams) {
        const bridgeGateway = new BridgeGateway(
            params.bridgeUrl,
            params.sessionIds,
            params.listener,
            params.errorsListener,
            params.lastEventId,
            params.heartbeatFormat,
            params.enableQueueDoneEvent,
        );
        try {
            await bridgeGateway.registerSession(params.options);
            return bridgeGateway;
        } catch (error: unknown) {
            await bridgeGateway.close();
            throw error;
        }
    }

    async registerSession(options?: RegisterSessionOptions): Promise<void> {
        await this.eventSource.create(options?.signal, options?.connectingDeadlineMS);
    }

    static async verifyRequest(
        bridgeUrl: string,
        params: BridgeVerifyParams,
        options?: {
            signal?: AbortSignal;
        },
    ): Promise<BridgeVerifyResponse> {
        const url = new URL(addPathToUrl(bridgeUrl, this.verifyPath));
        const response = await this.post(
            url,
            {
                client_id: params.clientId,
                url: params.url,
                type: params.type,
                // TODO: not supported by bridge yet
                // trace_id: params.traceId,
            },
            options?.signal,
        );

        const result = await response.json();
        return {
            status: result.status,
        };
    }

    static async sendRequest(
        bridgeUrl: string,
        message: Uint8Array,
        from: string,
        receiver: string,
        options?: {
            traceId?: string;
            topic?: RpcMethod;
            ttl?: number;
            signal?: AbortSignal;
        },
    ) {
        const url = new URL(addPathToUrl(bridgeUrl, this.postPath));
        url.searchParams.append('client_id', from);
        url.searchParams.append('to', receiver);
        url.searchParams.append('ttl', (options?.ttl ?? BridgeGateway.defaultTtl).toString());
        if (options?.topic) {
            url.searchParams.append('topic', options.topic);
        }
        if (options?.traceId) {
            url.searchParams.append('trace_id', options.traceId);
        }
        const body = Base64.encode(message);

        await this.post(url, body, options?.signal);
    }

    public async verify(
        params: BridgeVerifyParams,
        options?: {
            signal?: AbortSignal;
        },
    ): Promise<BridgeVerifyResponse> {
        return BridgeGateway.verifyRequest(this.bridgeUrl, params, options);
    }

    public async send(
        message: Uint8Array,
        from: string,
        receiver: string,
        options?: {
            traceId?: string;
            topic?: RpcMethod;
            ttl?: number;
            signal?: AbortSignal;
        },
    ): Promise<void> {
        return BridgeGateway.sendRequest(this.bridgeUrl, message, from, receiver, options);
    }

    public async close(): Promise<void> {
        await this.eventSource.dispose().catch((e) => {
            logError('[BridgeGateway] Failed to close connection:', e);
        });
    }

    public setListener(listener: (e: MessageEvent<string>) => void): void {
        this.listener = listener;
    }

    public setErrorsListener(errorsListener: (err: Event) => void): void {
        this.errorsListener = errorsListener;
    }

    private static async post(
        url: URL,
        body: Record<string, unknown> | string | undefined,
        signal?: AbortSignal,
    ): Promise<Response> {
        const response = await fetch(url, {
            method: 'post',
            body: typeof body === 'object' ? JSON.stringify(body) : body,
            signal,
            headers:
                typeof body === 'object'
                    ? {
                          'Content-Type': 'application/json',
                      }
                    : undefined,
        });

        if (!response.ok) {
            throw new BridgeSdkError(`Bridge post failed, status ${response.status}`);
        }

        return response;
    }

    private async errorsHandler(_eventSource: EventSource, e: Event): Promise<void> {
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
    connectingDeadlineMS?: number;

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
    connectingDeadlineMS?: number;

    /**
     * Last event id to get events from
     */
    lastEventId?: string;

    heartbeatFormat?: HeartbeatFormat;

    enableQueueDoneEvent?: boolean;
};

/**
 * Creates an event source.
 * @param {CreateEventSourceConfig} config - Configuration for creating an event source.
 */
async function createEventSource(config: CreateEventSourceConfig): Promise<EventSource> {
    let { lastEventId, heartbeatFormat, enableQueueDoneEvent } = config;

    return await timeout(
        async (resolve, reject, deferOptions) => {
            const { signal } = deferOptions;

            logDebug('[BridgeGateway] Connecting to bridge SSE...');

            if (signal?.aborted) {
                reject(new BridgeSdkError('Bridge connection aborted before connection'));
                return;
            }

            const url = new URL(addPathToUrl(config.bridgeUrl, config.ssePath));
            url.searchParams.append('client_id', config.sessionIds.join(','));

            if (lastEventId) {
                url.searchParams.append('last_event_id', lastEventId);
            }
            if (heartbeatFormat) {
                url.searchParams.append('heartbeat', heartbeatFormat);
            }
            if (enableQueueDoneEvent) {
                url.searchParams.append('enable_queue_done_event', 'true');
            }

            if (signal?.aborted) {
                reject(new BridgeSdkError('Bridge connection aborted after building url'));
                return;
            }

            logDebug('[BridgeGateway] Initializing EventSource instance...');

            const eventSource = new EventSource(url.toString());

            let wasPreviouslyOpened = false;
            eventSource.addEventListener('error', async (reason: Event) => {
                logDebug('[BridgeGateway] EventSource error occurred:', JSON.stringify(reason));

                if (signal?.aborted) {
                    eventSource.close();
                    reject(new BridgeSdkError('Bridge connection aborted on error callback'));
                    return;
                }

                if (!wasPreviouslyOpened) {
                    eventSource.close();
                    reject(new BridgeSdkError(`Bridge error before connecting`));
                    return;
                }

                try {
                    eventSource.close();
                    await config.errorHandler(eventSource, reason);
                } catch (e) {
                    eventSource.close();
                    reject(e);
                }
            });

            eventSource.addEventListener('open', () => {
                if (signal?.aborted) {
                    eventSource.close();
                    reject(new BridgeSdkError('Bridge connection aborted on open'));
                    return;
                }

                wasPreviouslyOpened = true;
                logDebug('[BridgeGateway] EventSource connection established.');
                resolve(eventSource);
            });

            eventSource.addEventListener('message', (event: MessageEvent<string>) => {
                if (signal?.aborted) {
                    eventSource.close();
                    reject(new BridgeSdkError('Bridge connection aborted on message'));
                    return;
                }

                lastEventId = event.lastEventId;
                config.messageHandler(event);
            });

            config.signal?.addEventListener(
                'abort',
                () => {
                    eventSource.close();
                    reject(new BridgeSdkError('Bridge connection aborted'));
                },
                { once: true },
            );
        },
        { timeout: config.connectingDeadlineMS, signal: config.signal },
    );
}
