/* eslint-disable no-console */

// Possible log levels: 'debug', 'warning', 'error'
const LOG_LEVEL = process.env.TON_CONNECT_BRIDGE_SDK_LOG_LEVEL || 'error';

export const logDebug: typeof console.debug = (...args) => {
    if (LOG_LEVEL === 'debug') {
        console.debug('[TON_CONNECT_BRIDGE_SDK]', ...args);
    }
};

export const logError: typeof console.error = (...args) => {
    console.error('[TON_CONNECT_BRIDGE_SDK]', ...args);
};

export const logWarning: typeof console.warn = (...args) => {
    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'warning') {
        console.warn('[TON_CONNECT_BRIDGE_SDK]', ...args);
    }
};
