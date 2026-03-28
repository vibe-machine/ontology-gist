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

- `OntologyModule`
  - module name
  - module repo URL
- `OntologyModuleVersion`
  - module version key
  - module version
  - upstream commit
  - manifest path
  - generation timestamp
  - generator name
  - generator version
- `SourceArtifactRecord`
  - staged path
  - sha256
  - ontology-module-version link
- `GeneratedArtifactRecord`
  - artifact path
  - artifact kind
  - sha256
  - ontology-module-version link
- `OntologyModuleInstallation`
  - installation key
  - installed-at timestamp
  - ontology-module-version link

Minimum query expectations:

- identify which upstream source produced the loaded `gist` module version
- list exact staged source artifacts used for the module version
- list generated package artifacts and their checksums
- list installation records for module versions applied to a database

## Identity Boundary

Ontology identity and artifact provenance must remain separate:

- ontology concept identity belongs to source IRIs and documentation identities such as `docKey`
- artifact provenance belongs to ontology-module, ontology-module-version, installation, staged source file, and generated output records

The translation manifest is the file-system source of truth for this boundary until the TypeDB provenance seed data is emitted by the translator.
