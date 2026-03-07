# Translation Workspace

This repository is the canonical home for the `gist` TypeDB package lifecycle.

Current repository boundaries:

- `upstream/gist/v14.0.0/`: pinned upstream ontology inputs staged from `semanticarts/gist`
- `tools/gist_to_typeql/`: translator contract and future implementation home
- `tools/package_contract/`: bootstrap tooling for hand-authored sibling ontology packages
- `manifests/`: machine-readable provenance and translation manifest artifacts
- `schema/` and `data/`: current package outputs
- `tests/`: validation scope and future automated checks

Authoritative design references:

- `Design: TypeDB Schema Documentation & Provenance`
  - https://www.notion.so/31bc633a07178161923fd6f322f0e5fb
- `Design: Self-Describing Schema`
  - https://www.notion.so/31cc633a07178180b139cb56c3c80268
- `Gist-to-TypeDB Mapping Design`
  - https://www.notion.so/31cc633a071781e79d50f0d8efbe91a1

Current status:

- The upstream `gist` release `v14.0.0` is pinned to commit `6ab80c158a7fa56a1b5d3d824b125b92107e8f08`.
- `ontology-gist` is the sole canonical repository for gist translation and package lifecycle work.
- `ontology-gist-owl2typeql` is a retired duplicate checkout and should not receive active implementation work.
- `schema/gistCore.tql` and `data/gistCore-domain-seeds.tql` are now deterministic structural translator outputs derived from the vendored Turtle sources.
- `manifests/gist-v14.0.0.ir-summary.json` and `manifests/gist-v14.0.0.translation-report.json` capture the normalized IR and structural translation decisions used to emit the package artifacts.
- Provenance and manifest scaffolding now live in-repo so the translator can become reproducible without relying on hidden external workspace state.
- The package now treats `schema/self-describing-schema.tql` and `data/gistCore-schema-docs.tql` as the authoritative documentation path.
- Legacy `TypeDoc` files remain in the repo only as migration reference and are no longer part of active package assembly.

Vendoring policy:

- do not use a git submodule for upstream ontology inputs
- vendor only the exact source artifacts used by translation
- keep repo URL, tag, commit, file paths, and sha256 values in manifest and staged inventory files
- refresh staged source via `tools/gist_to_typeql/fetch_upstream.sh`

In-repo translation references:

- `mapping-summary.md`: concise statement of the implemented OWL/RDF -> TypeQL mapping rules
- `semantic-gaps.md`: explicit list of places where gist semantics do not map one-to-one into current package artifacts
- `package-assembly.md`: package load order, generated artifacts, validation flow, and downstream-consumer contract
- `provenance-model.md`: manifest/header/queryable provenance contract
- `schema-resource-query-examples.tql`: example documentation queries against the self-describing schema model
