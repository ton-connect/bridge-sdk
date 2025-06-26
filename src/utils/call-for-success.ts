import { delay } from './delay';
import { BridgeSdkError } from '../errors/bridge-sdk.error';

/**
 * Configuration options for the callForSuccess function.
 */
export type CallForSuccessOptions = {
    /**
     * An 'AbortSignal' object that can be used to abort the function.
     */
    signal?: AbortSignal;

    /**
     * The number of attempts to make before giving up. Default is 20.
     */
    attempts?: number;

    /**
     * The delay in milliseconds between each attempt. Default is 100ms.
     */
    delayMs?: number;
};

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
    const { signal, attempts = 10, delayMs = 200 } = options ?? {};

    if (typeof fn !== 'function') {
        throw new BridgeSdkError(`Expected a function, got ${typeof fn}`);
    }

    let i = 0;
    let lastError: unknown;

    while (i < attempts) {
        if (signal?.aborted) {
            throw new BridgeSdkError(`Aborted after attempts ${i}`);
        }

        try {
            return await fn({ signal });
        } catch (err) {
            lastError = err;
            i++;

            if (i < attempts) {
                await delay(delayMs);
            }
        }
    }

    throw lastError;
}
