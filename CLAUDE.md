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

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
