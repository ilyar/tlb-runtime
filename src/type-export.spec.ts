import { resolve } from 'node:path';

import Ajv from 'ajv';
import ts from 'typescript';
import { Address, beginCell, Dictionary } from '@ton/core';

import './type-export';
import { runtimeBy, parseTLB, TLBRuntime, unwrap, replacer, TLBDataError, TLBSchemaError } from './index';
import { TLBStd, TLBLib } from './tesdata';
import { resolveTypeGraph } from './type-graph';

const share =
    TLBStd.Either +
    `
schema_text$01 data:^SnakeString = Schema;
data_json$01 data:^SnakeString = Data;
boc_none$00 = Boc;
boc_cell$01 cell:^Cell = Boc;
boc_raw$10 data:^SnakeString = Boc;
share_v1#01 schema:Schema payload:(Either Boc Data) = Share;`;

describe('resolved type graph', () => {
    it('specializes nested arguments, deduplicates instances and reserves user names before traversal', () => {
        const schema =
            TLBStd.Maybe +
            TLBStd.Either +
            `
            _ = Maybe_uint8; _ = A; _ = B;
            _ x:(Maybe uint8) y:(Maybe ^Cell) z:(Maybe (Either A B)) again:(Maybe uint8) = Root;`;
        const r = runtimeBy(schema);
        const g = resolveTypeGraph(r.getTypes(), 'Root', { rootType: 'Root' });
        expect([...g.types.keys()]).toEqual([
            'Root',
            'Maybe_uint8_1',
            'Maybe_Cell',
            'A',
            'B',
            'Either_A_B',
            'Maybe_Either_A_B',
        ]);
        const fields = g.types.get('Root')!.variants[0].fields;
        expect(fields[3].type).toEqual(fields[0].type);
        expect(r.toJSONSchema().definitions).toHaveProperty('Maybe_uint8');
        expect(r.toJSONSchema().$ref).toBe('#/definitions/Root');
        expect(r.toTypeScript()).toBe(runtimeBy(schema).toTypeScript());
    });
    it('binds numeric arguments, handles pure generics, and rejects invalid options', () => {
        const r = runtimeBy('_ {n:#} x:(## n) = Tree n;');
        const j = r.toJSONSchema({ rootType: 'Tree', args: [8] });
        expect(j.definitions!.Tree_8.properties!.x).toMatchObject({ minimum: 0, maximum: 255, description: '(## n)' });
        expect(() => r.toTypeScript({ rootType: 'Missing' })).toThrow(TLBDataError);
        expect(() => r.toJSONSchema({ args: [] })).toThrow(TLBDataError);
        for (const args of [[-1], [1.5], [8, 9]])
            expect(() => r.toTypeScript({ rootType: 'Tree', args })).toThrow(TLBDataError);
        expect(runtimeBy(TLBStd.Maybe).toTypeScript()).toContain('value: unknown');
    });
    it('closes recursive and mutually recursive references, bounds expanding specializations', () => {
        const s = 'end$0 {X:Type} = List X; cons$1 {X:Type} item:X tail:^(List X) = List X; _ x:(List uint8) = R;';
        expect(runtimeBy(s).toTypeScript({ rootType: 'R' })).toContain('tail: List_uint8;');
        const graph = runtimeBy('a$0 = A; b$1 next:^B = A; _ parent:^A = B;').toJSONSchema({ rootType: 'A' });
        expect(Object.keys(graph.definitions!)).toEqual(['A', 'B']);
        const growing = TLBStd.Maybe + '_ {X:Type} child:^(Loop (Maybe X)) = Loop X; _ x:(Loop uint8) = R;';
        expect(() => runtimeBy(growing).toTypeScript({ rootType: 'R' })).toThrow(TLBSchemaError);
        const doubling = TLBStd.Either + '_ {X:Type} child:^(Nest (Either X X)) = Nest X; _ n:(Nest uint8) = R;';
        expect(() => runtimeBy(doubling).toJSONSchema({ rootType: 'R' })).toThrow(TLBSchemaError);
    });
});

describe('Draft-07 JSON Schema', () => {
    const ajv = new Ajv();
    it('validates actual Share cells for every branch and preserves literal field descriptions', () => {
        const r = runtimeBy(share);
        const j = r.toJSONSchema({ rootType: 'Share', title: 'Share link' });
        expect(j.title).toBe('Share link');
        expect(j.$schema).toBe('http://json-schema.org/draft-07/schema#');
        expect(JSON.parse(JSON.stringify(j))).toEqual(j);
        expect(ajv.validateSchema(j)).toBe(true);
        expect(j.definitions!.Schema.properties!.data.description).toBe('^SnakeString');
        const validate = ajv.compile(j);
        for (const [right, tag] of [
            [0, 0],
            [0, 1],
            [0, 2],
            [1, 1],
        ]) {
            const b = beginCell()
                .storeUint(1, 8)
                .storeUint(1, 2)
                .storeStringRefTail('_ = A;')
                .storeBit(right)
                .storeUint(tag, 2);
            if (right || tag === 2) b.storeStringRefTail('text');
            else if (tag === 1) b.storeRef(beginCell().endCell());
            const cell = b.endCell();
            const decoded = r.decodeCell(cell, { rootType: 'Share' });
            expect(r.encodeCell(decoded).equals(cell)).toBe(true);
            const data = JSON.parse(JSON.stringify(decoded, replacer));
            expect(validate(data)).toBe(true);
            expect(validate({ ...data, typo: 1 })).toBe(false);
            expect(validate({ ...data, payload: { kind: 'Either_left', value: { kind: 'Data', data: 'oops' } } })).toBe(
                false,
            );
            expect(ajv.validate(r.toJSONSchema({ additionalProperties: true }), { ...data, typo: 1 })).toBe(true);
        }
    });
    it('validates arrays, Maybe values, and the 32-bit integer boundary against both codecs', () => {
        const schema =
            TLBStd.Maybe +
            '_ n:uint32 wide:uint33 neg:int33 bits:bits1 values:(2 * uint4) choice:(Maybe ^Cell) = Mixed;';
        const r = runtimeBy(schema);
        const j = r.toJSONSchema({ rootType: 'Mixed' });
        const validate = ajv.compile(j);
        for (const choice of [{ kind: 'Maybe_nothing' }, { kind: 'Maybe_just', value: beginCell().endCell() }]) {
            const value = {
                kind: 'Mixed',
                n: 2 ** 32 - 1,
                wide: 2n ** 32n,
                neg: -(2n ** 32n),
                bits: true,
                values: [0, 15],
                choice,
            };
            const decoded = r.decodeCell(r.encodeCell(value), { rootType: 'Mixed' });
            expect(decoded).toEqual(value);
            const json = JSON.parse(JSON.stringify(decoded, replacer));
            expect(validate(json)).toBe(true);
            expect(validate({ ...json, values: [0] })).toBe(false);
            expect(validate({ ...json, wide: '-1' })).toBe(false);
            expect(validate({ ...json, choice: { kind: 'Maybe_just' } })).toBe(false);
        }
    });
    it('matches numbers, bit strings, conditional fields, anonymous groups, and numeric-key dictionaries', () => {
        const schema =
            TLBLib.MsgAddress +
            TLBLib.HashmapE.replace(TLBStd.Maybe, '') +
            `
            _ i:int4 u:uint5 big:uint256 flags:uint1 opt:flags?uint8 bytes:bits16 dst:MsgAddress
              table:(HashmapE 8 uint4) ^[ uint3 ] = Values;`;
        const r = runtimeBy(schema),
            j = r.toJSONSchema({ rootType: 'Values' });
        const p = j.definitions!.Values.properties!;
        expect(p.i).toMatchObject({ minimum: -8, maximum: 7 });
        expect(p.u).toMatchObject({ minimum: 0, maximum: 31 });
        expect(j.definitions!.Values.required).not.toContain('opt');
        for (const flags of [0, 1]) {
            const v = {
                kind: 'Values',
                i: -2,
                u: 7,
                big: 1n << 120n,
                flags,
                ...(flags ? { opt: 6 } : {}),
                bytes: 'hi',
                dst: Address.parseRaw('0:' + '12'.repeat(32)),
                table: { '3': 9 },
                anon1: 5,
            };
            const d = r.decodeCell(r.encodeCell(v), { rootType: 'Values' });
            const json = JSON.parse(
                JSON.stringify(d, (k, v) =>
                    v instanceof Dictionary
                        ? Object.fromEntries([...v].map(([key, value]) => [String(key), value]))
                        : replacer(k, v),
                ),
            );
            expect(ajv.validate(j, json)).toBe(true);
            expect(ajv.validate(j, { ...json, u: 32 })).toBe(false);
            expect(ajv.validate(j, { ...json, table: { '3': 16 } })).toBe(false);
        }
        const coins = parseTLB('_ a:Coins = R;');
        const value = coins.decodeCell(beginCell().storeCoins(25n).endCell());
        expect(ajv.validate(coins.toJSONSchema(), JSON.parse(JSON.stringify(value, replacer)))).toBe(true);
    });
});

// Compile a virtual consumer in the project directory so normal package resolution is exercised.
function diagnostics(source: string) {
    const name = resolve('type-export-consumer.ts');
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        types: ['node'],
    };
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (file, ...args) =>
        file === name ? ts.createSourceFile(name, source, options.target!) : read(file, ...args);
    return ts
        .getPreEmitDiagnostics(ts.createProgram([name], options, host))
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('TypeScript declarations', () => {
    it('imports just the native types in use and respects emitter options', () => {
        const r = runtimeBy(
            TLBLib.MsgAddress + TLBLib.HashmapE + '_ dst:MsgAddress table:(HashmapE 64 ^Cell) bits:bits16 = R;',
        );
        expect(r.toTypeScript({ rootType: 'R' }).split('\n')[0]).toBe(
            "import type { Address, BitString, Cell, Dictionary, ExternalAddress } from '@ton/core';",
        );
        const plain = r.toTypeScript({
            rootType: 'R',
            includeImports: false,
            exportTypes: false,
            includeComments: false,
        });
        expect(plain).not.toMatch(/import |export |\/\*\*/);
        expect(plain).toContain('Dictionary<bigint, Cell>');
        expect(runtimeBy('_ n:uint32 = R;').toTypeScript()).not.toContain('import ');
        expect(unwrap(TLBRuntime.from('_ x:bits16 = R;', { autoText: false })).toTypeScript()).toContain(
            'x: BitString;',
        );
    });
    it('compiles a strict consumer, discriminates every branch and detects invalid inputs', () => {
        const r = runtimeBy(share + ' leaf$0 n:uint256 b:bits16 = Tree; node$1 next:^Tree = Tree;');
        const tsCode =
            r.toTypeScript() +
            `
import { beginCell } from '@ton/core';
import { TLBRuntime } from './src';
const runtime = TLBRuntime.from<Share>('');
const bc: Boc = {kind:'Boc_boc_cell',cell:beginCell().endCell()};
const empty: Boc = {kind:'Boc_boc_none'};
const raw: Boc = {kind:'Boc_boc_raw',data:'bad'};
const data: Data = {kind:'Data',data:'{}'};
function share(payload: Either_Boc_Data): Share {return {kind:'Share',schema:{kind:'Schema',data:''},payload};}
share({kind:'Either_right',value:data});
for(const value of [empty,raw,bc]) share({kind:'Either_left',value});
function preview(s: Share) {
    if(s.payload.kind === 'Either_right') return s.payload.value.data.toUpperCase();
    const value = s.payload.value;
    if(value.kind === 'Boc_boc_cell') return value.cell.toBoc();
    if(value.kind === 'Boc_boc_raw') return value.data.toUpperCase();
}
const tree: Tree = {kind:'Tree_node',next:{kind:'Tree_leaf',n:42n,b:'hi'}};
`;
        expect(diagnostics(tsCode)).toEqual([]);
        expect(diagnostics(tsCode + "\nconst bad: Boc = {kind:'Boc_boc_cell',cell:'abc'};")).toEqual([
            expect.stringContaining("not assignable to type 'Cell'"),
        ]);
    });
});

it('exports address variants and constructor choices accepted by the codec', () => {
    const schema = TLBLib.MsgAddress + 'a$0 = Choice; b$1 = Choice; _ i:MsgAddressInt e:MsgAddressExt c:Choice = Root;';
    const runtime = runtimeBy(schema);
    const types = runtime.toTypeScript({ rootType: 'Root' });
    expect(types).toContain('i: Address;');
    expect(types).toContain('e: ExternalAddress | null;');
    expect(types).toContain('Choice_a');
    expect(types).toContain('Choice_b');
    const fields = runtime.toJSONSchema({ rootType: 'Root' }).definitions!.Root.properties!;
    expect(fields.i).toMatchObject({ type: 'string', 'x-tlb-type': 'MsgAddressInt' });
    expect(fields.e.oneOf).toEqual([{ type: 'string' }, { type: 'null' }]);
});
