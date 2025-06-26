import { BridgeSdkError } from '../errors/bridge-sdk.error';

/**
 * Configuration options for the delay function.
 */
export type DelayFnOptions = {
    /**
     * An 'AbortSignal' object that can be used to abort the delay.
     */
    signal?: AbortSignal;
};

/**
 * Delays the execution of code for a specified number of milliseconds.
 * @param {number} timeout - The number of milliseconds to delay the execution.
 * @param {DelayOptions} [options] - Optional configuration options for the delay.
 * @return {Promise<void>} - A promise that resolves after the specified delay, or rejects if the delay is aborted.
 */
export async function delay(timeout: number, options?: DelayFnOptions): Promise<void> {
    if (options?.signal?.aborted) {
        throw new BridgeSdkError('Delay aborted');
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const timeoutId = setTimeout(resolve, timeout);
    options?.signal?.addEventListener(
        'abort',
        () => {
            clearTimeout(timeoutId);
            reject(new BridgeSdkError('Delay aborted'));
        },
        { once: true },
    );

    return promise;
}
