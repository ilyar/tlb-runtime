import { beginCell } from '@ton/core';

import { runtimeBy } from './index';

it.each(['^[ a:uint8 ] ^[ a:uint8 ]', 'a:uint8 ^[ a:uint8 ]', '^[ ^[ a:uint8 ] ] a:uint8', '^[ uint8 ] anon1:uint8'])(
    'rejects colliding decoded keys for %s',
    (fields) => {
        expect(() => runtimeBy(`_ ${fields} = Row;`)).toThrow(
            /Duplicate decoded field .* in Row at fields.* and fields/,
        );
    },
);

it('preserves both values from anonymous reference groups', () => {
    const child = (n: number) => beginCell().storeUint(n, 8).endCell();
    const input = beginCell().storeRef(child(3)).storeRef(child(5)).endCell();
    const r = runtimeBy('_ ^[ a:uint8 ] ^[ b:uint8 ] = Row;');
    const result = r.decodeCell(input, { rootType: 'Row', exact: true });
    expect(result).toEqual({ kind: 'Row', a: 3, b: 5 });
    expect(r.encodeCell(result).equals(input)).toBe(true);
});
