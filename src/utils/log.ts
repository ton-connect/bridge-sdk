/* eslint-disable no-console */

import { getEnv, hasEnv } from './environment';

const isDebugDisabled = hasEnv() && !getEnv('TONBRIDGE_DEBUG');

export const logDebug: typeof console.debug = (...args) => {
    if (isDebugDisabled) return;

    console.debug('[TON_CONNECT_BRIDGE_SDK]', ...args);
};

export const logError: typeof console.error = (...args) => {
    console.error('[TON_CONNECT_BRIDGE_SDK]', ...args);
};

export const logWarn: typeof console.warn = (...args) => {
    console.warn('[TON_CONNECT_BRIDGE_SDK]', ...args);
};
