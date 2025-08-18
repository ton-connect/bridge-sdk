import { delay } from './delay';
import { BridgeSdkError } from '../errors/bridge-sdk.error';
import { logDebug } from './log';

export type RetryOptions = {
    /**
     * The number of attempts to make before giving up. Default is 20.
     */
    attempts?: number;

    /**
     * The delay in milliseconds. If exponential strategy used it doubles every failure. Default is 100ms.
     */
    delayMs?: number;

    /**
     * Whether to use exponential backoff for retry delays.
     * If true, the delay doubles after each failed attempt (e.g., 100ms, 200ms, 400ms...).
     * If false or omitted, the delay remains constant across all attempts.
     */
    exponential?: boolean;
};

/**
 * Configuration options for the callForSuccess function.
 */
export type CallForSuccessOptions = {
    /**
     * An 'AbortSignal' object that can be used to abort the function.
     */
    signal?: AbortSignal;
} & RetryOptions;

/**
 * Function to call ton api until we get response.
 * Because ton network is pretty unstable we need to make sure response is final.
 * @param {T} fn - function to call
 * @param {CallForSuccessOptions} [options] - optional configuration options
 */
export async function callForSuccess<T extends (options: { signal?: AbortSignal }) => Promise<Awaited<ReturnType<T>>>>(
    fn: T,
    options?: CallForSuccessOptions,
): Promise<Awaited<ReturnType<T>>> {
    let { signal, attempts = 10, delayMs = 100 } = options ?? {};

    if (typeof fn !== 'function') {
        throw new BridgeSdkError(`Expected a function, got ${typeof fn}`);
    }

    let i = 0;
    let lastError: unknown;

    while (i < attempts) {
        logDebug(`[callForSuccess] Attempt: ${i}`);
        if (signal?.aborted) {
            throw new BridgeSdkError(`Aborted after attempts ${i}`);
        }

        try {
            return await fn({ signal });
        } catch (err) {
            logDebug(`[callForSuccess], error after attempt ${i}: ${JSON.stringify(err)}`, err);
            lastError = err;
            i++;

            if (i < attempts) {
                await delay(delayMs);
                if (options?.exponential) {
                    delayMs *= 2;
                }
            }
        }
    }

    throw lastError;
}
