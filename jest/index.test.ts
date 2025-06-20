import { greet } from '../src/index';

describe('greet()', () => {
    it('returns greeting message', () => {
        expect(greet('Dasha')).toBe('Hello, Dasha');
    });
});