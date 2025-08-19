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

export type BridgeProviderOpenParams<TConsumer extends BridgeProviderConsumer> = {
    bridgeUrl: string;
    clients: ClientConnection[];
    listener?: BridgeEventListeners[TConsumer];
    errorListener?: (error: unknown) => void;
    options?: {
        lastEventId?: string;
        openingDeadlineMS?: number;
        signal?: AbortSignal;
        exponential?: boolean;
        heartbeatReconnectIntervalMs?: number;
    };
};

export class BridgeProvider<TConsumer extends BridgeProviderConsumer> {
    private clients: ClientConnection[] = [];
    private lastEventId?: string;
    private abortController?: AbortController;
    private gateway: BridgeGateway | null = null;

    private readonly heartbeatMessage = 'heartbeat';
    private readonly defaultOpeningDeadlineMS = 16000;
    private readonly defaultRetryTimeoutMS = 2000;

    private lastHeartbeatAt: number = Date.now();
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    static async open<TConsumer extends BridgeProviderConsumer = 'wallet'>(
        params: BridgeProviderOpenParams<TConsumer>,
    ): Promise<BridgeProvider<TConsumer>> {
        const provider = new BridgeProvider<TConsumer>(
            params.bridgeUrl,
            params.listener,
            params.errorListener,
            params.options?.heartbeatReconnectIntervalMs,
        );
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
        return Boolean(this.gateway) && this.gateway!.isConnecting;
    }

    public get isClosed(): boolean {
        return Boolean(this.gateway) && this.gateway!.isClosed;
    }

    private startHeartbeatWatcher(signal?: AbortSignal) {
        if (!this.heartbeatReconnectIntervalMs) return;

        this.stopHeartbeatWatcher();

        this.lastHeartbeatAt = Date.now();
        this.heartbeatInterval = setInterval(async () => {
            if (signal?.aborted) {
                this.stopHeartbeatWatcher();
                return;
            }

            const elapsed = Date.now() - this.lastHeartbeatAt;
            if (elapsed > this.heartbeatReconnectIntervalMs!) {
                logDebug(`[BridgeProvider] No heartbeat for ${elapsed}ms, reconnecting...`);
                try {
                    await this.restoreConnection(this.clients, {
                        lastEventId: this.lastEventId,
                        exponential: true,
                    });
                    this.lastHeartbeatAt = Date.now(); // reset after reconnect
                } catch (err) {
                    logError('[BridgeProvider] Failed to reconnect after missed heartbeat:', err);
                    this.errorListener?.(err);
                }
            }
        }, this.heartbeatReconnectIntervalMs);
    }

    private stopHeartbeatWatcher() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    public async restoreConnection(
        clients: ClientConnection[],
        options?: { lastEventId?: string; openingDeadlineMS?: number; signal?: AbortSignal; exponential?: boolean },
    ): Promise<void> {
        logDebug('[BridgeProvider] Restoring connection...');
        const abortController = createAbortController(options?.signal);
        this.abortController?.abort();
        this.abortController = abortController;

        if (abortController.signal.aborted) {
            logDebug('[BridgeProvider] Restore aborted before start.');
            return;
        }

        logDebug('[BridgeProvider] Closing previous connection...');
        await this.closeGateway();

        if (abortController.signal.aborted) {
            logDebug('[BridgeProvider] Restore aborted after close.');
            return;
        }

        const openingDeadlineMS = options?.openingDeadlineMS ?? this.defaultOpeningDeadlineMS;
        this.clients = clients;
        this.lastEventId = options?.lastEventId;

        // wait for the connection to be opened till abort signal
        await callForSuccess(
            ({ signal }) =>
                this.openGateway(
                    this.clients.map((client) => client.session),
                    {
                        lastEventId: options?.lastEventId,
                        openingDeadlineMS,
                        signal,
                    },
                ),
            {
                attempts: Number.MAX_SAFE_INTEGER,
                delayMs: this.defaultRetryTimeoutMS,
                signal: abortController.signal,
                exponential: options?.exponential ?? true,
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
                delayMs: options?.delayMs ?? this.defaultRetryTimeoutMS,
                signal: options?.signal,
            },
        );
    }

    public async close(): Promise<void> {
        logDebug('[BridgeProvider] Closing provider and gateway...');
        await this.closeGateway();
        this.lastEventId = undefined;
        this.clients = [];
        logDebug('[BridgeProvider] Closed.');
    }

    public listen(callback: BridgeEventListeners[TConsumer] | null) {
        this.listener = callback;
    }

    public async pause(): Promise<void> {
        await this.gateway?.pause();
    }

    public async unPause(): Promise<void> {
        await this.gateway?.unPause();
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
        this.lastEventId = e.lastEventId;

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

        this.listener?.({ lastEventId: e.lastEventId, ...request, from: bridgeIncomingMessage.from });
    }

    private async gatewayErrorsListener(e: Event): Promise<void> {
        if (this.gateway?.isClosed || this.gateway?.isConnecting) {
            logError('[BridgeProvider] Error in gatewayErrorsListener, trying to reconnect:', e);
            await this.restoreConnection(this.clients, {
                lastEventId: this.lastEventId,
                exponential: true,
            });
            return;
        }

        const error = new BridgeSdkError(`Bridge error ${JSON.stringify(e)}`);
        logError('[BridgeProvider] Gateway error:', error);
        this.errorListener?.(error);
    }

    private async openGateway(
        sessions: SessionCrypto[],
        options?: {
            lastEventId?: string;
            openingDeadlineMS?: number;
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

        await this.gateway.registerSession({
            openingDeadlineMS: options?.openingDeadlineMS,
            signal: options?.signal,
        });

        logDebug('[BridgeProvider] Connected to bridge successfully.');

        this.startHeartbeatWatcher(options?.signal);
    }

    private async closeGateway(): Promise<void> {
        if (this.gateway) {
            logDebug('[BridgeProvider] Closing gateway...');
            this.stopHeartbeatWatcher();
            await this.gateway.close();
            this.gateway = null;
            logDebug('[BridgeProvider] Gateway closed.');
        }
    }
}
