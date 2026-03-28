# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

This repo is the canonical `gist` TypeDB package lifecycle workspace. It stages pinned upstream Turtle artifacts from Semantic Arts gist `v14.0.0`, translates them into TypeQL schema/data/query outputs, and publishes self-describing documentation plus provenance metadata for downstream ontology consumers.

## Current Package Layout

- `upstream/gist/v14.0.0/` — vendored upstream Turtle inputs and source inventory
- `tools/gist_to_typeql/` — parser, emitter, and validation scripts
- `schema/gistCore.tql` — generated TypeQL schema
- `schema/self-describing-schema.tql` — shared documentation schema
- `schema/package-provenance.tql` — shared provenance schema
- `data/gistCore-domain-seeds.tql` — generated package seed instances
- `data/gistCore-schema-docs.tql` — generated `SchemaModule` / `SchemaResource` documentation records
- `data/gistCore-provenance.tql` — generated `OntologyModule` / `OntologyModuleVersion` provenance records
- `queries/gistCore-axioms.tql` — generated axiom query library
- `manifests/` — IR summary, translation report, axiom-query index, and translation manifest
- `package.json` — package contract consumed by the ontology loader

Deprecated `TypeDoc`, `domains.tql`, and `categorize.tql` artifacts have been retired and should not be reintroduced.

## Build And Validation

- `npm run parse:ir` — regenerate the normalized IR summary
- `npm run emit:structural` — regenerate schema, seed data, query library, and reports
- `npm run validate:bootstrap` — verify checksums, determinism, and artifact freshness
- `npm run test:typedb-bootstrap` — load the package into a temporary TypeDB instance
- `npm test` — run both validation stages

## Modeling Conventions

- Generated schema uses TypeQL `define` syntax with `attribute`, `relation`, and `entity` declarations.
- Package data files use `insert` only; query libraries are kept separate under `queries/`.
- Documentation is modeled through `SchemaModule`, `SchemaResource`, and `inModule`, not legacy `TypeDoc`.
- Provenance is modeled through `OntologyModule`, `OntologyModuleVersion`, `OntologyModuleInstallation`, `SourceArtifactRecord`, and `GeneratedArtifactRecord`.
- The emitter prunes inherited `owns` and `plays` declarations on subtypes because TypeDB already inherits them from supertypes.

## Editing Guidance

- Treat `upstream/gist/v14.0.0/` as pinned source input, not as a scratch area.
- Prefer changing the translator under `tools/gist_to_typeql/` and regenerating artifacts rather than hand-editing generated `.tql` outputs.
- If generated outputs change, rerun the relevant generator and validation commands before finishing.
- Keep `package.json` aligned with the active package contract in `schemas`, `data`, `queries`, `manifests`, and `assembly.loadOrder`.
