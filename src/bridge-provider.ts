import {
    AppRequest,
    Base64,
    ConnectEventSuccess,
    hexToByteArray,
    RpcMethod,
    SessionCrypto,
    TonAddressItemReply,
    WalletEvent,
    WalletMessage,
    WalletResponse,
} from '@tonconnect/protocol';

import { BridgeSdkError } from './errors/bridge-sdk.error';
import { WalletConnectionSourceHTTP } from './models/wallet/wallet-connection-source';
import { BridgeGateway } from './bridge-gateway';
import { BridgeConnectionHttp, isPendingConnectionHttp } from './models/bridge/bridge-connection';
import { BridgeIncomingMessage } from './models/bridge/bridge-incomming-message';
import { BridgePartialSession, BridgeSession } from './models/bridge/bridge-session';
import { BridgeConnectionStorage } from './storage/bridge-connection-storage';
import { IStorage } from './storage/models/storage.interface';
import { Optional, WithoutId, WithoutIdDistributive } from './utils/types';
import { logDebug, logError } from './utils/log';
import { callForSuccess } from './utils/call-for-success';
import { createAbortController } from './utils/create-abort-controller';

export class BridgeProvider {
    public static async fromStorage(storage: IStorage): Promise<BridgeProvider> {
        const bridgeConnectionStorage = new BridgeConnectionStorage(storage);
        const connection = await bridgeConnectionStorage.getHttpConnection();

        if (isPendingConnectionHttp(connection)) {
            return new BridgeProvider(storage, connection.connectionSource);
        }
        return new BridgeProvider(storage, { bridgeUrl: connection.session.bridgeUrl });
    }

    private readonly connectionStorage: BridgeConnectionStorage;

    private readonly pendingRequests = new Map<string, (response: WithoutId<WalletResponse<RpcMethod>>) => void>();

    private session: BridgeSession | BridgePartialSession | null = null;

    private gateway: BridgeGateway | null = null;

    private pendingGateways: BridgeGateway[] = [];

    private listeners: Array<(e: WithoutIdDistributive<WalletEvent>) => void> = [];

    private readonly defaultOpeningDeadlineMS = 12000;

    private readonly defaultRetryTimeoutMS = 2000;

    private abortController?: AbortController;

    constructor(
        private readonly storage: IStorage,
        private readonly walletConnectionSource:
            | Optional<WalletConnectionSourceHTTP, 'universalLink'>
            | Pick<WalletConnectionSourceHTTP, 'bridgeUrl'>[],
    ) {
        this.connectionStorage = new BridgeConnectionStorage(storage);
    }

    public connect(options?: { openingDeadlineMS?: number; signal?: AbortSignal }): void {
        const abortController = createAbortController(options?.signal);
        this.abortController?.abort();
        this.abortController = abortController;
        this.closeGateway();

        const sessionCrypto = new SessionCrypto();

        this.session = {
            sessionCrypto,
            bridgeUrl: 'bridgeUrl' in this.walletConnectionSource ? this.walletConnectionSource.bridgeUrl : '',
        };

        this.connectionStorage
            .storeConnection({
                type: 'http',
                connectionSource: this.walletConnectionSource,
                sessionCrypto,
            })
            .then(async () => {
                if (abortController.signal.aborted) {
                    return;
                }

                await callForSuccess(
                    (_options) =>
                        this.openGateways(sessionCrypto, {
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

    public async restoreConnection(options?: { openingDeadlineMS?: number; signal?: AbortSignal }): Promise<void> {
        const abortController = createAbortController(options?.signal);
        this.abortController?.abort();
        this.abortController = abortController;

        if (abortController.signal.aborted) {
            return;
        }

        this.closeGateway();
        const storedConnection = await this.connectionStorage.getHttpConnection();
        if (!storedConnection) {
            return;
        }

        if (abortController.signal.aborted) {
            return;
        }

        const openingDeadlineMS = options?.openingDeadlineMS ?? this.defaultOpeningDeadlineMS;

        if (isPendingConnectionHttp(storedConnection)) {
            this.session = {
                sessionCrypto: storedConnection.sessionCrypto,
                bridgeUrl: 'bridgeUrl' in this.walletConnectionSource ? this.walletConnectionSource.bridgeUrl : '',
            };

            return await this.openGateways(storedConnection.sessionCrypto, {
                openingDeadlineMS: openingDeadlineMS,
                signal: abortController?.signal,
            });
        }

        if (Array.isArray(this.walletConnectionSource)) {
            throw new BridgeSdkError(
                'Internal error. Connection source is array while WalletConnectionSourceHTTP was expected.',
            );
        }

        this.session = storedConnection.session;

        if (this.gateway) {
            logDebug('Gateway is already opened, closing previous gateway');
            await this.gateway.close();
        }

        this.gateway = new BridgeGateway(
            this.storage,
            this.walletConnectionSource.bridgeUrl,
            storedConnection.session.sessionCrypto.sessionId,
            this.gatewayListener.bind(this),
            this.gatewayErrorsListener.bind(this),
        );

        if (abortController.signal.aborted) {
            return;
        }

        // notify listeners about stored connection
        this.listeners.forEach((listener) => listener(storedConnection.connectEvent));

        // wait for the connection to be opened
        try {
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
        } catch (_) {
            await this.disconnect({ signal: abortController.signal });
            return;
        }
    }

    public sendRequest<T extends RpcMethod>(
        request: WithoutId<AppRequest<T>>,
        options?: {
            attempts?: number;
            onRequestSent?: () => void;
            signal?: AbortSignal;
        },
    ): Promise<WithoutId<WalletResponse<T>>> {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            if (!this.gateway || !this.session || !('walletPublicKey' in this.session)) {
                throw new BridgeSdkError('Trying to send bridge request without session');
            }

            const id = (await this.connectionStorage.getNextRpcRequestId()).toString();
            await this.connectionStorage.increaseNextRpcRequestId();

            logDebug('Send http-bridge request:', { ...request, id });

            const encodedRequest = this.session!.sessionCrypto.encrypt(
                JSON.stringify({ ...request, id }),
                hexToByteArray(this.session.walletPublicKey),
            );

            try {
                await this.gateway.send(encodedRequest, this.session.walletPublicKey, request.method, {
                    attempts: options?.attempts,
                    signal: options?.signal,
                });
                options?.onRequestSent?.();
                this.pendingRequests.set(id.toString(), resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    public closeConnection(): void {
        this.closeGateway();
        this.listeners = [];
        this.session = null;
        this.gateway = null;
    }

    public async disconnect(options?: { signal?: AbortSignal }): Promise<void> {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve) => {
            let called = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const onRequestSent = (): void => {
                if (!called) {
                    called = true;
                    this.removeBridgeAndSession().then(resolve);
                }
            };

            try {
                this.closeGateway();

                const abortController = createAbortController(options?.signal);
                timeoutId = setTimeout(() => {
                    abortController.abort();
                }, this.defaultOpeningDeadlineMS);

                await this.sendRequest(
                    { method: 'disconnect', params: [] },
                    {
                        onRequestSent: onRequestSent,
                        signal: abortController.signal,
                        attempts: 1,
                    },
                );
            } catch (e) {
                logDebug('Disconnect error:', e);

                if (!called) {
                    this.removeBridgeAndSession().then(resolve);
                }
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                onRequestSent();
            }
        });
    }

    public listen(callback: (e: WithoutIdDistributive<WalletEvent>) => void): () => void {
        this.listeners.push(callback);
        return () => (this.listeners = this.listeners.filter((listener) => listener !== callback));
    }

    public pause(): void {
        this.gateway?.pause();
    }

    public async unPause(): Promise<void> {
        const promises = this.pendingGateways.map((bridge) => bridge.unPause());
        if (this.gateway) {
            promises.push(this.gateway.unPause());
        }
        await Promise.all(promises);
    }

    private async gatewayListener(bridgeIncomingMessage: BridgeIncomingMessage): Promise<void> {
        const walletMessage: WalletMessage = JSON.parse(
            this.session!.sessionCrypto.decrypt(
                Base64.decode(bridgeIncomingMessage.message).toUint8Array(),
                hexToByteArray(bridgeIncomingMessage.from),
            ),
        );

        logDebug('Wallet message received:', walletMessage);

        if (!('event' in walletMessage)) {
            const id = walletMessage.id.toString();
            const resolve = this.pendingRequests.get(id);
            if (!resolve) {
                logDebug(`Response id ${id} doesn't match any request's id`);
                return;
            }

            resolve(walletMessage);
            this.pendingRequests.delete(id);
            return;
        }

        if (walletMessage.id !== undefined) {
            const lastId = await this.connectionStorage.getLastWalletEventId();

            if (lastId !== undefined && walletMessage.id <= lastId) {
                logError(
                    `Received event id (=${walletMessage.id}) must be greater than stored last wallet event id (=${lastId}) `,
                );
                return;
            }

            if (walletMessage.event !== 'connect') {
                await this.connectionStorage.storeLastWalletEventId(walletMessage.id);
            }
        }

        // `this.listeners` might be modified in the event handler
        const listeners = this.listeners;

        if (walletMessage.event === 'connect') {
            await this.updateSession(walletMessage, bridgeIncomingMessage.from);
        }

        if (walletMessage.event === 'disconnect') {
            logDebug(`Removing bridge and session: received disconnect event`);
            await this.removeBridgeAndSession();
        }

        listeners.forEach((listener) => listener(walletMessage));
    }

    private async gatewayErrorsListener(e: Event): Promise<void> {
        throw new BridgeSdkError(`Bridge error ${JSON.stringify(e)}`);
    }

    private async updateSession(connectEvent: ConnectEventSuccess, walletPublicKey: string): Promise<void> {
        this.session = {
            ...this.session!,
            walletPublicKey,
        };

        const tonAddrItem: TonAddressItemReply = connectEvent.payload.items.find(
            (item) => item.name === 'ton_addr',
        ) as TonAddressItemReply;

        const connectEventToSave: BridgeConnectionHttp['connectEvent'] = {
            ...connectEvent,
            payload: {
                ...connectEvent.payload,
                items: [tonAddrItem],
            },
        };

        await this.connectionStorage.storeConnection({
            type: 'http',
            session: this.session,
            lastWalletEventId: connectEvent.id,
            connectEvent: connectEventToSave,
            nextRpcRequestId: 0,
        });
    }

    private async removeBridgeAndSession(): Promise<void> {
        this.closeConnection();
        await this.connectionStorage.removeConnection();
    }

    private async openGateways(
        sessionCrypto: SessionCrypto,
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
            this.walletConnectionSource.bridgeUrl,
            sessionCrypto.sessionId,
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
    }
}
