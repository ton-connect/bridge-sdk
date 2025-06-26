import { BridgeSdkError } from '../errors/bridge-sdk.error';
import { anySignal } from './any-signal';

/**
 * Represents the options for deferring a task.
 */
export type DeferOptions = {
    /**
     * The timeout in milliseconds after which the task should be aborted.
     */
    timeout?: number;

    /**
     * An optional AbortSignal to use for aborting the task.
     */
    signal?: AbortSignal;
};

/**
 * Represents a deferrable action that can be executed asynchronously.
 *
 * @template T The type of the value returned by the deferrable action.
 * @param {DeferOptions} [options] The options to configure the deferrable action.
 * @returns {Promise<T>} A promise that resolves with the result of the deferrable action.
 */
export type Deferrable<T> = (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
    options: DeferOptions,
) => Promise<void>;

/**
 * Executes a function and provides deferred behavior, allowing for a timeout and abort functionality.
 *
 * @param {Deferrable<T>} fn - The function to execute. It should return a promise that resolves with the desired result.
 * @param {DeferOptions} options - Optional configuration options for the defer behavior.
 * @returns {Promise<T>} - A promise that resolves with the result of the executed function, or rejects with an error if it times out or is aborted.
 */
export async function timeout<T>(fn: Deferrable<T>, options?: DeferOptions): Promise<T> {
    const { timeout, signal } = options ?? {};

    const { resolve, reject, promise } = Promise.withResolvers<T>();

    if (signal?.aborted) {
        reject(new BridgeSdkError('Operation aborted'));
        return promise;
    }

    const timeoutSignal = typeof timeout !== 'undefined' ? AbortSignal.timeout(timeout) : null;

    const deferOptions = { timeout, abort: anySignal(signal, timeoutSignal) };
    await fn(resolve, reject, deferOptions);

    return promise;
}
