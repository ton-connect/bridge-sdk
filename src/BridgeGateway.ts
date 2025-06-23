import { Base64, RpcMethod } from '@tonconnect/protocol';
import { BridgeIncomingMessage } from 'src/provider/bridge/models/bridge-incomming-message';
import { HttpBridgeGatewayStorage } from './storage/http-bridge-gateway.storage';
import { IStorage } from './storage/storage.interface';
import { addPathToUrl } from './utils/url';
import { callForSuccess } from './utils/call-for-success';
import { logDebug, logError } from './utils/log';
import { createResource } from './utils/resource';
import { timeout } from './utils/timeout';
import { createAbortController } from './utils/abort-controller';
import { BridgeGatewayError } from './errors/BridgeGatewayError';

export class BridgeGateway {
    private readonly ssePath = 'events';
    private readonly postPath = 'message';
    private readonly heartbeatMessage = 'heartbeat';

    private readonly defaultTtl = 300;
    private readonly defaultReconnectDelay = 2000;
    private readonly defaultResendDelay = 5000;

    private eventSource = createResource(
        async (signal?: AbortSignal, openingDeadlineMS?: number): Promise<EventSource> => {
            const eventSourceConfig = {
                bridgeUrl: this.bridgeUrl,
                ssePath: this.ssePath,
                sessionId: this.sessionId,
                bridgeGatewayStorage: this.bridgeGatewayStorage,
                errorHandler: this.errorsHandler.bind(this),
                messageHandler: this.messagesHandler.bind(this),
                signal: signal,
                openingDeadlineMS: openingDeadlineMS,
            };
            return await createEventSource(eventSourceConfig);
        },
        async (resource: EventSource) => {
            resource.close();
        },
    );

    private get isReady(): boolean {
        const eventSource = this.eventSource.current();
        return eventSource?.readyState === EventSource.OPEN;
    }

    private get isClosed(): boolean {
        const eventSource = this.eventSource.current();
        return eventSource?.readyState !== EventSource.OPEN;
    }

    private get isConnecting(): boolean {
        const eventSource = this.eventSource.current();
        return eventSource?.readyState === EventSource.CONNECTING;
    }

    private readonly bridgeGatewayStorage: HttpBridgeGatewayStorage;

    constructor(
        storage: IStorage,
        public readonly bridgeUrl: string,
        public readonly sessionId: string,
        private listener: (msg: BridgeIncomingMessage) => void,
        private errorsListener: (err: Event) => void,
    ) {
        this.bridgeGatewayStorage = new HttpBridgeGatewayStorage(storage, bridgeUrl);
    }

    public async registerSession(options?: RegisterSessionOptions): Promise<void> {
        await this.eventSource.create(options?.signal, options?.openingDeadlineMS);
    }

    public async send(
        message: Uint8Array,
        receiver: string,
        topic: RpcMethod,
        options?: {
            ttl?: number;
            signal?: AbortSignal;
            attempts?: number;
        },
    ): Promise<void> {
        const url = new URL(addPathToUrl(this.bridgeUrl, this.postPath));
        url.searchParams.append('client_id', this.sessionId);
        url.searchParams.append('to', receiver);
        url.searchParams.append('ttl', (options?.ttl || this.defaultTtl).toString());
        url.searchParams.append('topic', topic);
        const body = Base64.encode(message);

        await callForSuccess(
            async (options) => {
                const response = await this.post(url, body, options.signal);

                if (!response.ok) {
                    throw new BridgeGatewayError(`Bridge send failed, status ${response.status}`);
                }
            },
            {
                attempts: options?.attempts ?? Number.MAX_SAFE_INTEGER,
                delayMs: this.defaultResendDelay,
                signal: options?.signal,
            },
        );
    }

    public pause(): void {
        this.eventSource.dispose().catch((e) => logError(`Bridge pause failed, ${e}`));
    }

    public async unPause(): Promise<void> {
        const RECREATE_WITHOUT_DELAY = 0;
        await this.eventSource.recreate(RECREATE_WITHOUT_DELAY);
    }

    public async close(): Promise<void> {
        await this.eventSource.dispose().catch((e) => logError(`Bridge close failed, ${e}`));
    }

    public setListener(listener: (msg: BridgeIncomingMessage) => void): void {
        this.listener = listener;
    }

    public setErrorsListener(errorsListener: (err: Event) => void): void {
        this.errorsListener = errorsListener;
    }

    private async post(url: URL, body: string, signal?: AbortSignal): Promise<Response> {
        const response = await fetch(url, {
            method: 'post',
            body: body,
            signal: signal,
        });

        if (!response.ok) {
            throw new BridgeGatewayError(`Bridge send failed, status ${response.status}`);
        }

        return response;
    }

    private async errorsHandler(eventSource: EventSource, e: Event): Promise<EventSource | void> {
        if (this.isConnecting) {
            eventSource.close();
            throw new BridgeGatewayError('Bridge error, failed to connect');
        }

        if (this.isReady) {
            try {
                this.errorsListener(e);
            } catch (e) {}
            return;
        }

        if (this.isClosed) {
            eventSource.close();
            logDebug(`Bridge reconnecting, ${this.defaultReconnectDelay}ms delay`);
            return await this.eventSource.recreate(this.defaultReconnectDelay);
        }

        throw new BridgeGatewayError('Bridge error, unknown state');
    }

    private async messagesHandler(e: MessageEvent<string>): Promise<void> {
        if (e.data === this.heartbeatMessage) {
            return;
        }

        await this.bridgeGatewayStorage.storeLastEventId(e.lastEventId);

        if (this.isClosed) {
            return;
        }

        let bridgeIncomingMessage: BridgeIncomingMessage;
        try {
            bridgeIncomingMessage = JSON.parse(e.data);
        } catch (_) {
            throw new BridgeGatewayError(`Bridge message parse failed, message ${e.data}`);
        }
        this.listener(bridgeIncomingMessage);
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
    sessionId: string;
    /**
     * Storage for the last event ID.
     */
    bridgeGatewayStorage: HttpBridgeGatewayStorage;
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
};

/**
 * Creates an event source.
 * @param {CreateEventSourceConfig} config - Configuration for creating an event source.
 */
async function createEventSource(config: CreateEventSourceConfig): Promise<EventSource> {
    return await timeout(
        async (resolve, reject, deferOptions) => {
            const abortController = createAbortController(deferOptions.signal);
            const signal = abortController.signal;

            if (signal.aborted) {
                reject(new BridgeGatewayError('Bridge connection aborted'));
                return;
            }

            const url = new URL(addPathToUrl(config.bridgeUrl, config.ssePath));
            url.searchParams.append('client_id', config.sessionId);

            const lastEventId = await config.bridgeGatewayStorage.getLastEventId();
            if (lastEventId) {
                url.searchParams.append('last_event_id', lastEventId);
            }

            if (signal.aborted) {
                reject(new BridgeGatewayError('Bridge connection aborted'));
                return;
            }

            const eventSource = new EventSource(url.toString());

            eventSource.onerror = async (reason: Event): Promise<void> => {
                if (signal.aborted) {
                    eventSource.close();
                    reject(new BridgeGatewayError('Bridge connection aborted'));
                    return;
                }

                try {
                    const newInstance = await config.errorHandler(eventSource, reason);
                    if (newInstance !== eventSource) {
                        eventSource.close();
                    }

                    if (newInstance && newInstance !== eventSource) {
                        resolve(newInstance);
                    }
                } catch (e) {
                    eventSource.close();
                    reject(e);
                }
            };
            eventSource.onopen = (): void => {
                if (signal.aborted) {
                    eventSource.close();
                    reject(new BridgeGatewayError('Bridge connection aborted'));
                    return;
                }
                resolve(eventSource);
            };
            eventSource.onmessage = (event: MessageEvent<string>): void => {
                if (signal.aborted) {
                    eventSource.close();
                    reject(new BridgeGatewayError('Bridge connection aborted'));
                    return;
                }
                config.messageHandler(event);
            };

            config.signal?.addEventListener('abort', () => {
                eventSource.close();
                reject(new BridgeGatewayError('Bridge connection aborted'));
            });
        },
        { timeout: config.openingDeadlineMS, signal: config.signal },
    );
}
