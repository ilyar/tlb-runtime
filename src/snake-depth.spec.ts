import { beginCell } from '@ton/core';

import { runtimeBy, TLBDataError, TLBSchemaError } from './index';

it('counts only string cells, preserves UTF-8 bytes across splits and ignores sibling refs', () => {
    const schema = 'm$1 child:^Cell prefix:uint8 text:SnakeString = M;';
    const limited = runtimeBy(schema, { maxSnakeDepth: 2 });
    let child = beginCell().endCell();
    for (let i = 0; i < 8; i++) child = beginCell().storeRef(child).endCell();
    const data = { kind: 'M', child, prefix: 0, text: 'я'.repeat(126) };
    const cell = runtimeBy(schema).encodeCell(data);
    expect(limited.encodeCell(data).equals(cell)).toBe(true);
    expect(limited.decodeCell(cell, { exact: true })).toEqual(data);
    const longer = { ...data, text: data.text + 'xx' };
    expect(() => limited.encodeCell(longer)).toThrow(TLBDataError);
    expect(() => limited.decodeCell(runtimeBy(schema).encodeCell(longer), { rootType: 'M' })).toThrow(
        'exceeds 2 cells',
    );
});

it('applies the same inclusive limit to referenced strings, including empty cells', () => {
    const limited = runtimeBy('_ s:^SnakeString = S;', { maxSnakeDepth: 1 });
    for (const s of ['', 'x'.repeat(127)]) expect(limited.decodeCell(limited.encodeCell({ kind: 'S', s })).s).toBe(s);
    expect(() => limited.encodeCell({ kind: 'S', s: 'x'.repeat(128) })).toThrow('exceeds 1 cells');
    expect(() => runtimeBy('_ = S;', { maxSnakeDepth: 0 })).toThrow(TLBSchemaError);
});
