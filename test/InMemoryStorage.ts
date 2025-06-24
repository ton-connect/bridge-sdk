import { IStorage } from '@tonconnect/sdk';

export class InMemoryStorage implements IStorage {
    private storage = new Map<string, string>();

    async setItem(key: string, value: string): Promise<void> {
        this.storage.set(key, value);
    }

    async getItem(key: string): Promise<string | null> {
        return this.storage.get(key)!;
    }

    async removeItem(key: string): Promise<void> {
        this.storage.delete(key);
    }
}
