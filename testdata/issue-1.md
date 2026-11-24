# Issue 1 and TON documentation examples

[Issue 1](https://github.com/ton-community/tlb-runtime/issues/1) lists 69 checklist entries. Several repeat a schema or quote part of it. The [fixture revision linked by the issue](https://github.com/ton-community/tlb-runtime/blob/5686e8fec993f28d5ff45d640a3401fe257ee56e/src/tesdata.ts) contains 91 data and BoC pairs. The local corpus exercises each pair and one additional Jetton transfer. Each pair has a decode assertion against its fields and an independent encode assertion against its expected BoC. Dictionary assertions include keys and values. Root type and input parameters are supplied for ambiguous examples. For instance, the two constructors of `ParamConstructor` require different result parameters. The second vector calls `decodeCell(schema, cell, { rootType: "ParamConstructor", args: [4] })`.

| Original group          | Data and BoC pairs |
| ----------------------- | -----------------: |
| Built-in types          |                 19 |
| Based on block.tlb      |                 28 |
| Combinator types        |                  5 |
| Naming tag              |                  2 |
| Complex Expressions     |                 12 |
| Constructor Tags        |                  7 |
| Advanced types          |                 10 |
| Slice types             |                  4 |
| Correct tag calculation |                  4 |

## Changes to the original BoCs

85 pairs retain their original BoC. The six replacements follow from the field declarations and the [TL-B syntax and semantics](https://docs.ton.org/foundations/tlb/syntax-and-semantics).

| Vector                                   | Wire expectation                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LessThan                                 | Three bits can represent 7, but the declared upper bound is 4. The positive case uses 4. A rejection test covers 5 through 7.                                                                                  |
| VarIntegerUser, negative value           | For −6 in VarInteger 5, the byte count is 1 in three bits, followed by the signed byte FA.                                                                                                                     |
| BitSelection, a = 8                      | Bit 2 is zero, so the six bits for a occupy the entire cell payload.                                                                                                                                           |
| HashmapAugEUser                          | Keys 5 and 6 retain their leaf values and extras. The original cell omitted the required extra on the fork and the root. Both now carry the explicit five-bit value 20. The malformed cell is a negative test. |
| ParamDifNamesUser, k = 5                 | The original BoC was identical to the k = 4 case. A fourth recursive c constructor yields 5 and the complete bit string 011110.                                                                                |
| IntBitsParametrizedOutside, first vector | The outer declaration supplies 5. The original value supplied 6 internally. The replacement uses 5 and encodes h = −7 to keep the two vectors distinct.                                                        |

The wire format does not specify JavaScript property names or number classes. The native decoder returns the schema field `const`, numbers for narrow runtime-sized integers, and locally inferred parameters such as `prev_seq_no`. These assertions describe the native API. The deprecated API has a separate compatibility suite.

## Documentation examples

| Source                                                                                    | Exercised variants                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Simple examples](https://docs.ton.org/foundations/tlb/simple-examples)                   | Maybe absent and present, both Either branches, Both in field order, 27583 in VarUInteger 16 and 32.                                                                                                                                   |
| [Complex examples](https://docs.ton.org/foundations/tlb/complex-and-non-trivial-examples) | Unary 110, short, long and repeated labels, the illustrated three-entry dictionary, augmented, prefix and variable dictionaries, both augmented binary tree nodes, VM tuple lengths 0–3 including the illustrated three-item tuple.    |
| [TEP examples](https://docs.ton.org/foundations/tlb/tep-examples)                         | NFT and Jetton transfers with all four optional and forwarded payload combinations, both Jetton notification payload branches, four DNS record constructors, absent, empty and populated lists, a dictionary referencing a DNS record. |

The documentation tests construct reference cells using bit widths, references and TON Core primitives. The illustrated dictionary is decoded from the exact diagram. Encoding is compared with the canonical dictionary produced by TON Core, since multiple label encodings can describe the same dictionary.

Run the checks locally with `npm run build`, `npm run lint`, and `npm test -- --runInBand`. The corpus assertions are in [TLBRuntime.spec.ts](../src/TLBRuntime.spec.ts). The wire examples are in [documentation-examples.spec.ts](../src/documentation-examples.spec.ts).
