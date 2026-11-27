import { TLBRuntime } from './TLBRuntime';
import { resolveTypeGraph, TypeExportOptions } from './type-graph';
import { jsonSchema, JSONSchemaObject, JSONSchemaOptions } from './json-schema';
import { typescript, TypeScriptOptions } from './typescript-gen';

declare module './TLBRuntime' {
    interface TLBRuntime {
        toJSONSchema(options?: JSONSchemaOptions): JSONSchemaObject;
        toTypeScript(options?: TypeScriptOptions): string;
    }
}

function graph(runtime: TLBRuntime, options: TypeExportOptions) {
    return resolveTypeGraph(runtime.getTypes(), runtime.lastTypeName, options, runtime.config.autoText);
}

TLBRuntime.prototype.toJSONSchema = function (options = {}) {
    return jsonSchema(graph(this, options), options);
};

TLBRuntime.prototype.toTypeScript = function (options = {}) {
    return typescript(graph(this, options), options);
};
