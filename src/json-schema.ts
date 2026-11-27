import type { ResolvedField, ResolvedFieldType, ResolvedTypeGraph, TypeExportOptions } from './type-graph';

export interface JSONSchemaOptions extends TypeExportOptions {
    title?: string;
    additionalProperties?: boolean;
}

export interface JSONSchemaObject {
    $schema?: string;
    $ref?: string;
    title?: string;
    type?: string;
    description?: string;
    const?: string | boolean;
    pattern?: string;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    items?: JSONSchemaObject;
    propertyNames?: JSONSchemaObject;
    additionalProperties?: boolean | JSONSchemaObject;
    properties?: Record<string, JSONSchemaObject>;
    required?: string[];
    definitions?: Record<string, JSONSchemaObject>;
    not?: JSONSchemaObject;
    oneOf?: JSONSchemaObject[];
    allOf?: JSONSchemaObject[];
    'x-tlb-type'?: string;
}

export function jsonSchema(graph: ResolvedTypeGraph, options: JSONSchemaOptions): JSONSchemaObject {
    const ref = (target: string) => ({ $ref: '#/definitions/' + target });
    function object(fields: ResolvedField[], kind?: string): JSONSchemaObject {
        const entries = fields.map(({ name, tlbType, type }): [string, JSONSchemaObject] => {
            const schema = field(type);
            // Draft-07 ignores siblings of $ref, including description.
            return [name, { ...(schema.$ref ? { allOf: [schema] } : schema), description: tlbType }];
        });
        const required = fields.filter((f) => !f.optional).map((f) => f.name);
        if (kind !== undefined) {
            entries.unshift(['kind', { const: kind }]);
            required.unshift('kind');
        }
        return {
            type: 'object',
            properties: Object.fromEntries(entries),
            required,
            additionalProperties: options.additionalProperties ?? false,
        };
    }
    function field(t: ResolvedFieldType): JSONSchemaObject {
        switch (t.kind) {
            case 'ref':
                return ref(t.target);
            case 'unknown':
                return {};
            case 'object':
                return object(t.fields);
            case 'number':
                return {
                    type: 'integer',
                    ...(Number.isSafeInteger(t.min) && { minimum: t.min }),
                    ...(Number.isSafeInteger(t.max) && { maximum: t.max }),
                };
            case 'bigint':
                return {
                    oneOf: [
                        { type: 'string', pattern: t.signed ? '^-?[0-9]+$' : '^[0-9]+$' },
                        {
                            type: 'integer',
                            minimum: t.signed ? Number.MIN_SAFE_INTEGER : 0,
                            maximum: Number.MAX_SAFE_INTEGER,
                        },
                    ],
                    'x-tlb-type': 'bigint',
                };
            case 'boolean':
                return t.value === undefined ? { type: 'boolean' } : { const: t.value };
            case 'string':
                return { type: 'string' };
            case 'bits':
                return {
                    ...(t.bitLength === 1
                        ? { type: 'boolean' }
                        : t.bitLength === undefined
                          ? { oneOf: [{ type: 'boolean' }, { type: 'string' }] }
                          : { type: 'string' }),
                    'x-tlb-type': 'bits' + (t.bitLength ?? ''),
                };
            // The public replacer writes a Cell as base64. encodeCell itself needs a live Cell.
            case 'cell':
                return { type: 'string', 'x-tlb-type': 'Cell', pattern: '^[A-Za-z0-9+/]+={0,2}$' };
            case 'address':
                if (t.variant === 'int') return { type: 'string', 'x-tlb-type': 'MsgAddressInt' };
                return {
                    oneOf: [{ type: 'string' }, { type: 'null' }],
                    'x-tlb-type': t.variant === 'ext' ? 'MsgAddressExt' : 'MsgAddress',
                };
            case 'nullable':
                return { oneOf: [field(t.inner), { type: 'null' }] };
            case 'dictionary':
                return {
                    type: 'object',
                    propertyNames: { pattern: '^[0-9]+$' },
                    additionalProperties: field(t.value),
                    'x-tlb-type': 'Dictionary',
                };
            case 'tuple':
                return { type: 'array', 'x-tlb-type': 'VmStack' };
            case 'array':
                return {
                    type: 'array',
                    items: field(t.item),
                    ...(t.length !== undefined && { minItems: t.length, maxItems: t.length }),
                };
        }
    }
    const definitions = Object.fromEntries(
        [...graph.types].map(([name, t]) => {
            if (t.alias) return [name, { ...field(t.alias), description: t.tlbName }];
            if (!t.variants.length) return [name, { description: t.tlbName, not: {} }];
            const variants = t.variants.map((v) => ({
                ...object(v.fields, v.kind),
                description: [t.tlbName, v.constructorName + (v.tag ?? '')].join(' — '),
            }));
            return [name, variants.length === 1 ? variants[0] : { description: t.tlbName, oneOf: variants }];
        }),
    );
    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        ...(options.title !== undefined && { title: options.title }),
        ...(graph.root && ref(graph.root)),
        definitions,
    };
}
