import { KeyPair, SessionCrypto } from '@tonconnect/protocol';

export type ClientsInfo = {
    clients: ClientConnection[];
};

export type StoredClientsInfo = Omit<ClientsInfo, 'clients'> & {
    clients: StoredClientConnection[];
};

export type ClientConnection = {
    nextWalletEventId?: number;
    lastRpcRequestId?: number;
    session: SessionCrypto;
};

export type StoredClientConnection = Omit<ClientConnection, 'session'> & {
    session: KeyPair;
};
