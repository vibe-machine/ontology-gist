# Translation Workspace

This repository is the canonical home for the `gist` TypeDB package lifecycle.

Current repository boundaries:

- `upstream/gist/v14.0.0/`: pinned upstream ontology inputs staged from `semanticarts/gist`
- `tools/gist_to_typeql/`: translator contract and future implementation home
- `manifests/`: machine-readable provenance and translation manifest artifacts
- `schema/` and `data/`: current package outputs
- `tests/`: validation scope and future automated checks

Authoritative design references:

- `Design: TypeDB Schema Documentation & Provenance`
- `Design: Self-Describing Schema`
- `Gist-to-TypeDB Mapping Design`

Current status:

- The upstream `gist` release `v14.0.0` is pinned to commit `6ab80c158a7fa56a1b5d3d824b125b92107e8f08`.
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
