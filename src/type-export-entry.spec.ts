describe('optional type export entry', () => {
    it('runs the codec without loading generators and enables them on explicit import', () => {
        jest.isolateModules(() => {
            const loadGraph = jest.fn(() => jest.requireActual('./type-graph'));
            jest.doMock('./type-graph', loadGraph);
            try {
                const { runtimeBy } = jest.requireActual<typeof import('./index')>('./index');
                const runtime = runtimeBy('_ n:uint8 = Item;');
                const data = { kind: 'Item', n: 7 };
                expect(runtime.decodeCell(runtime.encodeCell(data))).toEqual(data);
                expect(runtime).not.toHaveProperty('toTypeScript');
                expect(loadGraph).not.toHaveBeenCalled();
                jest.requireActual('./type-export');
                expect(loadGraph).toHaveBeenCalledTimes(1);
                expect(runtime.toTypeScript()).toContain('export type Item');
                expect(runtime.toJSONSchema().$ref).toBe('#/definitions/Item');
            } finally {
                jest.dontMock('./type-graph');
            }
        });
    });
});
