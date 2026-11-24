import * as legacy from '@ton-community/tlb-codegen';

import type { TLBBinaryOp, TLBUnaryOp, TLBField, TLBFieldType, TLBMathExpr, TLBType, TLBVariable } from './types';

// Codegen represents expressions as class instances; the codec uses tagged records.
function expression(expr: legacy.TLBMathExpr): TLBMathExpr {
    if (expr instanceof legacy.TLBNumberExpr) return { kind: 'TLBNumberExpr', n: expr.n };
    if (expr instanceof legacy.TLBVarExpr) return { kind: 'TLBVarExpr', x: expr.x };
    if (expr instanceof legacy.TLBUnaryOp) {
        return {
            kind: 'TLBUnaryOp',
            operation: expr.operation as TLBUnaryOp['operation'],
            value: expression(expr.value),
        };
    }
    return {
        kind: 'TLBBinaryOp',
        operation: expr.operation as TLBBinaryOp['operation'],
        left: expression(expr.left),
        right: expression(expr.right),
    };
}

function fieldType(type: legacy.TLBFieldType): TLBFieldType {
    switch (type.kind) {
        case 'TLBNumberType':
            return { kind: type.kind, signed: type.signed, bits: expression(type.bits), maxBits: type.maxBits };
        case 'TLBBitsType':
            return { ...type, bits: expression(type.bits) };
        case 'TLBVarIntegerType':
            return { ...type, n: expression(type.n) };
        case 'TLBExprMathType':
            return { kind: type.kind, initialExpr: expression(type.initialExpr) };
        case 'TLBNamedType':
            return { ...type, arguments: type.arguments.map(fieldType) };
        case 'TLBHashmapType':
            return {
                kind: type.kind,
                key: expression(type.key.expr),
                value: fieldType(type.value),
                directStore: type.directStore,
            };
        case 'TLBMultipleType':
            return { ...type, times: expression(type.times), value: fieldType(type.value) };
        case 'TLBCondType':
            return { ...type, condition: expression(type.condition), value: fieldType(type.value) };
        case 'TLBCellInsideType':
            return { ...type, value: fieldType(type.value) };
        default:
            return type;
    }
}

function field(f: legacy.TLBField): TLBField {
    const subFields = f.subFields.map(field);
    if (f.name && subFields.length === 1 && subFields[0].name === f.name && !subFields[0].subFields.length) {
        return { ...f, fieldType: { kind: 'TLBCellInsideType', value: subFields[0].fieldType }, subFields: [] };
    }
    return { ...f, fieldType: fieldType(f.fieldType), subFields };
}

function variable(v: legacy.TLBVariable): TLBVariable {
    return { ...v, deriveExpr: v.deriveExpr && expression(v.deriveExpr) };
}

export function compileLegacySchema(schema: string): ReadonlyMap<string, TLBType> {
    const types = new Map<string, TLBType>();
    for (const [name, type] of legacy.getTLBCode(schema).types) {
        const constructors = type.constructors.map((constructor) => {
            const variables = constructor.variables.map(variable);
            const parameters = constructor.parameters.map((p) => ({
                variable: variable(p.variable),
                paramExpr: expression(p.paramExpr),
                argName: p.argName,
            }));
            return {
                ...constructor,
                fields: constructor.fields.map(field),
                constraints: constructor.constraints.map(expression),
                variables,
                variablesMap: new Map(variables.map((v) => [v.name, v])),
                parameters,
                parametersMap: new Map(parameters.map((p) => [p.variable.name, p])),
            };
        });
        types.set(name, { name, constructors });
    }
    return types;
}
