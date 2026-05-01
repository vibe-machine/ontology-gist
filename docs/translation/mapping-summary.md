# Mapping Summary

This document summarizes the translator behavior that currently turns vendored gist OWL/RDF into TypeDB package artifacts.

## Source Boundary

- Inputs come only from `upstream/gist/v14.0.0/` and its `source-artifacts.json` inventory.
- Translation is deterministic with respect to those staged files and the checked-in emitter logic.
- Provenance is recorded in generated file headers, the translation manifest, and queryable provenance seed data.

## Structural Mapping

- `owl:Class` -> `entity`
- `owl:ObjectProperty` -> `relation`
- `owl:DatatypeProperty` -> `attribute`
- controlled vocabulary / reference instances -> `insert` seed data with `sourceIRI`
- documentation annotations -> `SchemaResource` records rather than the legacy `TypeDoc` bridge

## Naming Rules

- Local IRI names become generated TypeQL labels unless they collide with reserved TypeQL identifiers.
- Current reserved-name rewrites:
  - `links` -> `linksRel`
  - `owns` -> `ownsRel`
- Source identity is preserved with `sourceIRI` even when the generated TypeQL label changes.

## Inheritance Rules

- The structural emitter selects a deterministic primary supertype when gist presents multiple inheritance pressure.
- Explicit gist hierarchies are represented structurally when the source resource maps to a TypeDB type:
  - `rdfs:subClassOf` -> entity subtyping
  - datatype-property `rdfs:subPropertyOf` -> attribute subtyping
  - object-property `rdfs:subPropertyOf` -> relation subtyping with role specialization
- Subtypes do not redundantly redeclare inherited `owns` or `plays`; inherited capability pruning is required for valid TypeDB schema loads.
- Equivalent-class and restriction structures are preserved in the IR for query-artifact generation even when the structural schema uses a simplified supertype choice.
- Query helpers may be generated for convenience, but they sit on top of the structural schema rather than replacing hierarchy emission.

## Restriction and Axiom Rules

- Equivalent-class and restriction expressions generate named query artifacts under `queries/gistCore-axioms.tql`.
- Current naming convention:
  - `axiom::<Type>::satisfies`
  - `axiom::<Type>::violation::<clause>`
  - `axiom::<Type>::candidates`
- Supported exact query semantics now cover the cardinality patterns present in gist's emitted equivalent-class coverage:
  - exact `0`
  - exact `1`
  - exact `2`
  - max `1`
  - min `2`
- Relation cardinality uses distinct witness variables with `not { $x is $y; };`.
- Datatype cardinality uses distinct value witnesses with `not { $a == $b; };`.

## Datatype Rules

- xsd date and datetime primitive ranges map to TypeDB `datetime` on root attributes; explicit DateTime property hierarchy is preserved with attribute subtyping.
- numeric XML Schema and OWL numeric datatypes collapse to TypeDB numeric attribute types according to the current emitter heuristics.
- For datatype restrictions, the generated schema remains the source of value-type enforcement; query artifacts enforce existence and cardinality over attribute ownership.

## Output Artifacts

- `schema/gistCore.tql`
- `data/gistCore-domain-seeds.tql`
- `data/gistCore-provenance.tql`
- `data/gistCore-schema-docs.tql`
- `queries/gistCore-axioms.tql`
- `manifests/gist-v14.0.0.ir-summary.json`
- `manifests/gist-v14.0.0.translation-report.json`
- `manifests/gist-v14.0.0.axiom-queries.json`
- `manifests/gist-v14.0.0.translation-manifest.json`
