import { beginCell } from '@ton/core';

import { runtimeBy, TLBDataError, unwrap } from './index';

const cell = beginCell().storeUint(42, 8).endCell();
it('continues after partial matches within one type and between root types', () => {
    const runtime = runtimeBy('short$_ x:uint4 = Value; full$_ x:uint8 = Value; _ x:uint4 = Other;');
    expect(runtime.decodeCell(cell).kind).toBe('Other');
    expect(runtime.decodeCell(cell, { rootType: 'Value' }).kind).toBe('Value_short');
    for (const rootType of [undefined, 'Value']) {
        expect(runtime.decodeCell(cell, { rootType, exact: true })).toEqual({ kind: 'Value_full', x: 42 });
    }
    expect(() => runtime.decodeCell(cell, { rootType: 'Other', exact: true })).toThrow('4 bits and 0 refs');
    const extra = beginCell().storeSlice(cell.beginParse()).storeRef(cell).endCell();
    expect(() => runtime.decodeCell(extra, { exact: true })).toThrow(TLBDataError);
    expect(runtime.deserialize(extra, { exact: true }).success).toBe(false);
});

it('checks only the root, preserves tie order and accepts numeric bindings', () => {
    const nested = runtimeBy('_ x:uint4 = Short; _ nested:^Short = Parent;');
    expect(nested.decodeCell(beginCell().storeRef(cell).endCell(), { rootType: 'Parent', exact: true }).kind).toBe(
        'Parent',
    );
    const tie = runtimeBy('_ x:uint8 = A; _ y:uint8 = B;');
    expect(tie.decodeCell(cell, { exact: true })).toEqual(tie.decodeCell(cell));
    const sized = runtimeBy('_ {n:#} x:(uint n) = Sized n;');
    expect(unwrap(sized.deserialize(cell, { rootType: 'Sized', args: [8], exact: true }))).toMatchObject({ x: 42 });
    expect(() => sized.decodeCell(cell, { args: [] })).toThrow(TLBDataError);
});

it('consumes the bits and references of an inline Cell in exact mode', () => {
    const runtime = runtimeBy('_ header:uint8 body:Cell = Msg;');
    const body = beginCell().storeBit(1).storeRef(cell).endCell();
    const msg = beginCell().storeUint(7, 8).storeSlice(body.beginParse()).endCell();
    const options = { rootType: 'Msg', exact: true };
    for (const decoded of [runtime.decodeCell(msg, options), unwrap(runtime.deserialize(msg, options))]) {
        expect(decoded).toMatchObject({ kind: 'Msg', header: 7 });
        expect(runtime.encodeCell(decoded).equals(msg)).toBe(true);
    }
});

it.each([
    ['#', 32, 1],
    ['uint8', 8, 8],
] as const)('reads only the explicit %s field for a constant result argument', (field, bits, argument) => {
    const runtime = runtimeBy(`_ n:${field} = P ${argument};`);
    const wire = beginCell().storeUint(7, bits).endCell();
    const options = { rootType: 'P', exact: true };
    const data = { kind: 'P', n: 7 };
    expect(runtime.decodeCell(wire, options)).toEqual(data);
    expect(runtime.encodeCell(data).equals(wire)).toBe(true);
    const extra = beginCell().storeUint(5, 32).storeSlice(wire.beginParse()).endCell();
    expect(() => runtime.decodeCell(extra, options)).toThrow(TLBDataError);
});

it('reports an incomplete root even when a fieldless helper exactly fits the empty cell', () => {
    const runtime = runtimeBy('unit$_ = Unit; _ x:uint32 = Root;');
    expect(() => runtime.decodeCell(beginCell().endCell(), { exact: true })).toThrow(TLBDataError);
});

it('finds an earlier exact root after a missing reference or an incomplete tag', () => {
    const leaf = beginCell().endCell();
    const runtime = runtimeBy('_ a:^Cell = Inner; _ i:^Inner = Outer;');
    const cell = beginCell().storeRef(leaf).endCell();
    expect(runtime.decodeCell(cell, { exact: true })).toEqual({ kind: 'Inner', a: leaf });
    const tagged = runtimeBy('a$10 = A; b$1010 = B;');
    expect(tagged.decodeCell(beginCell().storeUint(2, 2).endCell(), { exact: true })).toEqual({ kind: 'A' });
});

it('tries a fully consuming root after a nested anonymous group runs out of references', () => {
    const runtime = runtimeBy('_ leaf:^Cell = Earlier; _ ^[ ^[ a:uint8 ] ] = Outer;');
    const leaf = beginCell().endCell();
    const wire = beginCell().storeRef(leaf).endCell();
    expect(runtime.decodeCell(wire, { exact: true })).toEqual({ kind: 'Earlier', leaf });
});
