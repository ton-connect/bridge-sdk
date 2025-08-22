import { logDebug } from '../utils/log';

/**
 * Base class for BridgeSdk errors. You can check if the error was triggered by the @tonconnect/brdige-sdk using `err instanceof BridgeSdkError`.
 */
export class BridgeSdkError<T = unknown> extends Error {
    private static prefix = '[BRIDGE_SDK_ERROR]';

    constructor(
        message?: string,
        options?: {
            cause?: T;
        },
    ) {
        super(message, options);

        this.message = `${BridgeSdkError.prefix} ${message ? '\n' + message : ''}`;
        logDebug(this.message);

        Object.setPrototypeOf(this, BridgeSdkError.prototype);
    }
}

export function isBridgeSdkError(error: unknown): error is BridgeSdkError {
    return error instanceof BridgeSdkError;
}
