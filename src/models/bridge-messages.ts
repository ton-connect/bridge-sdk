import { AppRequest, ConnectEvent, DisconnectEvent, RpcMethod, WalletResponse } from '@tonconnect/protocol';

export type BridgeSharedEvent = { lastEventId: string; from: string; traceId?: string };
export type BridgeAppEvent = AppRequest<RpcMethod> & BridgeSharedEvent;
export type BridgeWalletEvent = WalletResponse<RpcMethod> & BridgeSharedEvent;

export type AppMessage<T extends RpcMethod> = AppRequest<T>;
export type WalletMessage<T extends RpcMethod> = WalletResponse<T> | ConnectEvent | DisconnectEvent;

export type BridgeAppEventListener = (e: BridgeWalletEvent) => void;
export type BridgeWalletEventListener = (e: BridgeAppEvent) => void;

export type AppConsumer = 'app';
export type WalletConsumer = 'wallet';

export type BridgeProviderConsumer = AppConsumer | WalletConsumer;

export type BridgeMessages<TMethod extends RpcMethod> = Record<AppConsumer, AppMessage<TMethod>> &
    Record<WalletConsumer, WalletMessage<TMethod>>;

export type BridgeEventListeners = Record<AppConsumer, BridgeAppEventListener> &
    Record<WalletConsumer, BridgeWalletEventListener>;

export type BridgeIncomingMessage = {
    from: string;
    trace_id?: string;
    message: string;
};
