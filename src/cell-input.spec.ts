import { beginCell } from '@ton/core';

import { decodeCell, parseCell, runtimeBy, TLBRuntime, unwrap, TLBDataError, TypedCell } from './index';

const schema = '_ x:uint8 = Full;';
const bytes = beginCell().storeUint(42, 8).endCell().toBoc();

it('reads one root from the exact byte view across the public decoders', () => {
    const padded = new Uint8Array(bytes.length + 2);
    padded.set(bytes, 1);
    for (const input of [bytes, new Uint8Array(bytes), padded.subarray(1, -1)]) {
        const runtime = runtimeBy<{ kind: 'Full'; x: number }>(schema);
        const typed: { kind: 'Full'; x: number } = runtime.decodeCell(input);
        const fallback: TypedCell = unwrap(TLBRuntime.from(schema)).decodeCell(input);
        expect(typed).toEqual({ kind: 'Full', x: 42 });
        expect(fallback).toEqual(typed);
        expect(decodeCell(schema, input)).toEqual(typed);
        expect(parseCell(schema, input)).toEqual(typed);
        expect(unwrap(runtime.deserialize(input))).toEqual(typed);
    }
    for (const input of [padded, Buffer.from('b5ee9c7201010202000600010002aa0002bb', 'hex')]) {
        expect(() => decodeCell(schema, input)).toThrow(TLBDataError);
        expect(runtimeBy(schema).deserialize(input).success).toBe(false);
    }
});
