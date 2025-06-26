export function anySignal(...signals: (AbortSignal | null | undefined)[]) {
    const existingSignals = signals.filter((signal) => signal !== null && signal !== undefined);
    return AbortSignal.any(existingSignals);
}
