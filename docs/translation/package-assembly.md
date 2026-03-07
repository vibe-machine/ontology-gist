# Package Assembly Notes

This file defines the package assembly contract for downstream consumers and for the repo's own validation flow.

## Canonical Generated Outputs

The package currently assembles from these generated artifacts:

- `schema/self-describing-schema.tql`
- `schema/package-provenance.tql`
- `schema/gistCore.tql`
- `data/gistCore-domain-seeds.tql`
- `data/gistCore-provenance.tql`
- `data/gistCore-schema-docs.tql`
- `queries/gistCore-axioms.tql`
- translation manifests and reports under `manifests/`

## Load Boundary

TypeDB package loading currently uses:

1. merged schema files from `package.json.schemas`
2. merged data files from `package.json.data`

The query library is validated as a package artifact, but it is not inserted during database initialization.

## Validation Flow

`npm run validate:bootstrap` currently checks:

- manifest/source checksum consistency
- deterministic IR generation
- deterministic structural/query artifact generation
- stale checked-in artifact detection
- TypeDB package load success for merged schema/data
- smoke-query access to documentation and provenance seed data
- representative compilation/execution of generated axiom queries

## Consumer Contract

Downstream consumers should treat this repository as the canonical source of:

- staged upstream gist input artifacts
- translation logic
- package manifests and reports
- generated TypeQL schema/data/query artifacts

Downstream consumers should not reintroduce embedded schema copies as their own source of truth.
