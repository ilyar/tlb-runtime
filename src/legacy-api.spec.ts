import { beginCell } from '@ton/core';

import {
    decodeCell,
    encodeCell,
    parseCell,
    ParsedCell,
    parseTLB,
    TLBDataError,
    TLBRuntime,
    TLBSchemaError,
    unwrap,
} from './index';

interface Signed {
    kind: 'Signed';
    value: number;
}

describe('legacy public API', () => {
    const schema = '_ value:int32 = Signed;';
    const cell = beginCell().storeInt(-3, 32).endCell();

    it('supports existing imports and a record interface without an index signature', () => {
        const runtime = parseTLB<Signed>(schema);
        const parsed: ParsedCell = parseCell(schema, cell);
        expect(runtime).toBeInstanceOf(TLBRuntime);
        expect(runtime.parseCell(cell.toBoc().toString('base64'))).toEqual(parsed);
        expect(parsed).toEqual(decodeCell(schema, cell));
        expect(encodeCell(schema, parsed).equals(cell)).toBe(true);
        expect(runtime.encodeCell(parsed).equals(cell)).toBe(true);
        expect(unwrap(runtime.deserialize(cell)).value).toBe(-3);
        expect(runtime.types.get('Signed')).toBe(runtime.getTypes().get('Signed'));
    });

    it('round-trips every field in a TON Connect OffchainOrder', () => {
        const orderSchema = [
            'offchain_order$_ salt:uint32 market_id:uint32',
            'maker_amount:(VarUInteger 16) taker_amount:(VarUInteger 16)',
            'is_buy:Bool is_yes:Bool creator_pub_key:uint256 = OffchainOrder;',
        ].join(' ');
        const order = beginCell()
            .storeUint(1, 32)
            .storeUint(2, 32)
            .storeCoins(60000000n)
            .storeCoins(100000000n)
            .storeBit(true)
            .storeBit(false)
            .storeUint(123n, 256)
            .endCell();
        const runtime = unwrap(parseTLB(schema).changeSchema(orderSchema));
        const value = runtime.parseCell(order);
        expect(value).toEqual({
            kind: 'OffchainOrder',
            salt: 1,
            market_id: 2,
            maker_amount: 60000000n,
            taker_amount: 100000000n,
            is_buy: true,
            is_yes: false,
            creator_pub_key: 123n,
        });
        expect(runtime.encodeCell(value).equals(order)).toBe(true);
    });

    it('retains the schema error exposed by parseTLB', () => {
        expect(() => parseTLB('_')).toThrow(TLBSchemaError);
        expect(() => parseTLB('_')).toThrow('Bad Schema');
    });
});

describe('public encoding of alpha.4 records', () => {
    it.each(['', 'bool_false$0 = Bool; bool_true$1 = Bool; '])(
        'round-trips both Bool values with declarations %j',
        (prefix) => {
            const schema = prefix + '_ flag:Bool = Foo;';
            for (const flag of [false, true]) {
                const cell = beginCell().storeBit(flag).endCell();
                const record = parseCell(schema, cell);
                expect(record).toEqual({ kind: 'Foo', flag });
                expect(encodeCell(schema, record).equals(cell)).toBe(true);
                expect(encodeCell(schema, { kind: 'Foo', flag }).equals(cell)).toBe(true);
            }
        },
    );

    it.each(['Coins', '(VarUInteger 16)'])('round-trips shorthand %s', (type) => {
        const schema = `_ amount:${type} = Foo;`;
        const cell = beginCell().storeCoins(435n).endCell();
        const record = parseCell(schema, cell);
        expect(record).toEqual({ kind: 'Foo', amount: 435n });
        for (const value of [record, { kind: 'Foo', amount: 435n }, decodeCell(schema, cell)]) {
            expect(encodeCell(schema, value).equals(cell)).toBe(true);
        }
    });

    it('accepts const0 for a legacy const field and preserves explicit const0 fields', () => {
        const schema = '_ const:uint8 = Foo;';
        const cell = beginCell().storeUint(15, 8).endCell();
        const parsed = parseCell(schema, cell);
        expect(parsed).toEqual({ kind: 'Foo', const0: 15 });
        for (const record of [parsed, { kind: 'Foo', const0: 15 }, decodeCell(schema, cell)]) {
            expect(encodeCell(schema, record).equals(cell)).toBe(true);
        }
        const both = '_ const:uint8 const0:uint8 = Foo;';
        const pair = beginCell().storeUint(2, 8).storeUint(3, 8).endCell();
        expect(encodeCell(both, decodeCell(both, pair)).equals(pair)).toBe(true);
        expect(() => encodeCell(both, { kind: 'Foo', const0: 3 })).toThrow();
    });
});

describe.each(['#< 3', '#<= 2'])('legacy bounded natural (%s)', (bound) => {
    const runtime = parseTLB(`_ x:(${bound}) = T;`);
    const options = { rootType: 'T', exact: true };

    it('round-trips the largest permitted value', () => {
        const cell = beginCell().storeUint(2, 2).endCell();
        const data = { kind: 'T', x: 2 };
        expect(runtime.decodeCell(cell, options)).toEqual(data);
        expect(runtime.encodeCell(data).equals(cell)).toBe(true);
    });

    it('rejects the unused two-bit pattern on read and write', () => {
        const cell = beginCell().storeUint(3, 2).endCell();
        expect(() => runtime.decodeCell(cell, options)).toThrow(TLBDataError);
        expect(() => runtime.encodeCell({ kind: 'T', x: 3 })).toThrow(TLBDataError);
    });
});
