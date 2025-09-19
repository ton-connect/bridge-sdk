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

export type SharedEventData = Pick<
    Event,
    'client_environment' | 'network_id' | 'subsystem' | 'version' | 'user_id' | 'bridge_url'
>;
