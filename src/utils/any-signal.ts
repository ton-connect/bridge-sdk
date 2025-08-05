function abortSignalAny(iterable: AbortSignal[]) {
    const controller = new AbortController();

    function abort(this: AbortSignal) {
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
    return abortSignalAny(existingSignals);
}
