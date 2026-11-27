import { beginCell, Builder, Cell, Slice } from '@ton/core';

import { TLBDataError } from './errors';

function checkDepth(depth: number, limit: number) {
    if (depth > limit) throw new TLBDataError(`SnakeString exceeds ${limit} cells`);
}

export function readSnakeString(slice: Slice, limit: number): string {
    const chunks: Buffer[] = [];
    for (;;) {
        checkDepth(chunks.length + 1, limit);
        if (slice.remainingBits % 8 || slice.remainingRefs > 1) throw new TLBDataError('Invalid SnakeString cell');
        chunks.push(slice.loadBuffer(slice.remainingBits / 8));
        if (!slice.remainingRefs) return Buffer.concat(chunks).toString('utf8');
        slice = slice.loadRef().beginParse();
    }
}

export function writeSnakeString(value: string, builder: Builder, limit: number): void {
    const firstBytes = Math.floor(builder.availableBits / 8);
    const length = Buffer.byteLength(value, 'utf8');
    checkDepth(1 + Math.ceil(Math.max(0, length - firstBytes) / 127), limit);
    const bytes = Buffer.from(value, 'utf8');
    let next: Cell | undefined;
    for (let end = length; end > firstBytes; ) {
        const start = firstBytes + 127 * Math.floor((end - firstBytes - 1) / 127);
        const tail = beginCell().storeBuffer(bytes.subarray(start, end));
        if (next) tail.storeRef(next);
        next = tail.endCell();
        end = start;
    }
    builder.storeBuffer(bytes.subarray(0, firstBytes));
    if (next) builder.storeRef(next);
}
