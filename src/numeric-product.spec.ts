import { beginCell } from '@ton/core';

import { runtimeBy, TLBDataError } from './index';

it('binds a numeric product in the parent scope', () => {
    const runtime = runtimeBy('_ {n:#} v:(## n) = Small n; _ m:(## 3) s:(Small (2 * m)) = Box;');
    const value = { kind: 'Box', m: 3, s: { kind: 'Small', v: 9 } };
    const wire = beginCell().storeUint(3, 3).storeUint(9, 6).endCell();
    for (const params of [{}, { n: 6 }]) {
        expect(runtime.encodeCell({ ...value, s: { ...value.s, ...params } }).equals(wire)).toBe(true);
    }
    expect(runtime.decodeCell(wire)).toMatchObject({ ...value, s: { ...value.s, n: 6 } });
    expect(() => runtime.encodeCell({ ...value, s: { ...value.s, n: 5 } })).toThrow(TLBDataError);
});
