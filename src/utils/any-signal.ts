// TODO: fixme
function AbortSignalany(iterable: AbortSignal[]) {
    const controller = new AbortController();
    /**
     * @this AbortSignal
     */
    function abort() {
        // @ts-expect-error e
        controller.abort(this.reason);
        clean();
    }
    function clean() {
        for (const signal of iterable) signal.removeEventListener('abort', abort);
    }
    for (const signal of iterable)
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        } else signal.addEventListener('abort', abort);

    return controller.signal;
}

export function anySignal(...signals: (AbortSignal | null | undefined)[]) {
    const existingSignals = signals.filter((signal) => signal !== null && signal !== undefined);
    return AbortSignalany(existingSignals);
}
