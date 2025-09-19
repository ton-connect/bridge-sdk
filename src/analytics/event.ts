import { CHAIN } from '@tonconnect/protocol';

import {
    BridgeConnectErrorEvent,
    BridgeConnectEstablishedEvent,
    BridgeConnectStartedEvent,
    BridgeRequestDecodeErrorEvent,
    BridgeRequestReceivedEvent,
    BridgeRequestSentEvent,
    BridgeResponseDecodeErrorEvent,
    BridgeResponseReceivedEvent,
} from './types.gen';

export type Event =
    | BridgeConnectErrorEvent
    | BridgeConnectEstablishedEvent
    | BridgeConnectStartedEvent
    | BridgeRequestDecodeErrorEvent
    | BridgeRequestReceivedEvent
    | BridgeRequestSentEvent
    | BridgeResponseDecodeErrorEvent
    | BridgeResponseReceivedEvent;

export type SharedEventData = {
    /**
     * The client environment.
     */
    clientEnvironment: string;
    /**
     * Network id (-239 for the mainnet and -3 for the testnet)
     */
    networkId: CHAIN;
    subsystem: 'dapp' | 'bridge' | 'wallet';
    version: string;
    userId?: string;
    bridgeUrl: string;
};
