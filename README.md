# TL-B Runtime

TL‑B Runtime is a library for parsing and (de)serializing data according to [TL‑B schemas](https://docs.ton.org/v3/documentation/data-formats/tlb/tl-b-language), enabling programmatic work with binary structures and [Cell & Bag of Cells (BoC)](https://docs.ton.org/v3/documentation/data-formats/tlb/cell-boc)

## Quick Start

```bash
npm install @ton-community/tlb-runtime
```

## Usage

For new code, use `runtimeBy(schema)` and `decodeCell(schema, cell)` or `runtime.decodeCell(cell)`. The deprecated schema factory `parseTLB` uses the previous schema compiler to preserve its built-in types and normalized field names. A runtime created this way keeps that compiler when its schema changes. The previous names `parseTLB`, `parseCell` and `runtime.parseCell` remain available with deprecation annotations. Use `TypedCell` for decoded records and `DecodedCell` for field values in place of the deprecated `ParsedCell` type.

Pair the deprecated free `encodeCell(schema, data)` with `parseCell(schema, cell)` for alpha.4 records. Pair `runtime.encodeCell(data)` with `runtime.decodeCell(cell)` or the free `decodeCell(schema, cell)` for current schemas. A declared `VarInteger 5` uses a five-bit length prefix in the legacy format and a three-bit prefix in the current format. Choose the compiler that wrote the cell when reading stored data.

For a factory that returns a `Result`, use `TLBRuntime.compile(schema, config)` with the current compiler. `TLBRuntime.from(schema, config)` retains the alpha.4 compiler, including normalized field names such as `const0` and the original length prefix for declared `VarInteger` fields.

When the inferred root has a compatible tag, a failed read reports an error. Pass `{ rootType }` to `runtime.decodeCell` to read a different declaration explicitly, including an earlier tagless root.

With `autoText` enabled (the default), `bits` fields with a whole number of bytes decode as strings when their bytes form valid UTF-8 text. Tabs and line breaks are allowed. Invalid UTF-8 and other control characters keep the value as a `BitString`, preserving the original bytes for encoding.

### Simple

```typescript
import { runtimeBy } from '@ton-community/tlb-runtime';

interface Data {
    kind: 'Foo';
    x: number;
}

// language=tlb
const runtime = runtimeBy<Data>('_ x:# = Foo;');

const pack = runtime.serialize({
    kind: 'Foo',
    x: 73,
});
if (pack.success) {
    console.log({ pack: pack.value.endCell().toBoc().toString('base64') });
} else {
    console.error(pack.error.message);
}
// { pack: 'te6cckEBAQEABgAACAAAAEmTxmY2' }

const unpack = runtime.deserialize('te6cckEBAQEABgAACAAAACoFpvBE');
if (unpack.success) {
    console.log({ unpack: unpack.value });
} else {
    console.error(unpack.error.message);
}
// { unpack: { kind: 'Foo', x: 42 } }
```

### Export types for an editor or application

```typescript
import '@ton-community/tlb-runtime/type-export.js';
import { runtimeBy } from '@ton-community/tlb-runtime';
const runtime = runtimeBy('_ x:# = Foo;');
```

#### JSON Schema

```typescript
const editorSchema = runtime.toJSONSchema({ rootType: 'Foo', title: 'Schema for Foo' });
console.log(JSON.stringify(editorSchema, null, 2));
```

```json
{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Schema for Foo",
    "$ref": "#/definitions/Foo",
    "definitions": {
        "Foo": {
            "type": "object",
            "properties": {
                "kind": {
                    "const": "Foo"
                },
                "x": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 4294967295,
                    "description": "#"
                }
            },
            "required": ["kind", "x"],
            "additionalProperties": false,
            "description": "Foo — _"
        }
    }
}
```

#### Type declarations

```typescript
const declarations = runtime.toTypeScript({ rootType: 'Foo' });
console.log(declarations);
```

```typescript
/** Foo */
export type Foo = {
    /** _ x:# = Foo; */
    kind: 'Foo';
    /** # */
    x: number;
};
```

The optional `type-export.js` entry installs the export methods. Import it in the build script or application module that generates types. Applications using the main entry alone bundle only the codec and its existing dependencies.

Give `editorSchema` to a Draft-07 validator or JSON editor. Save `declarations` as a TypeScript file and import its types in the application. Both exports follow the selected root and specialize parameterized fields such as `Either Boc Data`. Use `args: [8]` for a numeric root parameter. With no root option, the JSON schema selects the last declared type and keeps the other exported definitions available.

TypeScript describes decoded values, including native `Cell`, `Dictionary`, and `BitString` objects. The JSON schema describes editor values. A cell is a Base64 BoC string in JSON and needs conversion to a live `Cell` for encoding. A dictionary uses an object with decimal keys and entry values, which the encoder accepts. Convert decoded dictionary entries explicitly with `Object.fromEntries(dictionary)` before serializing. Use decimal strings to preserve large integers.

JSON Schema validates the object structure and static bounds. The runtime checks constraints that depend on field values during encoding or decoding. Unbound field types appear as `unknown` in TypeScript and accept any JSON value. Export throws `TLBSchemaError` if expansion exceeds 512 definitions, 32 nested instantiations, or 4096 characters in an expanded TL-B type name.

## TEP-74 Fungible tokens (Jettons)

```typescript
import { runtimeBy } from '@ton-community/tlb-runtime';

// language=tlb
const schema = `nothing$0 {X:Type} = Maybe X;
just$1 {X:Type} value:X = Maybe X;
var_uint$_ {n:#} len:(#< n) value:(uint (len * 8)) = VarUInteger n;
addr_none$00 = MsgAddressExt;
addr_extern$01 len:(## 9) external_address:(bits len) = MsgAddressExt;
anycast_info$_ depth:(#<= 30) { depth >= 1 } rewrite_pfx:(bits depth) = Anycast;
addr_std$10 anycast:(Maybe Anycast) workchain_id:int8 address:bits256  = MsgAddressInt;
addr_var$11 anycast:(Maybe Anycast) addr_len:(## 9) workchain_id:int32 address:(bits addr_len) = MsgAddressInt;
_ _:MsgAddressInt = MsgAddress;
_ _:MsgAddressExt = MsgAddress;
burn#595f07bc
 query_id:uint64
 amount:(VarUInteger 16)
 response_destination:MsgAddress
 custom_payload:(Maybe ^Cell)
 = InternalMsgBody;`;

const runtime = runtimeBy(schema);
const pack = runtime.serialize({
    kind: 'InternalMsgBody',
    query_id: 0,
    amount: 1n,
    response_destination: 'Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU',
    custom_payload: { kind: 'Maybe_nothing' },
});
if (pack.success) {
    console.log(pack.value.endCell().toBoc().toString('base64'));
} else {
    console.error(pack.error.message);
}
// te6cckEBAQEAMQAAXllfB7wAAAAAAAAAABAZ/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8gPSJw==

const unpack = runtime.deserialize(
    'te6cckEBAQEAMQAAXllfB7wAAAAAAAAAABKp/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4/EP1Q==',
);
if (unpack.success) {
    console.log(unpack.value);
} else {
    console.error(unpack.error.message);
}
// { kind: 'InternalMsgBody', query_id: 0n, amount: 42n, response_destination: Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU, custom_payload: { kind: 'Maybe_nothing' } }
```

## Development

```bash
yarn install
yarn build
yarn test
yarn lint
yarn lint:fix
```

## Release

Merge the version change into `master`, then tag the merged commit with `v` followed by the version from `package.json`.

```bash
git fetch origin master
git tag v1.0.0-alpha.5 <merged-commit-sha>
git push origin refs/tags/v1.0.0-alpha.5
```

The [publish workflow](.github/workflows/deploy.yml) checks the tag against the package version, builds the package, publishes it to npm with the `latest` dist-tag, and creates a GitHub Release. It uses npm trusted publishing from the `deploy` environment.

## Parser source

The runtime uses the npm release of [@ton-community/tlb-parser](https://www.npmjs.com/package/@ton-community/tlb-parser). The dependency name `tlb-parser-v2` distinguishes the 0.2.x parser from the 0.1.x parser required by `tlb-codegen` for the deprecated API.

Unnamed reference groups such as `^[ a:uint8 ]` expose their fields on the
parent object. Each decoded key must be unique within a constructor, including
automatically assigned keys such as `anon1`. The schema compiler reports both
field paths when flattening groups would overwrite a value.
