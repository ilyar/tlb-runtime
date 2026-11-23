import { beginCell } from '@ton/core';

import { decodeCell, encodeCell, parseCell, ParsedCell, parseTLB, TLBRuntime, TLBSchemaError, unwrap } from './index';

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
