import { beginCell } from '@ton/core';

import { runtimeBy, parseTLB, TLBDataError } from './index';
import { TLBLib, TLBStd } from './tesdata';

describe('variable-width numeric type arguments', () => {
    it.each(['##', 'uint', 'int'])('reads Maybe (%s n) with the width in the enclosing cell', (type) => {
        const r = runtimeBy(TLBStd.Maybe + `_ n:uint4 field:(Maybe (${type} n)) = Root;`);
        const cell = beginCell().storeUint(3, 4).storeBit(true).storeUint(6, 3).endCell();
        expect(r.decodeCell(cell, { rootType: 'Root', exact: true })).toEqual({
            kind: 'Root',
            n: 3,
            field: { kind: 'Maybe_just', value: type === 'int' ? -2 : 6 },
        });
    });

    it.each([
        [0, 3, 6, 'Either_left'],
        [1, 8, 129, 'Either_right'],
    ] as const)('preserves both Either parameter slots for tag %i', (tag, width, value, kind) => {
        const r = runtimeBy(TLBStd.Either + '_ n:uint4 field:(Either (uint n) uint8) = Root;');
        const cell = beginCell().storeUint(3, 4).storeBit(tag).storeUint(value, width).endCell();
        expect(r.decodeCell(cell, { rootType: 'Root', exact: true })).toEqual({
            kind: 'Root',
            n: 3,
            field: { kind, value },
        });
    });
});

describe.each([runtimeBy, parseTLB])('MsgAddress tag (%p)', (compile) => {
    it.each(['MsgAddress', 'MsgAddressInt', 'MsgAddressExt'])('requires two bits for %s', (type) => {
        const r = compile(TLBLib.MsgAddress + `_ address:${type} = Root;`);
        for (const slice of [beginCell(), beginCell().storeBit(0), beginCell().storeBit(1)]) {
            expect(() => r.decodeCell(slice.endCell(), { rootType: 'Root' })).toThrow(TLBDataError);
        }
        expect(r.decodeCell(beginCell().storeUint(0, 2).endCell(), { rootType: 'Root', exact: true })).toEqual({
            kind: 'Root',
            address: null,
        });
    });
});
