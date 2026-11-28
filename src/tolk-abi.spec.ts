import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beginCell, Dictionary } from '@ton/core';

import { runtimeBy, TLBRuntime, TolkABI, TLBSchemaError, unwrap } from './index';

const fixture = (): TolkABI =>
    JSON.parse(readFileSync(resolve(__dirname, '../testdata/tolk/Counter.abi.json'), 'utf8'));

it('decodes compiler-generated ABI and exported TL-B with the same codec', () => {
    const abi = fixture();
    const compiled = runtimeBy(abi);
    const balances = Dictionary.empty(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32)).set(4, 99);
    const note = beginCell().storeStringRefTail('hello').storeCoins(1000).storeDict(balances).storeUint(7, 8).endCell();
    const storage = beginCell()
        .storeUint(7, 32)
        .storeUint(0x43, 8)
        .storeBit(true)
        .storeBit(true)
        .storeRef(note)
        .endCell();
    for (const runtime of [
        compiled,
        runtimeBy(JSON.stringify(abi)),
        runtimeBy(compiled.toTLB()),
        runtimeBy(runtimeBy(compiled.toTLB()).toTolkABI()),
    ]) {
        const data = runtime.decodeCell(storage, { rootType: 'Storage', exact: true });
        expect(data).toMatchObject({
            kind: 'Storage',
            count: { value: 7 },
            body: { kind: 'Command_reset', enabled: true },
            note: { value: { text: 'hello', amount: 1000n, phase: { kind: 'Phase_enum_done' } } },
        });
        expect(runtime.encodeCell(data).equals(storage)).toBe(true);
    }
});

it('retains ABI metadata and isolates it from callers and schema changes', () => {
    const abi = fixture();
    const runtime = unwrap(TLBRuntime.from(abi));
    expect(runtime.toTolkABI()).toEqual(abi);
    abi.storage = {};
    runtime.toTolkABI().declarations.pop();
    expect(runtime.toTolkABI()).toEqual(fixture());
    const next = unwrap(runtime.changeSchema('_ x:uint8 = Next;'));
    expect(next.toTolkABI().contract_name).toBe('');
    expect(unwrap(next.changeSchema(fixture())).toTolkABI()).toEqual(fixture());
});

it('exports TL-B tagged constructors, nested references and leading zero bits to ABI', () => {
    const schema = 'leaf$001 value:uint12 = Leaf; off$00 = State; on$01 leaf:^Leaf = State;';
    const runtime = runtimeBy(schema);
    expect(runtime.toTLB()).toBe(schema);
    const abi = runtime.toTolkABI();
    expect(abi.unique_types.slice(0, 12)).toEqual(fixture().unique_types.slice(0, 12));
    const leaf = beginCell().storeUint(1, 3).storeUint(42, 12).endCell();
    const cell = beginCell().storeUint(1, 2).storeRef(leaf).endCell();
    const imported = runtimeBy(abi);
    const rebuilt = runtimeBy(runtimeBy(imported.toTLB()).toTolkABI());
    for (const r of [runtime, imported, rebuilt]) {
        const data = r.decodeCell(cell, { rootType: 'State', exact: true });
        expect(data).toEqual({ kind: 'State_on', leaf: { kind: 'Leaf', value: 42 } });
        expect(r.encodeCell(data).equals(cell)).toBe(true);
    }
});

it.each([
    (abi: TolkABI) => {
        abi.abi_schema_version = '2.0';
    },
    (abi: TolkABI) => {
        abi.declarations[0].custom_pack_unpack = {};
    },
    (abi: TolkABI) => {
        abi.declarations[0].ty_idx = 1000;
    },
    (abi: TolkABI) => {
        abi.unique_types[abi.declarations[0].ty_idx as number].kind = 'unknown';
    },
])('returns a schema error for an incompatible ABI', (change) => {
    const abi = fixture();
    change(abi);
    expect(() => runtimeBy(abi)).toThrow(TLBSchemaError);
});

it('reports an unrepresentable TL-B constraint during ABI export', () => {
    const r = runtimeBy('_ n:(## 8) { n <= 3 } = Limited;');
    expect(() => r.toTolkABI()).toThrow(/Limited.*constraints/);
    expect(r.decodeCell(beginCell().storeUint(2, 8).endCell())).toEqual({ kind: 'Limited', n: 2 });
});
