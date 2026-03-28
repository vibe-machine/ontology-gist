# Ontology Module Installation Migration

## Goal

Replace `OntologyPackageBuild` with a clearer foundational model for ontology modules, module versions, and installation records.

This change starts in `ontology-gist` and propagates through:

- `ontology-tooling`
- downstream ontology module repos
- `OneApps/Ontology`

## Decided Model

### Entities

`OntologyModule`

```text
[gist] Thing
└── [gist] SchemaMetaData
    └── [proposed] OntologyModule
```

`OntologyModuleVersion`

```text
[gist] Thing
└── [gist] SchemaMetaData
    └── [proposed] OntologyModuleVersion
```

`OntologyModuleInstallation`

```text
[gist] Thing
└── [gist] Event
    └── [proposed] OntologyModuleInstallation
```

### Attributes

- `moduleName` — display name of the ontology module
- `moduleRepoUrl` — stable identity of the ontology module
- `moduleVersion` — authoritative released version identifier
- `upstreamCommit` — source-control commit for the module version
- `manifestPath` — manifest path for the generated artifact set
- `generatedAt` — timestamp when the module version artifacts were generated
- `installationKey` — stable identifier for an installation record
- `installedAt` — timestamp when a module version was installed into the current database

### Relations

Both new relations specialize gist `isBasedOn`.

`ontologyModuleVersionOf`

```typeql
relation ontologyModuleVersionOf sub isBasedOn,
  relates version as isBasedOnSubject,
  relates module as isBasedOnObject;
```

Meaning:

- this `OntologyModuleVersion` is based on this `OntologyModule`

`installationOfOntologyModuleVersion`

```typeql
relation installationOfOntologyModuleVersion sub isBasedOn,
  relates installation as isBasedOnSubject,
  relates version as isBasedOnObject;
```

Meaning:

- this `OntologyModuleInstallation` installed this `OntologyModuleVersion`

### Proposed Schema

```typeql
define

attribute moduleName, value string;
attribute moduleRepoUrl, value string;
attribute moduleVersion, value string;
attribute upstreamCommit, value string;
attribute manifestPath, value string;
attribute generatedAt, value datetime;
attribute installationKey, value string;
attribute installedAt, value datetime;

entity OntologyModule sub SchemaMetaData,
  owns moduleName,
  owns moduleRepoUrl @key,
  plays ontologyModuleVersionOf:module;

entity OntologyModuleVersion sub SchemaMetaData,
  owns moduleVersion,
  owns upstreamCommit,
  owns manifestPath,
  owns generatedAt,
  plays ontologyModuleVersionOf:version,
  plays installationOfOntologyModuleVersion:version;

entity OntologyModuleInstallation sub Event,
  owns installationKey @key,
  owns installedAt,
  plays installationOfOntologyModuleVersion:installation;

relation ontologyModuleVersionOf sub isBasedOn,
  relates version as isBasedOnSubject,
  relates module as isBasedOnObject;

relation installationOfOntologyModuleVersion sub isBasedOn,
  relates installation as isBasedOnSubject,
  relates version as isBasedOnObject;
```

## Explicit Replacement

`OntologyPackageBuild` is replaced by:

- `OntologyModule`
- `OntologyModuleVersion`
- `OntologyModuleInstallation`

The important semantic split is:

- module: enduring identity
- module version: installable versioned thing
- installation: event recorded in the target database

## Repository Changes

### 1. `ontology-gist`

Primary model change lands here.

Planned work:

- add a new administrative schema file under `schema/`
- add schema docs for the new entities, attributes, and relations
- remove or migrate `OntologyPackageBuild`
- release a new major gist version

Likely file additions:

- `schema/administrative-operations.tql`
- `data/administrative-schema-docs.tql`

Likely file updates:

- `package.json`
- package manifests/provenance
- migration files
- validation scripts and tests

### 2. `ontology-tooling`

Planned work:

- stop generating `OntologyPackageBuild`
- generate `OntologyModule` and `OntologyModuleVersion` provenance data instead
- emit migration assertions against the new model
- update uniqueness checks and release logic
- update tests and docs

### 3. Downstream ontology module repos

Examples:

- `ontology-vibemachine`
- `ontology-beads`
- other module repos that depend on gist provenance/meta types

Planned work:

- depend on the new major gist version
- refresh generated provenance outputs
- update migration assertions
- cut coordinated major releases

### 4. `OneApps/Ontology`

Planned work:

- replace live queries that assume `OntologyPackageBuild`
- read installed module state from the new model
- write `OntologyModuleInstallation` after successful install
- update local bootstrap registry semantics as needed
- update fixtures, tests, and UI references

## Migration Strategy

This should be treated as a coordinated major-version migration.

### Data Migration Shape

Existing `OntologyPackageBuild` records need to be transformed into:

- one `OntologyModule`
- one `OntologyModuleVersion`
- the relation `ontologyModuleVersionOf`

`OntologyModuleInstallation` is new operational data and should be written by the installer after successful apply.

### Recommended Order

1. finalize gist schema and migration design
2. implement and release new major `ontology-gist`
3. update `ontology-tooling`
4. update downstream ontology module repos and release them
5. update `OneApps/Ontology`
6. migrate live databases

## Verification

### Gist

- schema validates
- bootstrap succeeds
- migration from previous gist version succeeds
- old `OntologyPackageBuild` data becomes the new module/module-version shape

### Tooling

- provenance generation uses the new types
- migration assertions target the new types
- no stale `OntologyPackageBuild` assumptions remain

### Downstream modules

- package refresh succeeds against new gist
- bootstrap succeeds
- migration assertions succeed

### OneApps/Ontology

- installed-version detection works against the new model
- successful installs create `OntologyModuleInstallation`
- database state UI reflects the new ontology structure

## Current Status

Decided:

- use `OntologyModule`
- use `OntologyModuleVersion`
- use `OntologyModuleInstallation`
- root both relations under gist `isBasedOn`
- use `moduleRepoUrl` as the stable key for `OntologyModule`
- do not model ontology release as a separate concept for this work
- do not model a first-class `OntologyDatabase` entity for now

Not yet implemented:

- gist schema changes
- gist migration plan
- tooling updates
- downstream repo updates
- OneApps/Ontology updates

## Open Implementation Questions

- whether `OntologyPackageBuild` is removed immediately or carried through one transitional major migration
- exact file naming inside `ontology-gist/schema/` and `data/`
- exact migration script shape for converting old provenance records in existing databases
