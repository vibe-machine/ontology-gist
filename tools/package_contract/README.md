# Hand-Authored Package Contract

This directory contains bootstrap tooling for ontology packages that are hand-authored rather than translated from staged upstream OWL sources.

Current tool:

- `bootstrap_hand_authored_package.mjs`
  - lifts legacy `TypeDoc` records into `SchemaResource` records
  - installs `schema/self-describing-schema.tql` and `schema/package-provenance.tql`
  - emits package-local documentation and provenance seed data
  - emits a package manifest and bootstrap validator
  - removes legacy `domains.tql`, `categorize.tql`, and `*-typedoc.tql` package assembly inputs

Usage:

```bash
node tools/package_contract/bootstrap_hand_authored_package.mjs \
  /path/to/ontology-beads \
  /path/to/ontology-gastown
```

This tool is intended for sibling ontology packages such as `ontology-beads`, `ontology-gastown`, `ontology-vibemachine`, and future packages derived from `ontology-template`.
