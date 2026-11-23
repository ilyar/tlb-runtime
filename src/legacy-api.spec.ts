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

    it('retains the schema error exposed by parseTLB', () => {
        expect(() => parseTLB('_')).toThrow(TLBSchemaError);
        expect(() => parseTLB('_')).toThrow('Bad Schema');
    });
});
