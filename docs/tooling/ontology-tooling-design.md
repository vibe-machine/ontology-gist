# Design: Shared Ontology Tooling And Release Automation

## Goal

Create a dedicated shared tooling repo, `ontology-tooling`, that owns the operational automation used across the `ontology-*` repositories.

The first implemented command should be `ontology-release`, which performs a correct package release end to end:

- bumps the package version
- renames versioned manifest files
- regenerates package-contract artifacts
- validates bootstrap and TypeDB bootstrap
- creates and pushes the git tag

This tooling should be driven by `mise`, which is already installed and available in the local environment.

## Why A Separate Repo

`ontology-gist` is the canonical contract/reference package, but it should not become the runtime home for every shared script.

We already have cross-cutting concerns that apply to multiple ontology repos:

- package-contract refresh
- package-contract validation
- TypeDB bootstrap validation
- release/version/tag automation
- future repo scaffolding and shared CI workflows

Keeping this logic inside `ontology-gist/tools/` would continue to blur the boundary between:

- ontology contract/reference content
- operational tooling used by many repos

The correct boundary is a sibling repo:

- `collection-vibe-machine/ontology-tooling`

## Runtime Model

`mise` should be the entrypoint and task runner for the shared tooling repo.

The shared repo should provide:

- `mise.toml` for runtime/tool pinning
- `mise tasks` for common developer flows
- a small CLI surface under `bin/` or `src/cli/`

Per-ontology repos should keep thin wrapper scripts in `package.json`, but those wrappers should invoke the shared tooling commands rather than carrying duplicated business logic.

## Proposed Repo Shape

`ontology-tooling/`

- `mise.toml`
- `README.md`
- `docs/`
- `bin/`
- `src/`
- `templates/`
- `workflows/`

Initial commands:

- `ontology-release`
- `ontology-refresh-package-contract`
- `ontology-validate-bootstrap`
- `ontology-validate-typedb-bootstrap`

Later commands:

- `ontology-new`
- `ontology-docs-refresh`
- `ontology-ci-dry-run`

## Initial Scope

### 1. Repo foundation

Create the `ontology-tooling` repo with:

- `mise.toml`
- pinned runtime/tooling choices
- command entrypoints
- documentation for local use

### 2. Release command

Implement `ontology-release` as the first production command.

Inputs:

- target repo path
- version bump mode or explicit version
- optional dry-run mode
- optional push/tag flags

Core behavior:

1. detect package contract inputs
2. update `package.json.version`
3. rename versioned manifest files if the repo uses versioned manifest filenames
4. update manifest references in package metadata/docs
5. run package-contract refresh
6. run bootstrap validation
7. run TypeDB bootstrap validation
8. create commit
9. create git tag `vX.Y.Z`
10. push commit and tag

### 3. Shared package-contract helpers

Move reusable logic out of per-repo scripts where practical.

The goal is not to erase repo-local differences entirely. The goal is to centralize:

- version bump mechanics
- manifest path/version rewrites
- common validation orchestration
- common filesystem/git operations

Repo-local generators can remain in-package if they are truly schema-specific.

### 4. Reusable CI/release workflow

Provide a reusable workflow or workflow template that can:

- install via `mise`
- run refresh/validation
- perform release automation in CI when desired

## Non-Goals

- Moving every ontology-specific generator into the shared repo immediately
- Making `ontology-gist` responsible for release logic for all packages
- Using a git submodule for shared tooling

## Design Constraints

- `mise` is required as the shared runtime/task layer
- ontology repos must remain usable locally without hidden environment assumptions
- release commands must be explicit and repeatable
- version/tag state must stay aligned across:
  - `package.json`
  - manifest filename
  - manifest package version
  - manifest upstream tag
  - git tag
- validation must happen before release commit/tag/push

## First Command Contract: `ontology-release`

Recommended interface:

```bash
mise run release --repo ../ontology-trace-to-knowledge --bump patch
mise run release --repo ../ontology-beads --version 0.60.0 --dry-run
```

Expected behavior:

- fail if worktree is dirty unless an explicit override is provided
- show proposed file changes in dry-run mode
- fail if refresh or validation fails
- create a single release commit plus a matching git tag

## Acceptance Criteria

1. A dedicated `ontology-tooling` repo exists with `mise`-driven runtime/task setup.
2. `ontology-release` can bump and release at least one ontology package end to end.
3. The command updates package version metadata and git tag consistently.
4. The command runs both package-contract validation and TypeDB bootstrap validation before release.
5. The repo documents how ontology packages should consume the shared tooling.
6. At least one existing ontology repo is exercised as the proving path for the first release flow.
