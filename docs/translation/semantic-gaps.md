# Semantic Gaps and Explicit Tradeoffs

This file records translation choices that are intentional, reviewable, and not fully lossless with respect to OWL.

## Primary Supertype Selection

gist sometimes presents multiple inheritance or equivalent-class structure that does not map directly into a single TypeDB `sub` chain.

Current policy:

- choose a deterministic primary named supertype for structural schema emission
- preserve equivalent-class logic in the IR and generated axiom queries
- report the remaining structural simplification in `translation-report.json`

## Relation and Attribute Label Collisions

Some gist local names collide with TypeQL reserved words.

Current policy:

- rename only the generated TypeQL label
- preserve source identity through `sourceIRI`
- report renamed identifiers in `translation-report.json`

Current collisions:

- `links` -> `linksRel`
- `owns` -> `ownsRel`

## Datatype Restrictions

The OWL source can express datatype constraints through named XML Schema or OWL datatype IRIs.

Current policy:

- enforce value typing structurally through generated TypeDB attribute definitions
- enforce existence and exact ownership cardinality in generated axiom queries
- avoid inventing a second query-time datatype taxonomy when the schema already encodes it

## Equivalent-Class Enforcement Boundary

The package currently generates named validation/candidate queries instead of trying to embed every OWL axiom directly into the structural schema.

Current policy:

- keep structural schema loadable and deterministic
- move logical validation and candidate classification into query artifacts
- treat the query library as a first-class package output, not a hidden translator by-product

## Vendoring vs Submodule

The upstream gist inputs are vendored rather than referenced as a git submodule.

Reason:

- the package needs a closed, reproducible source bundle
- the manifest must point to exact staged files and checksums, not just a repo commit
- downstream assembly and CI should work from a normal clone without submodule orchestration
