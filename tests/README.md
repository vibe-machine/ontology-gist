# Test Scope

This directory will hold validation for the `gist` package pipeline.

Initial validation targets:

- staged upstream source inventory is pinned to repo, tag, commit, and exact artifact paths
- translation manifest schema and instance remain consistent
- generated package artifacts merge and load in the expected order via `database create-init` against a throwaway local TypeDB CE server
- documentation and provenance artifacts are present and queryable
- regeneration is deterministic for identical inputs
