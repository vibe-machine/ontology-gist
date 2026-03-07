# Provenance Contract

This document defines the bootstrap provenance contract for `ontology-gist`.

## File-Level Header Contract

Every generated or bootstrap-maintained `.tql` artifact should carry a leading comment block with:

- upstream repository URL
- upstream release tag
- upstream commit SHA
- exact staged source artifact paths
- manifest path
- generator name and version

Current bootstrap headers use:

- generator: `bootstrap-manifest/0.1.0`
- manifest: `manifests/gist-v14.0.0.translation-manifest.json`

## TypeDB Seed Contract

The final translator should emit queryable provenance data alongside schema and documentation outputs.

Minimum records and fields:

- `OntologyPackageBuild`
  - package name
  - package version
  - upstream repo URL
  - upstream tag
  - upstream commit
  - generation timestamp
  - generator name
  - generator version
- `SourceArtifact`
  - staged path
  - sha256
  - package-build link
- `GeneratedArtifact`
  - artifact path
  - artifact kind
  - sha256
  - package-build link

Minimum query expectations:

- identify which upstream source produced the loaded `gist` package
- list exact staged source artifacts used for the package build
- list generated package artifacts and their checksums

## Identity Boundary

Ontology identity and artifact provenance must remain separate:

- ontology concept identity belongs to source IRIs and documentation identities such as `docKey`
- artifact provenance belongs to build/package records, staged source files, and generated output files

The translation manifest is the file-system source of truth for this boundary until the TypeDB provenance seed data is emitted by the translator.
