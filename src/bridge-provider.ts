import { Base64, hexToByteArray, RpcMethod, SessionCrypto } from '@tonconnect/protocol';

import { BridgeSdkError } from './errors/bridge-sdk.error';
import { BridgeGateway } from './bridge-gateway';
import { logDebug, logError } from './utils/log';
import { callForSuccess, RetryOptions } from './utils/call-for-success';
import { createAbortController } from './utils/create-abort-controller';
import { ClientConnection } from './models/client-connection';
import {
    BridgeEventListeners,
    BridgeMessages,
    BridgeProviderConsumer,
    BridgeIncomingMessage,
} from './models/bridge-messages';
import { distinct } from './utils/distinct';
import { delay } from './utils/delay';

/**
 * Parameters for opening a `BridgeProvider`.
 */
export type BridgeProviderOpenParams<TConsumer extends BridgeProviderConsumer> = {
    /** Bridge base URL (without trailing slash for SSE/message endpoints). */
    bridgeUrl: string;
    /** Connected clients for this provider: pairs of our `SessionCrypto` and remote `clientId`. */
    clients: ClientConnection[];
    /** Listener for decrypted bridge events. */
    listener?: BridgeEventListeners[TConsumer];
    /** Error listener for unhandled/unexpected errors. */
    errorListener?: (error: unknown) => void;
    /**
     * Called when the provider starts (re)connecting to the bridge.
     * Prefer this over legacy `onConnect`.
     */
    onConnecting?: () => void;
    options?: {
        /** Resume from this last event id (to avoid missing messages). */
        lastEventId?: string;
        /**
         * Deadline for establishing SSE connection in milliseconds.
         * Alias: `connectingDeadlineMs` is also accepted.
         */
        connectingDeadlineMs?: number;
        /** Abort signal to cancel open/restore. */
        signal?: AbortSignal;
        /** Whether to use exponential backoff for retries. */
        exponential?: boolean;
        /**
         * If no heartbeat is received for this interval (ms), force reconnect.
         * Should be ~3x the actual heartbeat interval.
         */
        heartbeatReconnectIntervalMs?: number;
    };
};

export class BridgeProvider<TConsumer extends BridgeProviderConsumer> {
    private clients: ClientConnection[] = [];
    private lastEventId?: string;
    private abortController?: AbortController;
    private gateway: BridgeGateway | null = null;

    private onConnectingCallback?: () => void;

    private readonly heartbeatMessage = 'heartbeat';
    private readonly defaultConnectingDeadlineMS = 14_000;
    private readonly defaultRetryDelayMs = 1_000;
    private readonly defaultMaxExponentialDelayMS = 7_000;
    private readonly missedHeartbeatDelay = 100;

    private lastHeartbeatAt: number = Date.now();
    private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    private connectionOptions?: {
        connectingDeadlineMs?: number;
    } & Omit<RetryOptions, 'attempts'> = {};
    /**
     * Creates and opens a `BridgeProvider` instance.
     * Automatically performs connection with provided clients and options.
     */
    static async open<TConsumer extends BridgeProviderConsumer = 'wallet'>(
        params: BridgeProviderOpenParams<TConsumer>,
    ): Promise<BridgeProvider<TConsumer>> {
        const provider = new BridgeProvider<TConsumer>(
            params.bridgeUrl,
            params.listener,
            params.errorListener,
            params.options?.heartbeatReconnectIntervalMs,
        );
        if (params.onConnecting) provider.onConnecting = params.onConnecting;
        try {
            await provider.restoreConnection(params.clients, params.options);
            return provider;
        } catch (err: unknown) {
            await provider.close();
            throw err;
        }
    }

    constructor(
        private readonly bridgeUrl: string,
        private listener: BridgeEventListeners[TConsumer] | null = null,
        private errorListener: ((error: unknown) => void) | null = null,
        private heartbeatReconnectIntervalMs: number | undefined = undefined,
    ) {}

    public get isReady(): boolean {
        return this.gateway?.isReady || false;
    }

    public get isConnecting(): boolean {
        return this.gateway?.isConnecting ?? false;
    }

    public get isClosed(): boolean {
        return this.gateway?.isClosed ?? false;
    }

    private startHeartbeatWatcher(outerSignal?: AbortSignal) {
        if (!this.heartbeatReconnectIntervalMs) return;

        // Always stop any existing watcher before starting a new one
        this.stopHeartbeatWatcher();

        const abortController = createAbortController(outerSignal);
        const { signal } = abortController;

        this.lastHeartbeatAt = Date.now();

        const scheduleNextTick = (delayMs: number) => {
            this.heartbeatTimer = setTimeout(tick, delayMs);
        };

        const tick = async () => {
            if (signal.aborted) {
                this.stopHeartbeatWatcher();
                return;
            }

            const elapsed = Date.now() - this.lastHeartbeatAt;

            if (elapsed < this.heartbeatReconnectIntervalMs!) {
                scheduleNextTick(this.heartbeatReconnectIntervalMs! / 2);
                return;
            }

            // Heartbeat missed cause of main loop blocking → allow grace delay
            await delay(this.missedHeartbeatDelay, { signal });
            if (signal.aborted) {
                this.stopHeartbeatWatcher();
                return;
            }

            const elapsedAfterDelay = Date.now() - this.lastHeartbeatAt;
            if (elapsedAfterDelay <= this.heartbeatReconnectIntervalMs!) {
                // Heartbeat recovered during delay
                scheduleNextTick(this.heartbeatReconnectIntervalMs! / 2);
                return;
            }

            this.stopHeartbeatWatcher();
            logDebug(`[BridgeProvider] No heartbeat for ${elapsedAfterDelay}ms, reconnecting...`);

            try {
                await this.reconnect(signal);
            } catch (err) {
                logError('[BridgeProvider] Failed to reconnect after missed heartbeat:', err);
                this.errorListener?.(err);
            }
        };

        // Kick off first check
        scheduleNextTick(this.heartbeatReconnectIntervalMs);
    }

    private stopHeartbeatWatcher() {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * (Re)connects to the bridge with provided clients and options.
     */
    public async restoreConnection(
        clients: ClientConnection[],
        options?: {
            lastEventId?: string;
            /**
             * Deadline for establishing SSE connection in milliseconds.
             */
            connectingDeadlineMs?: number;
            signal?: AbortSignal;
        } & Omit<RetryOptions, 'attempts'>,
    ): Promise<void> {
        if (clients.length === 0) {
            logDebug('[BridgeProvider] No clients passed');
            return;
        }

        this.clients = clients;
        this.lastEventId = options?.lastEventId;
        this.connectionOptions = options;

        logDebug('[BridgeProvider] Restoring connection...');
        const abortController = createAbortController(options?.signal);
        this.abortController?.abort();
        this.abortController = abortController;
        const signal = abortController.signal;

        if (signal.aborted) {
            logDebug('[BridgeProvider] Restore aborted before start.');
            return;
        }
        await this.reconnect(signal);

        if (abortController.signal.aborted) {
            logDebug('[BridgeProvider] Restore aborted after connecting.');
            return;
        }

        this.startHeartbeatWatcher(options?.signal);
    }

    private async reconnect(signal: AbortSignal) {
        try {
            await this.closeGateway();
        } catch (err) {
            logDebug('[BridgeProvider] Error closing gateway:', JSON.stringify(err));
        }

        if (signal.aborted) {
            logDebug('[BridgeProvider] Reconnect aborted after closing gateway.');
            return;
        }

        const options = this.connectionOptions;

        // wait for the connection to be opened till abort signal
        await callForSuccess(
            ({ signal }) => {
                return this.openGateway(
                    this.clients.map((client) => client.session),
                    {
                        lastEventId: this.lastEventId,
                        connectingDeadlineMS: options?.connectingDeadlineMs ?? this.defaultConnectingDeadlineMS,
                        signal,
                    },
                );
            },
            {
                attempts: Number.MAX_SAFE_INTEGER,
                delayMs: options?.delayMs ?? this.defaultRetryDelayMs,
                signal,
                exponential: options?.exponential ?? true,
                maxDelayMs: options?.maxDelayMs ?? this.defaultMaxExponentialDelayMS,
            },
        );
    }

    public async send<TMethod extends RpcMethod>(
        message: BridgeMessages<TMethod>[TConsumer],
        session: SessionCrypto,
        clientSessionId: string,
        options?: {
            ttl?: number;
            signal?: AbortSignal;
        } & RetryOptions,
    ): Promise<void> {
        if (options?.signal?.aborted) {
            logDebug('[BridgeProvider] Send aborted before encryption.');
            return;
        }

        const encodedRequest = session.encrypt(JSON.stringify(message), hexToByteArray(clientSessionId));

        await callForSuccess(
            async ({ signal }) => {
                await BridgeGateway.sendRequest(this.bridgeUrl, encodedRequest, session.sessionId, clientSessionId, {
                    signal,
                    ttl: options?.ttl,
                });
            },
            {
                attempts: options?.attempts ?? Number.MAX_SAFE_INTEGER,
                delayMs: options?.delayMs ?? this.defaultRetryDelayMs,
                signal: options?.signal,
                exponential: options?.exponential ?? true,
                maxDelayMs: options?.maxDelayMs ?? this.defaultMaxExponentialDelayMS,
            },
        );
    }

    public async close(): Promise<void> {
        logDebug('[BridgeProvider] Closing provider and gateway...');
        await this.closeGateway();
        this.stopHeartbeatWatcher();
        this.lastEventId = undefined;
        this.clients = [];
        logDebug('[BridgeProvider] Closed.');
    }

    public listen(callback: BridgeEventListeners[TConsumer] | null) {
        this.listener = callback;
    }

    public set onConnecting(value: () => void) {
        this.onConnectingCallback = () => {
            try {
                value();
            } catch (error) {
                logError(`[BridgeProvider] Error during onConnecting callback: ${JSON.stringify(error)}`, error);
            }
        };
    }

    public getCryptoSession(clientSessionId: string) {
        const client = this.clients.find(({ clientId }) => clientId === clientSessionId);
        if (!client) {
            throw new BridgeSdkError('Client session does not exist');
        }
        return client.session;
    }

    private async gatewayListener(e: MessageEvent<string>): Promise<void> {
        if (e.data === this.heartbeatMessage) {
            this.lastHeartbeatAt = Date.now();
            return;
        }
        logDebug(`[BridgeProvider] Message received. Event ID: ${e.lastEventId}`);

        let bridgeIncomingMessage: BridgeIncomingMessage;
        try {
            bridgeIncomingMessage = JSON.parse(e.data);
        } catch {
            throw new BridgeSdkError(`Failed to parse message: ${e.data}`);
        }

        const sessionCrypto = this.getCryptoSession(bridgeIncomingMessage.from);

        const request = JSON.parse(
            sessionCrypto.decrypt(
                Base64.decode(bridgeIncomingMessage.message).toUint8Array(),
                hexToByteArray(bridgeIncomingMessage.from),
            ),
        );

        logDebug('[BridgeProvider] Incoming message decrypted:', request);

        this.lastEventId = e.lastEventId;
        this.listener?.({ lastEventId: e.lastEventId, ...request, from: bridgeIncomingMessage.from });
    }

    private async gatewayErrorsListener(e: Event): Promise<void> {
        if (this.gateway?.isClosed || this.gateway?.isConnecting) {
            const abortController = createAbortController(this.abortController?.signal);
            try {
                logDebug('[BridgeProvider] Error in gatewayErrorsListener, trying to reconnect:', e);
                this.onConnectingCallback?.();
                return this.reconnect(abortController.signal);
            } catch (error) {
                abortController.abort();
                logDebug('[BridgeProvider] Error in gatewayErrorsListener after reconnect:', error);
            }
        }

        const error = new BridgeSdkError(`Bridge error ${JSON.stringify(e)}`);
        logError('[BridgeProvider] Gateway error:', error);
        this.errorListener?.(error);
    }

    private async openGateway(
        sessions: SessionCrypto[],
        options?: {
            lastEventId?: string;
            connectingDeadlineMS?: number;
            signal?: AbortSignal;
        },
    ): Promise<void> {
        if (options?.signal?.aborted) {
            logDebug('[BridgeProvider] Open gateway aborted before start.');
            return;
        }

        if (this.gateway) {
            logDebug('[BridgeProvider] Existing gateway detected. Closing it...');
            await this.closeGateway();
        }

        logDebug('[BridgeProvider] Creating new BridgeGateway instance...');

        if (options?.signal?.aborted) {
            logDebug('[BridgeProvider] Open gateway aborted after close.');
            return;
        }

        this.gateway = new BridgeGateway(
            this.bridgeUrl,
            distinct(sessions.map(({ sessionId }) => sessionId)),
            this.gatewayListener.bind(this),
            this.gatewayErrorsListener.bind(this),
            this.lastEventId,
            'message',
        );

        logDebug('[BridgeProvider] BridgeGateway created. Connecting to bridge...');

        this.onConnectingCallback?.();
        await this.gateway.registerSession({
            connectingDeadlineMS: options?.connectingDeadlineMS,
            signal: options?.signal,
        });

        logDebug('[BridgeProvider] Connected to bridge successfully.');
    }

    private async closeGateway(): Promise<void> {
        if (this.gateway) {
            logDebug('[BridgeProvider] Closing previous gateway...');
            await this.gateway.close();
            this.gateway = null;
            logDebug('[BridgeProvider] Gateway closed.');
        }
    }
}
