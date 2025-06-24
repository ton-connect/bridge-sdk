export type WithoutId<T extends { id: unknown }> = Omit<T, 'id'>;
export type WithoutIdDistributive<T extends { id: unknown }> = DistributiveOmit<T, 'id'>;

export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
