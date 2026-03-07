# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **gist Upper Ontology** — a TypeQL schema package adapted from Semantic Arts' [gist ontology](https://github.com/semanticarts/gist) (v14.0.0, CC-BY-SA-4.0). It provides foundational entity types and relations for enterprise knowledge graphs, used as a base layer by other ontology packages in the collection-vibe-machine ecosystem.

## File Structure

- `schema/gistCore.tql` — The single TypeQL schema file containing all attribute, relation, and entity definitions
- `data/domains.tql` — Domain registration (insert statement)
- `data/categorize.tql` — Match-insert statements linking TypeDoc entries to the gist domain
- `data/gistCore-typedoc.tql` — TypeDoc insert statements providing definitions and usage notes for key types
- `package.json` — Package manifest (not an npm package; describes the ontology package for the collection loader)

## TypeQL Schema Conventions

The schema uses TypeQL `define` syntax with three construct types:

- **Attributes**: `attribute <name> value <valuetype>;` — value types are `datetime`, `string`, `double`, `integer`
- **Relations**: `relation <name>, relates <role1>, relates <role2>;` — binary relations with named roles
- **Entities**: `entity <name>, owns <attr>, plays <relation>:<role>;` — entities declare owned attributes and played roles

Inheritance uses `sub`: `entity Task sub Event` means Task extends Event.

Data files use `insert` (for domain registration, TypeDoc entries) or `match/insert` (for categorization linking).

## Schema Design Patterns

- **Measurement**: Entity → `hasMagnitude` → Magnitude → `hasUnitOfMeasure` → UnitOfMeasure, with Aspect defining what is measured
- **Categorization**: Any entity → `isCategorizedBy` → Category (or subtypes like Tag, MediaType)
- **Part-whole**: `isPartOf` (transitive) and `isDirectPartOf` (single-level)
- **Temporal**: Event subtypes carry actual/planned start/end datetime attributes at multiple precisions (Year, Date, Minute, Microsecond)
- **Transfer**: `comesFromAgent`/`goesToAgent` for agent transfers, `comesFromPlace`/`goesToPlace` for physical movement

## Package Manifest

`package.json` is not for npm — it's a custom manifest consumed by the collection-vibe-machine loader. Key fields:
- `schemas` — array of `{name, file}` pointing to TypeQL define files
- `data` — array of TypeQL data files to load after schema
- `domains` — domain registration file
- `categorization` — categorization linking file
- `dependencies` — other ontology packages this depends on (empty for gist, the root)

## Working with This Repo

There are no build steps, tests, or linters. Changes involve editing `.tql` files directly. Ensure:
- `define` blocks contain only schema declarations (attributes, relations, entities)
- `insert` blocks are used for data (TypeDoc, Domain instances)
- `match/insert` blocks are used for linking existing data
- Role names in `plays` declarations match the corresponding `relates` clause in the relation definition
