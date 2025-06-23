import { delay } from './delay';
import { createAbortController } from './abort-controller';
import { BridgeGatewayError } from '../errors/BridgeGatewayError';

/**
 * The resource interface.
 */
export type Resource<T, Args extends any[]> = {
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

    /**
     * Recreate the current resource.
     */
    recreate: (delayMs: number) => Promise<T>;
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
    let currentArgs: Args | null = null;
    let currentPromise: Promise<T> | null = null;
    let currentSignal: AbortSignal | null = null;
    let abortController: AbortController | null = null;

    // create a new resource
    const create = async (signal?: AbortSignal, ...args: Args): Promise<T> => {
        currentSignal = signal ?? null;

        abortController?.abort();
        abortController = createAbortController(signal);

        if (abortController.signal.aborted) {
            throw new BridgeGatewayError('Resource creation was aborted');
        }

        currentArgs = args ?? null;

        const promise = createFn(abortController.signal, ...args);
        currentPromise = promise;
        const resource = await promise;

        if (currentPromise !== promise && resource !== currentResource) {
            await disposeFn(resource);
            throw new BridgeGatewayError('Resource creation was aborted by a new resource creation');
        }

        currentResource = resource;
        return currentResource;
    };

    const current = (): T | null => {
        return currentResource ?? null;
    };

    const dispose = async (): Promise<void> => {
        try {
            const resource = currentResource;
            currentResource = null;

            const promise = currentPromise;
            currentPromise = null;

            try {
                abortController?.abort();
            } catch (e) {}

            await Promise.allSettled([
                resource ? disposeFn(resource) : Promise.resolve(),
                promise ? disposeFn(await promise) : Promise.resolve(),
            ]);
        } catch (e) {}
    };

    const recreate = async (delayMs: number): Promise<T> => {
        const resource = currentResource;
        const promise = currentPromise;
        const args = currentArgs;
        const signal = currentSignal;

        await delay(delayMs);

        if (
            resource === currentResource &&
            promise === currentPromise &&
            args === currentArgs &&
            signal === currentSignal
        ) {
            return await create(currentSignal!, ...((args ?? []) as Args));
        }

        throw new BridgeGatewayError('Resource recreation was aborted by a new resource creation');
    };

    return {
        create,
        current,
        dispose,
        recreate,
    };
}
