export function distinct<T>(items: T[]) {
    return [...new Set(items)];
}

export function equalsDistinct<T>(itemsA: T[], itemsB: T[]) {
    const setA = new Set(itemsA);
    const setB = new Set(itemsB);

    if (setA.size !== setB.size) return false;
    for (let item of setA) {
        if (!setB.has(item)) return false;
    }
    return true;
}
