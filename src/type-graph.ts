import { TLBDataError, TLBSchemaError } from './errors';
import { MathExprEvaluator } from './MathExprEvaluator';
import type { TLBField, TLBFieldType, TLBMathExpr, TLBType } from './types';

export interface TypeExportOptions {
    /** Export this root and its dependencies. */
    rootType?: string;
    /** Numeric TL-B arguments in result-type order. */
    args?: readonly number[];
}

export type ResolvedFieldType =
    | { kind: 'number'; min?: number; max?: number }
    | { kind: 'bigint'; signed: boolean; bitWidth?: number }
    | { kind: 'boolean'; value?: boolean }
    | { kind: 'string' | 'cell' | 'unknown' | 'tuple' }
    | { kind: 'bits'; bitLength?: number; autoText: boolean }
    | { kind: 'address'; variant: 'any' | 'int' | 'ext' }
    | { kind: 'dictionary'; keyBits?: number; value: ResolvedFieldType }
    | { kind: 'nullable'; inner: ResolvedFieldType }
    | { kind: 'array'; item: ResolvedFieldType; length?: number }
    | { kind: 'object'; fields: ResolvedField[] }
    | { kind: 'ref'; target: string };

export interface ResolvedField {
    name: string;
    optional: boolean;
    type: ResolvedFieldType;
    tlbType: string;
}
export interface ResolvedVariant {
    kind?: string;
    constructorName: string;
    declaration: string;
    tag?: string;
    fields: ResolvedField[];
}
export interface ResolvedType {
    name: string;
    tlbName: string;
    variants: ResolvedVariant[];
    /** Some named types have a native representation when used as fields. */
    alias?: ResolvedFieldType;
}
export interface ResolvedTypeGraph {
    root?: string;
    types: Map<string, ResolvedType>;
}

function expr(e: TLBMathExpr): string {
    switch (e.kind) {
        case 'TLBNumberExpr':
            return String(e.n);
        case 'TLBVarExpr':
            return e.x;
        case 'TLBUnaryOp':
            return e.operation + expr(e.value);
        case 'TLBBinaryOp':
            return '(' + expr(e.left) + ' ' + e.operation + ' ' + expr(e.right) + ')';
    }
}

function spelling(t: TLBFieldType): string {
    switch (t.kind) {
        case 'TLBNamedType':
            return [
                t.name,
                ...t.arguments.map((a) =>
                    a.kind === 'TLBNamedType' && a.arguments.length ? '(' + spelling(a) + ')' : spelling(a),
                ),
            ].join(' ');
        case 'TLBNumberType':
            return t.upperBound ? '(#<= ' + expr(t.upperBound) + ')' : (t.signed ? 'int' : 'uint') + expr(t.bits);
        case 'TLBExprMathType':
            return expr(t.initialExpr);
        case 'TLBNegatedType':
            return '~' + t.variableName;
        case 'TLBBitsType':
            return 'bits' + expr(t.bits);
        case 'TLBRefType':
        case 'TLBCellInsideType':
            return '^' + spelling(t.value);
        case 'TLBVarIntegerType':
            return (t.signed ? 'VarInteger ' : 'VarUInteger ') + expr(t.n);
        case 'TLBHashmapType':
            return (t.directStore ? 'Hashmap ' : 'HashmapE ') + expr(t.key) + ' ' + spelling(t.value);
        case 'TLBCondType':
        case 'TLBConditionalType':
            return expr(t.condition) + '?' + spelling(t.value);
        case 'TLBMultipleType':
            return expr(t.times) + ' * ' + spelling(t.value);
        case 'TLBCellType':
            return 'Cell';
        case 'TLBBoolType':
            return 'Bool';
        case 'TLBAddressType':
            return t.name ?? 'MsgAddress';
        case 'TLBCoinsType':
            return 'Coins';
        case 'TLBTupleType':
            return 'VmStack';
        case 'TLBExoticType':
            return 'exotic';
    }
}

// Normalization merges equivalent TL-B spellings (e.g. "uint8" and "(## 8)").
// Keep the declaration's spelling for field hover text when it is available.
function sourceSpellings(declaration: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const match of declaration.matchAll(/\b([\w]+)\s*:\s*/g)) {
        const start = match.index! + match[0].length;
        let end = start;
        let depth = 0;
        for (; end < declaration.length; end++) {
            const ch = declaration[end];
            if (!depth && /[\s;=\]})]/.test(ch)) break;
            if (ch === '(' || ch === '[') depth++;
            if (ch === ')' || ch === ']') depth--;
        }
        result.set(match[1], declaration.slice(start, end));
    }
    return result;
}

interface Argument {
    label: string;
    type: ResolvedFieldType;
    nat?: number;
}
const unknown: ResolvedFieldType = { kind: 'unknown' };
const reserved = new Set(
    (
        'Address BitString Cell Dictionary ExternalAddress TupleItem Array Promise Record ' +
        'any unknown never number bigint boolean string object symbol undefined null void this true false ' +
        'interface type import export default enum class extends new function const let var in of for ' +
        'abstract implements package public private protected static yield await break case catch continue debugger delete do else finally if instanceof return super switch throw try typeof while with'
    ).split(' '),
);

function identifier(raw: string): string {
    const id = raw.replace(/[^a-zA-Z0-9_$]+/g, '_');
    return /^[a-zA-Z_$]/.test(id) ? id : '_' + id;
}

export function resolveTypeGraph(
    source: ReadonlyMap<string, TLBType>,
    lastTypeName?: string,
    options: TypeExportOptions = {},
    autoText = true,
): ResolvedTypeGraph {
    const { rootType, args } = options;
    if (args && rootType === undefined) throw new TLBDataError('Type arguments require a root type');
    const types = new Map<string, ResolvedType>();
    const memo = new Map<string, string>();
    const names = new Set(reserved);
    function allocate(base: string): string {
        let name = identifier(base);
        for (let i = 1; names.has(name); i++) name = identifier(base) + '_' + i;
        names.add(name);
        return name;
    }
    const baseNames = new Map(Array.from(source.keys(), (name) => [name, allocate(name)]));
    function instantiate(t: TLBType, actual: Argument[], depth: number, alias?: ResolvedFieldType): string {
        const key = JSON.stringify([t.name, actual.map((a) => [a.label, a.nat, a.type]), !!alias]);
        const existing = memo.get(key);
        if (existing) return existing;
        if (types.size >= 512 || depth > 32) throw new TLBSchemaError('Type export exceeded the instantiation limit');
        const labels = actual.map((a) => a.label);
        const name = actual.length
            ? allocate([t.name, ...labels.map((label) => label.replace(/^\^/, ''))].join('_'))
            : baseNames.get(t.name)!;
        const displayArgs = actual.map((a) => {
            const display = a.type.kind === 'ref' ? types.get(a.type.target)?.tlbName : undefined;
            return display?.includes(' ') ? '(' + display + ')' : a.label;
        });
        const tlbName = [t.name, ...displayArgs].join(' ');
        // Repeating the same type argument twice per level can grow its spelling exponentially.
        if (tlbName.length > 4096) throw new TLBSchemaError('Type export exceeded the expanded type name limit');
        const definition: ResolvedType = { name, tlbName, variants: [] };
        types.set(name, definition);
        memo.set(key, name);
        if (alias) {
            definition.alias = alias;
            return name;
        }
        for (const ctor of t.constructors) {
            if (
                ctor.parameters.some(
                    (p, i) =>
                        p.paramExpr?.kind === 'TLBNumberExpr' &&
                        !p.variable.negated &&
                        actual[i]?.nat !== undefined &&
                        actual[i].nat !== p.paramExpr.n,
                )
            )
                continue;
            const bindings = new Map<string, Argument>();
            const numbers = new Map<string, number>();
            ctor.parameters.forEach((p, i) => {
                const a = actual[i];
                if (a && p.paramExpr?.kind !== 'TLBBinaryOp') {
                    bindings.set(p.variable.name, a);
                    if (a.nat !== undefined) numbers.set(p.variable.name, a.nat);
                }
            });
            const evaluator = new MathExprEvaluator(numbers);
            function nat(e: TLBMathExpr): number | undefined {
                try {
                    const value = evaluator.evaluate(e);
                    return Number.isSafeInteger(value) ? value : undefined;
                } catch {
                    return undefined;
                }
            }
            function argument(f: TLBFieldType, numeric: boolean): Argument {
                if (f.kind === 'TLBNamedType' && bindings.has(f.name)) return bindings.get(f.name)!;
                if (f.kind === 'TLBRefType' || f.kind === 'TLBCellInsideType') {
                    const inner = argument(f.value, false);
                    return { label: '^' + inner.label, type: inner.type };
                }
                const expression =
                    f.kind === 'TLBExprMathType'
                        ? f.initialExpr
                        : numeric && f.kind === 'TLBNumberType'
                          ? f.bits
                          : undefined;
                if (expression) {
                    const n = nat(expression);
                    return { label: String(n ?? '?'), type: unknown, nat: n };
                }
                const type = resolve(f);
                return { label: type.kind === 'ref' ? type.target : spelling(f), type };
            }
            function resolve(f: TLBFieldType): ResolvedFieldType {
                switch (f.kind) {
                    case 'TLBNamedType': {
                        const bound = bindings.get(f.name);
                        if (bound) return bound.type;
                        if (f.name === 'SnakeString') return { kind: 'string' };
                        if (f.name === 'Cell' || f.name === 'Any') return { kind: 'cell' };
                        if (f.name === 'Bool') return { kind: 'boolean' };
                        if (/^MsgAddress(Int|Ext)?$/.test(f.name))
                            return {
                                kind: 'address',
                                variant:
                                    f.name === 'MsgAddressInt' ? 'int' : f.name === 'MsgAddressExt' ? 'ext' : 'any',
                            };
                        if (['VarInteger', 'VarUInteger', 'Grams'].includes(f.name))
                            return { kind: 'bigint', signed: f.name === 'VarInteger' };
                        if (f.name === 'HashmapE' && f.arguments.length === 2) {
                            const args = [argument(f.arguments[0], true), argument(f.arguments[1], false)];
                            const dictionary: ResolvedFieldType = {
                                kind: 'dictionary',
                                keyBits: args[0].nat,
                                value: args[1].type,
                            };
                            const target = source.get(f.name);
                            return target
                                ? { kind: 'ref', target: instantiate(target, args, depth + 1, dictionary) }
                                : dictionary;
                        }
                        if (f.name === '#<' || f.name === '#<=') {
                            const bound = f.arguments[0] && argument(f.arguments[0], true).nat;
                            return {
                                kind: 'number',
                                min: 0,
                                max: bound === undefined ? undefined : bound - Number(f.name === '#<'),
                            };
                        }
                        const target = source.get(f.name);
                        if (!target) return unknown;
                        const params = target.constructors[0]?.parameters;
                        const actuals = f.arguments.map((a, i) => argument(a, params?.[i]?.variable.type === '#'));
                        return { kind: 'ref', target: instantiate(target, actuals, depth + 1) };
                    }
                    case 'TLBRefType':
                    case 'TLBCellInsideType':
                    case 'TLBConditionalType':
                    case 'TLBCondType':
                        return resolve(f.value);
                    case 'TLBNumberType': {
                        const width = nat(f.bits);
                        if (width === undefined)
                            return f.maxBits !== undefined && f.maxBits <= 32 ? { kind: 'number' } : unknown;
                        if (width > 32 && !(f.maxBits !== undefined && f.maxBits <= 32))
                            return { kind: 'bigint', signed: f.signed, bitWidth: width };
                        const size = f.signed && width ? 2 ** (width - 1) : 2 ** width;
                        return {
                            kind: 'number',
                            min: f.signed && width ? -size : 0,
                            max: f.upperBound ? nat(f.upperBound) : size - 1,
                        };
                    }
                    case 'TLBBoolType':
                        return { kind: 'boolean', value: f.value };
                    case 'TLBBitsType':
                        return { kind: 'bits', bitLength: nat(f.bits), autoText };
                    case 'TLBCoinsType':
                    case 'TLBVarIntegerType':
                        return { kind: 'bigint', signed: f.kind === 'TLBVarIntegerType' && f.signed };
                    case 'TLBCellType':
                        return { kind: 'cell' };
                    case 'TLBAddressType':
                        return {
                            kind: 'address',
                            variant: f.name === 'MsgAddressInt' ? 'int' : f.name === 'MsgAddressExt' ? 'ext' : 'any',
                        };
                    case 'TLBHashmapType':
                        return { kind: 'dictionary', keyBits: nat(f.key), value: resolve(f.value) };
                    case 'TLBMultipleType':
                        return { kind: 'array', item: resolve(f.value), length: nat(f.times) };
                    case 'TLBTupleType':
                        return { kind: 'tuple' };
                    default:
                        return unknown;
                }
            }
            const original = sourceSpellings(ctor.declaration);
            let anon = 0;
            function fields(list: TLBField[], nested = false): ResolvedField[] {
                const result: ResolvedField[] = [];
                for (const f of list) {
                    if (f.implicit) continue;
                    if (f.subFields.length && !f.name) {
                        if (!nested) anon++; // Only the outer reference group consumes an anonymous index.
                        result.push(...fields(f.subFields, true));
                        continue;
                    }
                    const key = f.name || 'anon' + anon++;
                    const type =
                        f.subFields.length > 1
                            ? { kind: 'object' as const, fields: fields(f.subFields) }
                            : resolve(f.subFields[0]?.fieldType ?? f.fieldType);
                    result.push({
                        name: key,
                        optional: f.fieldType.kind === 'TLBCondType' || f.fieldType.kind === 'TLBConditionalType',
                        type,
                        tlbType: (f.name && original.get(f.name)) || spelling(f.fieldType),
                    });
                }
                return result;
            }
            const output = fields(ctor.fields);
            // deserializeConstructor promotes the x property of this legacy type to bigint.
            if (t.name === 'ExprType' && t.constructors.length === 1) {
                const x = output.find((f) => f.name === 'x');
                if (x) x.type = { kind: 'bigint', signed: true };
            }
            // The decoder exposes inferred natural numbers when it can determine their values.
            for (const v of ctor.variables) {
                if (v.type === '#' && !/^(_res|param)\d+$/.test(v.name) && !output.some((f) => f.name === v.name)) {
                    output.push({ name: v.name, type: { kind: 'number' }, optional: true, tlbType: '#' });
                }
            }
            const tag = ctor.declaration.match(/^\s*[\w]+([#$][\da-fA-F_]+)/)?.[1];
            definition.variants.push({
                kind: t.isAnon ? undefined : t.constructors.length === 1 ? t.name : t.name + '_' + ctor.name,
                constructorName: ctor.name,
                declaration: ctor.declaration,
                tag,
                fields: output,
            });
        }
        return name;
    }

    if (rootType !== undefined) {
        const target = source.get(rootType);
        if (!target) throw new TLBDataError('Unknown root type: ' + rootType);
        const numbers = args ?? [];
        if (
            !target.constructors.some((c) => c.parameters.length >= numbers.length) ||
            numbers.some((n) => !Number.isSafeInteger(n) || n < 0)
        )
            throw new TLBDataError('Invalid numeric root arguments');
        return {
            types,
            root: instantiate(
                target,
                numbers.map((n) => ({ nat: n, label: String(n), type: unknown })),
                0,
            ),
        };
    }
    const roots = [...source.values()].filter((t) =>
        t.constructors.some((c) => !c.parameters.some((p) => p.variable.type === 'Type')),
    );
    for (const t of roots.length ? roots : source.values()) instantiate(t, [], 0);
    const last = lastTypeName && source.get(lastTypeName);
    return { types, root: last ? instantiate(last, [], 0) : undefined };
}
