import { TLBSchemaError } from './errors';
import type { TLBConstructor, TLBFieldType, TLBType } from './types';

/** Tolk compiler ABI v1. Indices in fields and declarations address unique_types. */
type Node = Record<string, unknown>;

export interface TolkABI {
    abi_schema_version: string;
    contract_name: string;
    unique_types: Node[];
    declarations: Node[];
    [metadata: string]: unknown;
}

function fail(message: string): never {
    throw new TLBSchemaError('Tolk ABI: ' + message);
}

function list(value: unknown, path: string): Node[] {
    if (!Array.isArray(value) || value.some((x) => !x || typeof x !== 'object' || Array.isArray(x)))
        fail(path + ': expected an array of objects');
    return value;
}

function integer(value: unknown, min: number, max: number, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        fail(path + ': invalid integer');
    return value;
}

function identifier(value: unknown, path: string): string {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) fail(path + ': unsupported identifier');
    return value;
}

function prefix(value: unknown, path: string): string {
    if (value === undefined) return '';
    if (!value || typeof value !== 'object') fail(path + ': invalid prefix');
    const { prefix_num, prefix_len } = value as Node;
    const len = integer(prefix_len, 1, 48, path);
    return integer(prefix_num, 0, 2 ** len - 1, path)
        .toString(2)
        .padStart(len, '0');
}

function checkTags(tags: string[], path: string) {
    if (tags.some((tag, i) => tags.some((other, j) => i !== j && other.startsWith(tag))))
        fail(path + ': ambiguous constructor prefixes');
}

const builtin = new Map([
    ['bool', 'Bool'],
    ['coins', 'Coins'],
    ['address', 'MsgAddressInt'],
    ['addressAny', 'MsgAddress'],
    ['string', '^SnakeString'],
    ['cell', '^Cell'],
    ['remaining', 'Cell'],
]);

export function abiToTLB(abi: TolkABI): string {
    if (abi?.abi_schema_version !== '1.0') fail('expected abi_schema_version 1.0');
    const types = list(abi.unique_types, 'unique_types');
    const definitions = list(abi.declarations, 'declarations');
    const declarations: Node[] = [];
    const templates = new Map(definitions.filter((d) => d.type_params).map((d) => [d.name, d]));
    const reserved = new Set(definitions.map((d) => d.name));
    const instantiatedFrom = new Map<Node, unknown>();
    for (const [table, kind] of [
        ['struct_instantiations', 'struct'],
        ['alias_instantiations', 'alias'],
    ] as const) {
        for (const instance of list(abi[table] ?? [], table)) {
            const ref = type(instance.ty_idx);
            const base = ref[kind + '_name'];
            const template = templates.get(base);
            if (!template || template.kind !== kind || !Array.isArray(ref.type_args_ty_idx))
                fail(table + ': missing template');
            if (template.custom_pack_unpack || instance.custom_pack_unpack)
                fail(String(base) + ': custom serialization');
            let name = identifier(base, table) + '_' + instance.ty_idx;
            while (reserved.has(name)) name += 'X';
            reserved.add(name);
            const d: Node = { ...template, name, ty_idx: instance.ty_idx, type_params: undefined };
            if (kind === 'alias') d.target_ty_idx = instance.monomorphic_target_ty_idx;
            else {
                const fields = list(template.fields, String(base));
                const indices = instance.monomorphic_fields_ty_idx;
                if (!Array.isArray(indices) || indices.length !== fields.length) fail(name + ': invalid field indices');
                d.fields = fields.map((f, i) => ({ ...f, ty_idx: indices[i] }));
            }
            instantiatedFrom.set(d, base);
            declarations.push(d);
        }
    }
    declarations.push(...definitions.filter((d) => !d.type_params));
    const byIndex = new Map<number, Node>();
    const names = new Set<string>();
    function type(i: unknown): Node {
        return types[integer(i, 0, types.length - 1, 'type index')];
    }
    for (const d of declarations) {
        const name = identifier(d.name, 'declaration');
        if (
            !/^[A-Z]/.test(name) ||
            /^(?:Cell|Bool|Grams|Coins|MsgAddress(?:Int|Ext)?|SnakeString|HashmapE|VarUInteger|Type)$/.test(name)
        )
            fail(name + ': unsupported TL-B type name');
        if (names.has(name)) fail(name + ': duplicate declaration');
        names.add(name);
        if (d.custom_pack_unpack) fail(name + ': custom serialization');
        const ref = type(d.ty_idx);
        const declaredName = instantiatedFrom.get(d) ?? name;
        const valid =
            (d.kind === 'struct' && ref.kind === 'StructRef' && ref.struct_name === declaredName) ||
            (d.kind === 'alias' && ref.kind === 'AliasRef' && ref.alias_name === declaredName) ||
            (d.kind === 'enum' && ref.kind === 'EnumRef' && ref.enum_name === declaredName);
        if (!valid || byIndex.has(d.ty_idx as number))
            fail(name + ': unsupported declaration or inconsistent type index');
        byIndex.set(d.ty_idx as number, d);
    }
    const helpers = new Map<number, string>();
    const helperLines: string[] = [];
    function fieldType(i: unknown, path: string, seen = new Set<Node>()): string {
        const t = type(i);
        if (seen.has(t)) fail(path + ': cyclic inline type expression');
        if (t.kind === 'nullable' || t.kind === 'union') {
            const idx = i as number;
            const known = helpers.get(idx);
            if (known) return known;
            let name = 'TolkValue' + idx;
            while (names.has(name)) name += 'X';
            names.add(name);
            helpers.set(idx, name);
            helperLines.push(
                ...(t.kind === 'union'
                    ? unionLines(t, name)
                    : [
                          line('nothing', '0', '', name),
                          line('just', '1', 'value:' + fieldType(t.inner_ty_idx, path, new Set(seen).add(t)), name),
                      ]),
            );
            return name;
        }
        if (t.kind === 'cellOf') return '^' + fieldType(t.inner_ty_idx, path, new Set(seen).add(t));
        if (t.kind === 'varuintN' && (t.n === 16 || t.n === 32)) return '(VarUInteger ' + t.n + ')';
        if (t.kind === 'mapKV') {
            const key = type(t.key_ty_idx);
            if (key.kind !== 'uintN') fail(path + ': expected an unsigned dictionary key');
            return (
                '(HashmapE ' +
                integer(key.n, 1, 256, path) +
                ' ' +
                fieldType(t.value_ty_idx, path, new Set(seen).add(t)) +
                ')'
            );
        }
        if (t.kind === 'StructRef' || t.kind === 'AliasRef' || t.kind === 'EnumRef') {
            const d = byIndex.get(i as number);
            if (!d) fail(path + ': unresolved type reference');
            return String(d.name);
        }
        if (t.kind === 'uintN' || t.kind === 'intN' || t.kind === 'bitsN') {
            const name = t.kind.slice(0, -1);
            return name + integer(t.n, 1, name === 'bits' ? 1023 : name === 'int' ? 257 : 256, path);
        }
        return builtin.get(String(t.kind)) ?? fail(path + ': unsupported field type ' + String(t.kind));
    }
    function fields(d: Node): string {
        return list(d.fields, String(d.name) + '.fields')
            .map((f) => {
                const name = identifier(f.name, String(d.name));
                return name + ':' + fieldType(f.ty_idx, d.name + '.' + name);
            })
            .join(' ');
    }
    function line(ctor: string, bits: string, body: string, result: unknown): string {
        return ctor + (bits ? '$' + bits : '#_') + ' ' + (body ? body + ' ' : '') + '= ' + result + ';';
    }
    function unionLines(target: Node, name: string): string[] {
        const variants = list(target.variants, String(name));
        const tags = variants.map((v) => prefix(v, String(name)));
        if (variants.length < 2) fail(name + ': expected union variants');
        checkTags(tags, String(name));
        const constructors = new Set<string>();
        return variants.map((v, i) => {
            const variant = byIndex.get(v.variant_ty_idx as number);
            if (variant?.kind !== 'struct')
                return line('variant' + i, tags[i], 'value:' + fieldType(v.variant_ty_idx, name), name);
            const own = prefix(variant.prefix, String(variant.name));
            if (own && own !== tags[i]) fail(name + ': variant prefix mismatch');
            const stem = String(variant.name).replace(new RegExp('^' + name + '_'), '');
            const ctor = stem[0].toLowerCase() + stem.slice(1);
            if (constructors.has(ctor)) fail(name + ': duplicate variant name ' + ctor);
            constructors.add(ctor);
            return line(ctor, tags[i], fields(variant), name);
        });
    }
    const lines = declarations.flatMap((d) => {
        if (d.kind === 'enum') {
            const encoding = type(d.encoded_as_ty_idx);
            if (encoding.kind !== 'uintN' && encoding.kind !== 'intN') fail(d.name + ': invalid enum encoding');
            const width = integer(encoding.n, 1, 257, String(d.name));
            const members = list(d.members, String(d.name));
            const tags = members.map((m) => {
                if (typeof m.value !== 'string' && !Number.isSafeInteger(m.value))
                    fail(d.name + ': invalid enum value');
                const n = BigInt(String(m.value));
                if ((encoding.kind === 'uintN' ? BigInt.asUintN(width, n) : BigInt.asIntN(width, n)) !== n)
                    fail(d.name + ': enum value exceeds width');
                return BigInt.asUintN(width, n).toString(2).padStart(width, '0');
            });
            checkTags(tags, String(d.name));
            return members.map((m, i) => line('enum_' + identifier(m.name, String(d.name)), tags[i], '', d.name));
        }
        if (d.kind === 'struct') return line('_', prefix(d.prefix, String(d.name)), fields(d), d.name);
        const target = type(d.target_ty_idx);
        if (target.kind !== 'union')
            return line('_', '', 'value:' + fieldType(d.target_ty_idx, String(d.name)), d.name);
        return unionLines(target, String(d.name));
    });
    return [...helperLines, ...lines].join('\n');
}

export function tlbToABI(types: ReadonlyMap<string, TLBType>, lastTypeName?: string): TolkABI {
    const pool: Node[] = [];
    const indices = new Map<string, number>();
    const declarations: Node[] = [];
    function intern(t: Node): number {
        const key = JSON.stringify(t);
        const existing = indices.get(key);
        if (existing !== undefined) return existing;
        indices.set(key, pool.length);
        return pool.push(t) - 1;
    }
    // Tolk ABI 1.0 reserves the first twelve table indices for these primitives.
    for (const kind of ['void', 'int', 'slice', 'cell', 'builder', 'bool', 'coins', 'address']) intern({ kind });
    for (const n of [32, 64]) for (const kind of ['intN', 'uintN']) intern({ kind, n });
    const reference = (name: string) =>
        types.get(name)?.constructors.length === 1
            ? { kind: 'StructRef', struct_name: name }
            : { kind: 'AliasRef', alias_name: name };
    function field(t: TLBFieldType, path: string): number {
        switch (t.kind) {
            case 'TLBNumberType':
            case 'TLBBitsType': {
                if (
                    t.bits.kind !== 'TLBNumberExpr' ||
                    ('upperBound' in t && t.upperBound) ||
                    ('storeBits' in t && t.storeBits !== undefined)
                )
                    break;
                const kind = t.kind === 'TLBBitsType' ? 'bitsN' : t.signed ? 'intN' : 'uintN';
                return intern({
                    kind,
                    n: integer(t.bits.n, 1, kind === 'bitsN' ? 1023 : kind === 'intN' ? 257 : 256, path),
                });
            }
            case 'TLBNamedType':
                if (!t.arguments.length && types.has(t.name)) return intern(reference(t.name));
                break;
            case 'TLBRefType':
                if (t.value.kind === 'TLBCellType') return intern({ kind: 'cell' });
                if (t.value.kind === 'TLBNamedType' && t.value.name === 'SnakeString')
                    return intern({ kind: 'string' });
                return intern({ kind: 'cellOf', inner_ty_idx: field(t.value, path) });
            case 'TLBCellType':
                return intern({ kind: 'remaining' });
            case 'TLBVarIntegerType':
                if (!t.signed && t.upperBound?.kind === 'TLBNumberExpr' && [16, 32].includes(t.upperBound.n))
                    return intern({ kind: 'varuintN', n: t.upperBound.n });
                break;
            case 'TLBHashmapType':
                if (!t.directStore && t.key.kind === 'TLBNumberExpr')
                    return intern({
                        kind: 'mapKV',
                        key_ty_idx: intern({ kind: 'uintN', n: integer(t.key.n, 1, 256, path) }),
                        value_ty_idx: field(t.value, path),
                    });
                break;
            case 'TLBCoinsType':
                return intern({ kind: 'coins' });
            case 'TLBBoolType':
                return intern({ kind: 'bool' });
            case 'TLBAddressType':
                if (t.name !== 'MsgAddressExt')
                    return intern({ kind: t.name === 'MsgAddressInt' ? 'address' : 'addressAny' });
        }
        return fail(path + ': unsupported ' + t.kind);
    }
    const emittedStructs = new Map<string, string>();
    function struct(name: string, c: TLBConstructor) {
        if (c.parameters.length || c.constraints.length) fail(name + ': dependent parameters or constraints');
        const ty_idx = intern({ kind: 'StructRef', struct_name: name });
        const fields = c.fields.map((f) => {
            if (f.implicit || f.subFields.length) fail(name + ': implicit or anonymous field');
            return { name: identifier(f.name, name), ty_idx: field(f.fieldType, name + '.' + f.name) };
        });
        const tag = c.tag.bitLen ? { prefix_num: Number(BigInt(c.tag.binary)), prefix_len: c.tag.bitLen } : undefined;
        prefix(tag, name);
        const declaration = { kind: 'struct', name, ty_idx, ...(tag && { prefix: tag }), fields };
        const signature = JSON.stringify(declaration);
        const previous = emittedStructs.get(name);
        if (previous && previous !== signature) fail(name + ': variant name collision');
        if (!previous) declarations.push(declaration);
        emittedStructs.set(name, signature);
        return ty_idx;
    }
    // Stack widths describe unboxed struct fields. A reference always takes one slot.
    const widths = new Map<string, number>();
    function width(name: string, active = new Set<string>()): number {
        const cached = widths.get(name);
        if (cached !== undefined) return cached;
        if (active.has(name)) fail(name + ': recursive inline stack layout');
        const cs = types.get(name)!.constructors;
        const sizes = cs.map((c) =>
            c.fields.reduce(
                (sum, f) =>
                    sum +
                    (f.fieldType.kind === 'TLBNamedType' && types.has(f.fieldType.name)
                        ? width(f.fieldType.name, new Set(active).add(name))
                        : 1),
                0,
            ),
        );
        const result = Math.max(...sizes) + Number(cs.length > 1);
        widths.set(name, result);
        return result;
    }
    let nextId = 129;
    for (const t of types.values()) {
        if (t.isAnon) fail(t.name + ': anonymous type');
        if (t.constructors.length === 1) {
            struct(t.name, t.constructors[0]);
            continue;
        }
        const variants = t.constructors.map((c) => {
            const name = t.name + '_' + identifier(c.name, t.name);
            if (types.has(name) && types.get(name)!.constructors.length !== 1) fail(name + ': variant name collision');
            const variant_ty_idx = struct(name, c);
            const stack_width = c.fields.reduce(
                (sum, f) => sum + (f.fieldType.kind === 'TLBNamedType' ? width(f.fieldType.name) : 1),
                0,
            );
            return {
                variant_ty_idx,
                prefix_num: Number(BigInt(c.tag.binary)),
                prefix_len: c.tag.bitLen,
                stack_type_id: nextId++,
                stack_width,
            };
        });
        checkTags(
            variants.map((v) => prefix(v, t.name)),
            t.name,
        );
        declarations.push({
            kind: 'alias',
            name: t.name,
            ty_idx: intern(reference(t.name)),
            target_ty_idx: intern({ kind: 'union', variants, stack_width: width(t.name) }),
        });
    }
    const last = declarations.findIndex((d) => d.name === lastTypeName);
    if (last >= 0) declarations.push(...declarations.splice(last, 1));
    return {
        abi_schema_version: '1.0',
        contract_name: '',
        unique_types: pool,
        declarations,
        storage: {},
        incoming_messages: [],
        incoming_external: [],
        outgoing_messages: [],
        emitted_events: [],
        get_methods: [],
        thrown_errors: [],
        struct_instantiations: [],
        alias_instantiations: [],
        compiler_name: 'tlb-runtime',
        compiler_version: '1.0.0-alpha.9',
    };
}
