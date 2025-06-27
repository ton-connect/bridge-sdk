import {
    AppRequest,
    Base64,
    ConnectEvent,
    DisconnectEvent,
    hexToByteArray,
    RpcMethod,
    SessionCrypto,
    WalletResponse,
} from '@tonconnect/protocol';

import { BridgeSdkError } from './errors/bridge-sdk.error';
import { BridgeGateway } from './bridge-gateway';
import { BridgeIncomingMessage } from './models/bridge-incomming-message';
import { logDebug } from './utils/log';
import { callForSuccess, RetryOptions } from './utils/call-for-success';
import { createAbortController } from './utils/create-abort-controller';
import { ClientConnection } from './models/client-connection';

export type AppRequestListener = (e: AppRequest<RpcMethod> & { lastEventId: string }) => void;

export class BridgeProvider {
    private clients: ClientConnection[] = [];

    private gateway: BridgeGateway | null = null;

    private readonly defaultOpeningDeadlineMS = 14000;
    private readonly defaultRetryTimeoutMS = 2000;

    private abortController?: AbortController;

    constructor(
        private readonly bridgeUrl: string,
        private listener: AppRequestListener | null = null,
    ) {}

    public async restoreConnection(
        clients: ClientConnection[],
        options?: { lastEventId?: string; openingDeadlineMS?: number; signal?: AbortSignal },
    ): Promise<void> {
        const abortController = createAbortController(options?.signal);
        this.abortController?.abort();
        this.abortController = abortController;

        if (abortController.signal.aborted) {
            return;
        }

        this.closeGateway();

        if (abortController.signal.aborted) {
            return;
        }

        const openingDeadlineMS = options?.openingDeadlineMS ?? this.defaultOpeningDeadlineMS;
        this.clients = clients;

        // wait for the connection to be opened till abort signal
        await callForSuccess(
            ({ signal }) =>
                this.openGateway(
                    this.clients.map((client) => client.session),
                    {
                        lastEventId: options?.lastEventId,
                        openingDeadlineMS: openingDeadlineMS,
                        signal,
                    },
                ),
            {
                attempts: Number.MAX_SAFE_INTEGER,
                delayMs: this.defaultRetryTimeoutMS,
                signal: abortController.signal,
                exponential: true,
            },
        );
    }

    public async send<T extends RpcMethod>(
        response: WalletResponse<T> | ConnectEvent | DisconnectEvent,
        session: SessionCrypto,
        clientSessionId: string,
        options?: {
            signal?: AbortSignal;
        } & RetryOptions,
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

        await callForSuccess(
            async ({ signal }) => {
                await this.gateway?.send(encodedRequest, session.sessionId, clientSessionId, {
                    attempts: options?.attempts,
                    signal,
                });
            },
            {
                attempts: options?.attempts ?? Number.MAX_SAFE_INTEGER,
                delayMs: options?.delayMs ?? this.defaultRetryTimeoutMS,
                signal: options?.signal,
            },
        );
    }

    public closeConnection(): void {
        this.closeGateway();
        this.listener = null;
        this.clients = [];
    }

    public listen(callback: AppRequestListener) {
        this.listener = callback;
    }

    public pause(): void {
        this.gateway?.pause();
    }

    public async unPause(): Promise<void> {
        await this.gateway?.unPause();
    }

    public getCryptoSession(clientSessionId: string) {
        const client = this.clients.find(({ session }) => session.sessionId === clientSessionId);
        if (!client) {
            throw new BridgeSdkError('Client session does not exist');
        }
        return client.session;
    }

    private async gatewayListener(e: MessageEvent<string>): Promise<void> {
        let bridgeIncomingMessage: BridgeIncomingMessage;
        try {
            bridgeIncomingMessage = JSON.parse(e.data);
        } catch {
            throw new BridgeSdkError(`Bridge message parse failed, message ${e.data}`);
        }

        const sessionCrypto = this.getCryptoSession(bridgeIncomingMessage.from);

        const request = JSON.parse(
            sessionCrypto.decrypt(
                Base64.decode(bridgeIncomingMessage.message).toUint8Array(),
                hexToByteArray(bridgeIncomingMessage.from),
            ),
        ) as AppRequest<RpcMethod>;

        logDebug('Bridge message received:', request);

        this.listener?.({ lastEventId: e.lastEventId, ...request });
    }

    private async gatewayErrorsListener(e: Event): Promise<void> {
        throw new BridgeSdkError(`Bridge error ${JSON.stringify(e)}`);
    }

    private async openGateway(
        sessions: SessionCrypto[],
        options?: {
            lastEventId?: string;
            openingDeadlineMS?: number;
            signal?: AbortSignal;
        },
    ): Promise<void> {
        if (this.gateway) {
            logDebug(`Gateway is already opened, closing previous gateway`);
            await this.gateway.close();
        }

        if (options?.signal?.aborted) {
            return;
        }

        this.gateway = new BridgeGateway(
            this.bridgeUrl,
            sessions.map(({ sessionId }) => sessionId),
            this.gatewayListener.bind(this),
            this.gatewayErrorsListener.bind(this),
            options?.lastEventId,
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
