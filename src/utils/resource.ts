import { BridgeSdkError } from '../errors/bridge-sdk.error';
import { createAbortController } from './create-abort-controller';

/**
 * The resource interface.
 */
export type Resource<T, Args extends unknown[]> = {
    /**
     * Create a new resource.
     */
    create: (abortSignal?: AbortSignal, ...args: Args) => Promise<T>;

    /**
     * Get the current resource.
     */
    current: () => T | null;

    /**
     * Dispose the current resource.
     */
    dispose: () => Promise<void>;
};

/**
 * Create a resource.
 *
 * @template T - The type of the resource.
 * @template Args - The type of the arguments for creating the resource.
 *
 * @param {(...args: Args) => Promise<T>} createFn - A function that creates the resource.
 * @param {(resource: T) => Promise<void>} [disposeFn] - An optional function that disposes the resource.
 */
export function createResource<T extends EventSource, Args extends unknown[]>(
    createFn: (signal?: AbortSignal, ...args: Args) => Promise<T>,
    disposeFn: (resource: T) => Promise<void>,
): Resource<T, Args> {
    let currentResource: T | null = null;
    let currentPromise: Promise<T> | null = null;
    let abortController: AbortController | null = null;

    // create a new resource
    const create = async (signal?: AbortSignal, ...args: Args): Promise<T> => {
        abortController?.abort();
        abortController = createAbortController(signal);

        if (abortController.signal.aborted) {
            throw new BridgeSdkError('Resource creation was aborted');
        }

        const promise = createFn(abortController.signal, ...args);
        currentPromise = promise;
        const resource = await promise;

        if (currentPromise !== promise && resource !== currentResource) {
            await disposeFn(resource);
            throw new BridgeSdkError('Resource creation was aborted by a new resource creation');
        }

        currentResource = resource;
        return currentResource;
    };

    // get the current resource
    const current = (): T | null => {
        return currentResource ?? null;
    };

    // dispose the current resource
    const dispose = async (): Promise<void> => {
        try {
            const resource = currentResource;
            currentResource = null;

            const promise = currentPromise;
            currentPromise = null;

            try {
                abortController?.abort();
            } catch {
                /* empty */
            }

            await Promise.allSettled([
                resource ? disposeFn(resource) : Promise.resolve(),
                promise ? disposeFn(await promise) : Promise.resolve(),
            ]);
        } catch {
            /* empty */
        }
    };

    return {
        create,
        current,
        dispose,
    };
}
