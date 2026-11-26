import { Address, beginCell, ExternalAddress } from '@ton/core';

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
        if (type === 'MsgAddressInt') {
            expect(() => r.decodeCell(beginCell().storeUint(0, 2).endCell(), { rootType: 'Root' })).toThrow(
                TLBDataError,
            );
            expect(() => r.encodeCell({ kind: 'Root', address: null })).toThrow(TLBDataError);
            return;
        }
        expect(r.decodeCell(beginCell().storeUint(0, 2).endCell(), { rootType: 'Root', exact: true })).toEqual({
            kind: 'Root',
            address: null,
        });
    });
});

describe.each([runtimeBy, parseTLB])('address variants (%p)', (compile) => {
    it.each(['MsgAddress', 'MsgAddressInt', 'MsgAddressExt'])('round-trips valid %s tags only', (type) => {
        const r = compile(TLBLib.MsgAddress + `_ address:${type} = Root;`);
        const options = { rootType: 'Root', exact: true };
        for (const address of [null, new ExternalAddress(9n, 4), new Address(0, Buffer.alloc(32, 7))]) {
            const cell = beginCell().storeAddress(address).endCell();
            const data = { kind: 'Root', address };
            const internal = Address.isAddress(address);
            if (type === 'MsgAddress' || internal === (type === 'MsgAddressInt')) {
                expect(r.encodeCell(r.decodeCell(cell, options)).equals(cell)).toBe(true);
                expect(r.encodeCell(data).equals(cell)).toBe(true);
            } else {
                expect(() => r.decodeCell(cell, options)).toThrow(TLBDataError);
                expect(() => r.encodeCell(data)).toThrow(TLBDataError);
            }
        }
        const variable = beginCell()
            .storeUint(3, 2)
            .storeBit(0)
            .storeUint(8, 9)
            .storeInt(0, 32)
            .storeUint(42, 8)
            .endCell();
        expect(() => r.decodeCell(variable, options)).toThrow(
            type === 'MsgAddressExt' ? /Invalid address tag/ : /addr_var/,
        );
    });
});
