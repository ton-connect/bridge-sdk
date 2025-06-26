import { SessionCrypto } from '@tonconnect/protocol';

import { BridgeSdkError } from '../errors/bridge-sdk.error';
import { ClientConnection, ClientsInfo, StoredClientsInfo } from '../models/bridge/client-connection';
import { IStorage } from './models/storage.interface';

export class ClientConnectionStorage {
    private readonly storeKey = 'ton-connect-storage_client-connections';

    constructor(private readonly storage: IStorage) {}

    public async getClients(): Promise<ClientsInfo> {
        const raw = await this.storage.getItem(this.storeKey);
        if (!raw) return { clients: [] };

        const parsed: StoredClientsInfo = JSON.parse(raw);
        return {
            ...parsed,
            clients: parsed.clients.map((c) => ({
                ...c,
                session: new SessionCrypto(c.session),
            })),
        };
    }

    public async storeClients(data: ClientsInfo): Promise<void> {
        const serialized: StoredClientsInfo = {
            ...data,
            clients: data.clients.map((c) => ({
                ...c,
                session: c.session.stringifyKeypair(),
            })),
        };
        await this.storage.setItem(this.storeKey, JSON.stringify(serialized));
    }

    public async addClient(client: ClientConnection): Promise<ClientsInfo> {
        const data = await this.getClients();
        const exists = data.clients.some((c) => c.session.sessionId === client.session.sessionId);
        if (!exists) {
            data.clients.push(client);
            await this.storeClients(data);
        }
        return data;
    }

    public async getClient(clientId: string): Promise<ClientConnection | null> {
        const data = await this.getClients();
        return data.clients.find((c) => c.session.sessionId === clientId) ?? null;
    }

    private async updateClient(clientId: string, patch: Partial<ClientConnection>): Promise<ClientConnection> {
        const data = await this.getClients();
        const idx = data.clients.findIndex((c) => c.session.sessionId === clientId);
        if (idx === -1) throw new BridgeSdkError(`Client with sessionId ${clientId} not found`);

        const updated = { ...data.clients[idx], ...patch };
        data.clients[idx] = updated;
        await this.storeClients(data);

        return updated;
    }

    public async removeClient(clientId: string): Promise<ClientsInfo> {
        const data = await this.getClients();
        const index = data.clients.findIndex((c) => c.session.sessionId === clientId);
        if (index === -1) return data;

        data.clients.splice(index, 1);
        await this.storeClients(data);
        return data;
    }

    public async getClientNextEventId(clientId: string): Promise<number> {
        const client = await this.getClient(clientId);
        return client?.nextWalletEventId ?? 0;
    }

    public async incrementClientNextEventId(clientId: string): Promise<number> {
        const client = await this.getClient(clientId);
        if (!client) throw new BridgeSdkError(`Client with sessionId ${clientId} not found`);

        const next = (client.nextWalletEventId ?? 0) + 1;
        await this.updateClient(clientId, { nextWalletEventId: next });
        return next;
    }

    public async getClientRpcId(clientId: string): Promise<number> {
        const client = await this.getClient(clientId);
        return client?.lastRpcRequestId ?? 0;
    }

    public async setClientRpcId(clientId: string, rpcId: number): Promise<number> {
        await this.updateClient(clientId, { lastRpcRequestId: rpcId });
        return rpcId;
    }
}
