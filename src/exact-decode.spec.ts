import { beginCell } from '@ton/core';

import { runtimeBy, TLBDataError, unwrap } from './index';

const cell = beginCell().storeUint(42, 8).endCell();
it('continues after partial matches within one type and between root types', () => {
    const runtime = runtimeBy('full$_ x:uint8 = Value; short$_ x:uint4 = Value; _ x:uint4 = Other;');
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
