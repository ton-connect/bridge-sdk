import {
    AppRequest,
    Base64,
    ConnectEvent,
    ConnectEventSuccess,
    ConnectRequest,
    DisconnectEvent,
    hexToByteArray,
    RpcMethod,
    SessionCrypto,
    TonAddressItemReply,
    WalletEvent,
    WalletMessage,
    WalletResponse,
} from '@tonconnect/protocol';

import { BridgeSdkError } from './errors/bridge-sdk.error';
import { BridgeGateway } from './bridge-gateway';
import { BridgeIncomingMessage } from './models/bridge/bridge-incomming-message';
import { IStorage } from './storage/models/storage.interface';
import { WithoutId, WithoutIdDistributive } from './utils/types';
import { logDebug, logError } from './utils/log';
import { callForSuccess } from './utils/call-for-success';
import { createAbortController } from './utils/create-abort-controller';
import { anySignal } from './utils/any-signal';
import { ClientConnectionStorage } from './storage/client-connection-storage';
import { ClientConnection } from './models/bridge/client-connection';

type AppRequestListener = (e: AppRequest<RpcMethod>) => void;

export class BridgeProvider {
    private readonly connectionStorage: ClientConnectionStorage;

    private clients: ClientConnection[] = [];

    get sessions() {
        return this.clients.map((client) => client.session);
    }

    private gateway: BridgeGateway | null = null;

    private listeners: AppRequestListener[] = [];

    private readonly defaultOpeningDeadlineMS = 12000;

    private readonly defaultRetryTimeoutMS = 2000;

    private abortController?: AbortController;

    constructor(
        private readonly storage: IStorage,
        private readonly bridgeUrl: string,
    ) {
        this.connectionStorage = new ClientConnectionStorage(storage);
    }

    public toggleClientConnection(
        sessionCrypto: SessionCrypto,
        client: SessionCrypto,
        event: WithoutIdDistributive<ConnectEventSuccess | DisconnectEvent>,
        options?: { openingDeadlineMS?: number; signal?: AbortSignal },
    ): void {
        const abortController = createAbortController(options?.signal);
        this.abortController?.abort();
        this.abortController = abortController;
        this.closeGateway();

        callForSuccess(
            (_options) =>
                this.sendEvent(event, sessionCrypto, client.sessionId, {
                    signal: _options?.signal,
                }),
            {
                attempts: Number.MAX_SAFE_INTEGER,
                delayMs: this.defaultRetryTimeoutMS,
                signal: abortController.signal,
            },
        ).then(async () => {
            if (abortController.signal.aborted) {
                return;
            }

            if (event.event === 'connect') {
                await this.connectionStorage.addClient({ session: client });
            } else {
                await this.connectionStorage.removeClient(client.sessionId);
            }

            if (abortController.signal.aborted) {
                return;
            }

            await callForSuccess(
                (_options) =>
                    this.openGateway(this.sessions, {
                        openingDeadlineMS: options?.openingDeadlineMS ?? this.defaultOpeningDeadlineMS,
                        signal: _options?.signal,
                    }),
                {
                    attempts: Number.MAX_SAFE_INTEGER,
                    delayMs: this.defaultRetryTimeoutMS,
                    signal: abortController.signal,
                },
            );
        });
    }

    public async removeClient(
        clientSessionId: string,
        options?: {
            openingDeadlineMS?: number;
            signal?: AbortSignal;
        },
    ): Promise<void> {
        await this.connectionStorage.removeClient(clientSessionId);
        if (options?.signal?.aborted) {
            return;
        }

        await callForSuccess(
            (_options) =>
                this.openGateway(this.sessions, {
                    openingDeadlineMS: options?.openingDeadlineMS ?? this.defaultOpeningDeadlineMS,
                    signal: _options?.signal,
                }),
            {
                attempts: Number.MAX_SAFE_INTEGER,
                delayMs: this.defaultRetryTimeoutMS,
                signal: options?.signal,
            },
        );
    }

    public async restoreConnection(options?: { openingDeadlineMS?: number; signal?: AbortSignal }): Promise<void> {
        const abortController = createAbortController(options?.signal);
        this.abortController?.abort();
        this.abortController = abortController;

        if (abortController.signal.aborted) {
            return;
        }

        this.closeGateway();
        const storedClients = await this.connectionStorage.getClients();
        if (!storedClients.clients.length) {
            return;
        }

        if (abortController.signal.aborted) {
            return;
        }

        const openingDeadlineMS = options?.openingDeadlineMS ?? this.defaultOpeningDeadlineMS;
        this.clients = storedClients.clients;

        if (this.gateway) {
            logDebug('Gateway is already opened, closing previous gateway');
            await this.gateway.close();
        }

        this.gateway = new BridgeGateway(
            this.storage,
            this.bridgeUrl,
            this.sessions.map((session) => session.sessionId),
            this.gatewayListener.bind(this),
            this.gatewayErrorsListener.bind(this),
        );

        if (abortController.signal.aborted) {
            return;
        }

        // wait for the connection to be opened
        await callForSuccess(
            (options) =>
                this.gateway!.registerSession({
                    openingDeadlineMS: openingDeadlineMS,
                    signal: options.signal,
                }),
            {
                attempts: Number.MAX_SAFE_INTEGER,
                delayMs: this.defaultRetryTimeoutMS,
                signal: abortController.signal,
            },
        );
    }

    public async sendEvent(
        event: WithoutIdDistributive<ConnectEvent | DisconnectEvent>,
        session: SessionCrypto,
        clientSessionId: string,
        options?: {
            attempts?: number;
            signal?: AbortSignal;
        },
    ) {
        if (options?.signal?.aborted) {
            return;
        }

        const nextEventId = await this.connectionStorage.getClientNextEventId(clientSessionId);

        if (options?.signal?.aborted) {
            return;
        }

        await this.connectionStorage.incrementClientNextEventId(clientSessionId);

        if (options?.signal?.aborted) {
            return;
        }

        return await this.sendResponse({ ...event, id: nextEventId }, session, clientSessionId, options);
    }

    public async sendResponse<T extends RpcMethod>(
        response: WalletResponse<T> | ConnectEvent | DisconnectEvent,
        session: SessionCrypto,
        clientSessionId: string,
        options?: {
            attempts?: number;
            signal?: AbortSignal;
        },
    ): Promise<void> {
        if (!this.gateway) {
            throw new BridgeSdkError('Trying to send bridge request without session');
        }

        if (options?.signal?.aborted) {
            return;
        }

        const encodedRequest = session.encrypt(JSON.stringify(response), hexToByteArray(clientSessionId));

        if (options?.signal?.aborted) {
            return;
        }

        await this.gateway.send(encodedRequest, session.sessionId, clientSessionId, {
            attempts: options?.attempts,
            signal: options?.signal,
        });
    }

    public closeConnection(): void {
        this.closeGateway();
        this.listeners = [];
        this.clients = [];
        this.gateway = null;
    }

    public async getClient(clientId: string): Promise<ClientConnection> {
        const connection = await this.connectionStorage.getClient(clientId);
        if (!connection) {
            throw new BridgeSdkError('Client not found');
        }

        return connection;
    }

    public listen(callback: AppRequestListener): () => void {
        this.listeners.push(callback);
        return () => (this.listeners = this.listeners.filter((listener) => listener !== callback));
    }

    public pause(): void {
        this.gateway?.pause();
    }

    public async unPause(): Promise<void> {
        await this.gateway?.unPause();
    }

    public getCryptoSession(clientSessionId: string) {
        const session = this.sessions.find((session) => session.sessionId === clientSessionId);
        if (!session) {
            throw new BridgeSdkError('Client session does not exist');
        }
        return session;
    }

    private async gatewayListener(bridgeIncomingMessage: BridgeIncomingMessage): Promise<void> {
        const sessionCrypto = this.getCryptoSession(bridgeIncomingMessage.from);

        const request = JSON.parse(
            sessionCrypto.decrypt(
                Base64.decode(bridgeIncomingMessage.message).toUint8Array(),
                hexToByteArray(bridgeIncomingMessage.from),
            ),
        ) as AppRequest<RpcMethod>;

        logDebug('Bridge message received:', request);

        const listeners = this.listeners;

        if (request.method === 'disconnect') {
            logDebug(`Removing bridge and session: received disconnect event`);
            await this.removeClient(bridgeIncomingMessage.from);
        }

        listeners.forEach((listener) => listener(request));
    }

    private async gatewayErrorsListener(e: Event): Promise<void> {
        throw new BridgeSdkError(`Bridge error ${JSON.stringify(e)}`);
    }

    private async openGateway(
        sessions: SessionCrypto[],
        options?: {
            openingDeadlineMS?: number;
            signal?: AbortSignal;
        },
    ): Promise<void> {
        if (this.gateway) {
            logDebug(`Gateway is already opened, closing previous gateway`);
            await this.gateway.close();
        }

        this.gateway = new BridgeGateway(
            this.storage,
            this.bridgeUrl,
            sessions.map(({ sessionId }) => sessionId),
            this.gatewayListener.bind(this),
            this.gatewayErrorsListener.bind(this),
        );

        return await this.gateway.registerSession({
            openingDeadlineMS: options?.openingDeadlineMS,
            signal: options?.signal,
        });
    }

    private closeGateway(): void {
        this.gateway?.close();
        this.gateway = null;
    }
}
