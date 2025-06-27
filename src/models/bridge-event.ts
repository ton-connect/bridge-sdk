import { AppRequest, RpcMethod } from '@tonconnect/protocol';

export type BridgeEvent = AppRequest<RpcMethod> & { lastEventId: string };
export type BridgeEventListener = (e: BridgeEvent) => void;
