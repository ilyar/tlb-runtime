import { beginCell, Dictionary } from '@ton/core';

import { parseTLB, runtimeBy } from './index';
import { TLBLib } from './tesdata';

it.each([false, true])('retains the leaf codec when the decoded dictionary starts populated=%s', (populated) => {
    const runtime = runtimeBy(TLBLib.HashmapE + '_ entries:(HashmapE 8 uint16) = Box;');
    const expected = Dictionary.empty(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(16));
    if (populated) expected.set(1, 1234);
    const input = beginCell().storeDict(expected).endCell();
    const { entries } = runtime.decodeCell(input, { rootType: 'Box' });
    if (!(entries instanceof Dictionary)) throw new Error('Expected Dictionary');
    expect(beginCell().storeDict(entries).endCell().equals(input)).toBe(true);
    expected.set(3, 5678);
    entries.set(3, 5678);
    expect(beginCell().storeDict(entries).endCell().equals(beginCell().storeDict(expected).endCell())).toBe(true);
});

it('keeps a native codec for direct dictionaries with wide keys and reference leaves', () => {
    const runtime = parseTLB('_ entries:(Hashmap 48 ^Cell) = Box;');
    const key = Dictionary.Keys.BigUint(48);
    const codec = Dictionary.Values.Cell();
    const expected = Dictionary.empty(key, codec);
    const id = 1n << 40n;
    expected.set(id, beginCell().storeUint(42, 8).endCell());
    const input = beginCell().storeDictDirect(expected).endCell();
    const { entries } = runtime.decodeCell(input, { rootType: 'Box', exact: true });
    if (!(entries instanceof Dictionary)) throw new Error('Expected Dictionary');
    expect(beginCell().storeDictDirect(entries).endCell().equals(input)).toBe(true);
    entries.set(id, beginCell().storeUint(43, 8).endCell());
    const output = beginCell().storeDictDirect(entries).endCell();
    expect(output.beginParse().loadDictDirect(key, codec).get(id)?.beginParse().loadUint(8)).toBe(43);
});
