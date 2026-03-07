# gist_to_typeql

This directory is the canonical home for the `gist` to TypeQL translator.

Planned responsibilities:

- load pinned upstream source artifacts from `upstream/gist/<version>/`
- parse OWL/RDF structures into a normalized intermediate representation
- apply the mapping rules from `Gist-to-TypeDB Mapping Design`
- emit schema, data, documentation, provenance, and axiom-query artifacts
- validate deterministic regeneration against manifest checksums

Current state:

- `parse_gist.mjs` produces a deterministic IR summary of classes, properties, blank-node expressions, and seed instances
- `emit_structural.mjs` generates:
  - `schema/gistCore.tql`
  - `data/gistCore-domain-seeds.tql`
  - `queries/gistCore-axioms.tql`
  - `manifests/gist-v14.0.0.axiom-queries.json`
  - `manifests/gist-v14.0.0.translation-report.json`
- `validate_bootstrap.mjs` verifies manifest checksums, deterministic regeneration, and stale checked-in artifacts
- documentation, provenance, and axiom-query artifacts now ship as checked-in package outputs
- some OWL cardinality-heavy axiom queries are emitted with explicit approximation warnings until exact count semantics are implemented
