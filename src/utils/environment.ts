export function hasEnv() {
    return typeof process !== 'undefined' && !!process.env;
}

export function getEnv(envName: string): string | undefined {
    return process?.env?.[envName];
}
