import { beginCell } from '@ton/core';

import { runtimeBy } from './index';

it('uses the canonical tlbc tag for a reversed comparison', () => {
    const runtime = runtimeBy('sample a:(## 8) { a >= 5 } = Test;');
    const wire = beginCell().storeUint(0x7dd95f33, 32).storeUint(6, 8).endCell();
    const value = { kind: 'Test', a: 6 };
    expect(runtime.decodeCell(wire)).toEqual(value);
    expect(runtime.encodeCell(value).equals(wire)).toBe(true);
});

it('preserves the empty tag encoded by #8_', () => {
    const runtime = runtimeBy('_#8_ x:uint8 = Box;');
    const wire = beginCell().storeUint(42, 8).endCell();
    const value = { kind: 'Box', x: 42 };
    expect(runtime.decodeCell(wire, { exact: true })).toEqual(value);
    expect(runtime.encodeCell(value).equals(wire)).toBe(true);
});
