/* eslint-disable no-console */

// Possible log levels: 'debug', 'warning', 'error'
const LOG_LEVEL = process.env.BRIDGE_SDK_LOG_LEVEL || 'error';

export const logDebug: typeof console.debug = (...args) => {
    if (LOG_LEVEL === 'debug') {
        console.debug('[BRIDGE_SDK_LOG]', ...args);
    }
};

export const logError: typeof console.error = (...args) => {
    console.error('[BRIDGE_SDK_LOG]', ...args);
};

export const logWarning: typeof console.warn = (...args) => {
    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'warning') {
        console.warn('[BRIDGE_SDK_LOG]', ...args);
    }
};
