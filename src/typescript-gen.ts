import type { ResolvedField, ResolvedFieldType, ResolvedTypeGraph, TypeExportOptions } from './type-graph';

export interface TypeScriptOptions extends TypeExportOptions {
    includeImports?: boolean;
    exportTypes?: boolean;
    includeComments?: boolean;
}

export function typescript(graph: ResolvedTypeGraph, options: TypeScriptOptions): string {
    const imports = new Set<string>();
    function core(name: string): string {
        imports.add(name);
        return name;
    }
    function comment(text: string): string {
        return options.includeComments === false ? '' : '/** ' + text.replace(/\*\//g, '* /') + ' */\n';
    }
    function property(f: ResolvedField): string {
        const name = /^[a-zA-Z_$][\w$]*$/.test(f.name) ? f.name : JSON.stringify(f.name);
        return comment(f.tlbType) + name + (f.optional ? '?' : '') + ': ' + field(f.type) + ';';
    }
    function field(t: ResolvedFieldType): string {
        switch (t.kind) {
            case 'ref':
                return t.target;
            case 'number':
            case 'bigint':
            case 'string':
            case 'unknown':
                return t.kind;
            case 'boolean':
                return t.value === undefined ? 'boolean' : String(t.value);
            case 'cell':
                return core('Cell');
            case 'bits': {
                if (t.bitLength === 1) return 'boolean';
                const choices = [core('BitString')];
                if (t.autoText && (t.bitLength === undefined || t.bitLength % 8 === 0)) choices.push('string');
                if (t.bitLength === undefined) choices.push('boolean');
                return choices.join(' | ');
            }
            case 'address':
                if (t.variant === 'int') return core('Address');
                if (t.variant === 'ext') return core('ExternalAddress') + ' | null';
                return [core('Address'), core('ExternalAddress'), 'null'].join(' | ');
            case 'nullable':
                return field(t.inner) + ' | null';
            case 'dictionary':
                return (
                    core('Dictionary') +
                    '<' +
                    (t.keyBits === undefined ? 'number | bigint' : t.keyBits > 32 ? 'bigint' : 'number') +
                    ', ' +
                    field(t.value) +
                    '>'
                );
            case 'array':
                return 'Array<' + field(t.item) + '>';
            case 'tuple':
                return 'Array<' + core('TupleItem') + '>';
            case 'object':
                return '{\n' + indent(t.fields.map(property).join('\n')) + '\n}';
        }
    }
    function indent(s: string): string {
        return s
            .split('\n')
            .map((line) => '    ' + line)
            .join('\n');
    }
    const blocks = [...graph.types.values()].map((t) => {
        const variants = t.variants.map((v) => {
            const fields = [
                comment(v.declaration) + 'kind: ' + JSON.stringify(v.kind) + ';',
                ...v.fields.map(property),
            ];
            return '{\n' + indent(fields.join('\n')) + '\n}';
        });
        return (
            comment(t.tlbName) +
            (options.exportTypes === false ? '' : 'export ') +
            'type ' +
            t.name +
            ' = ' +
            (t.alias ? field(t.alias) : variants.join(' | ') || 'never') +
            ';'
        );
    });
    if (imports.size && options.includeImports !== false)
        blocks.unshift('import type { ' + [...imports].sort().join(', ') + " } from '@ton/core';");
    return blocks.join('\n\n') + '\n';
}
