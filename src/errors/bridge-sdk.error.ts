/**
 * Base class for BridgeSdk errors. You can check if the error was triggered by the @tonconnect/brdige-sdk using `err instanceof BridgeSdkError`.
 */
export class BridgeSdkError<T = unknown> extends Error {
    private static prefix = '[BRIDGE_SDK_ERROR]';

    protected get info(): string {
        return '';
    }

    constructor(
        message?: string,
        options?: {
            cause?: T;
        },
    ) {
        super(message, options);

        this.message = `${BridgeSdkError.prefix} ${this.constructor.name}${
            this.info ? ': ' + this.info : ''
        }${message ? '\n' + message : ''}`;

        Object.setPrototypeOf(this, BridgeSdkError.prototype);
    }
}
