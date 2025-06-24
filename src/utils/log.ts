/* eslint-disable no-console */

export const logDebug: typeof console.debug = (...args) => {
    console.debug('[TON_CONNECT_BRIDGE_SDK]', ...args);
};

export const logError: typeof console.error = (...args) => {
    console.error('[TON_CONNECT_BRIDGE_SDK]', ...args);
};

export const logWarning: typeof console.warn = (...args) => {
    console.warn('[TON_CONNECT_BRIDGE_SDK]', ...args);
};
