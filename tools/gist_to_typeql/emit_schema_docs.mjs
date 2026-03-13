/**
 * emit_schema_docs.mjs — Generate SchemaResource documentation from OWL annotations
 *
 * Reads the gist OWL model and emits TypeQL `put` statements that populate
 * SchemaResource instances for every class, object property, and datatype
 * property — using the SKOS annotations already present in gistCore.ttl.
 *
 * Usage:
 *   node tools/gist_to_typeql/emit_schema_docs.mjs
 *
 * Output:
 *   data/gistCore-schema-docs.tql
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadOntologyModel } from "./model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const packageJson = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8")
);

const SYNTHETIC_THING_IRI = "http://www.w3.org/2002/07/owl#Thing";

const RESERVED_IDENTIFIERS = new Set([
  "and", "attribute", "define", "entity", "fetch", "function", "group",
  "has", "insert", "isa", "is", "label", "links", "match", "not",
  "offset", "or", "owns", "plays", "reduce", "relation", "relates",
  "rule", "select", "sort", "sub", "thing", "type", "value"
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iriLocalName(iri) {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

function safeIdentifier(name, suffix) {
  return RESERVED_IDENTIFIERS.has(name) ? `${name}${suffix}` : name;
}

/** Escape a string for TypeQL double-quoted literals. */
function tqlString(value) {
  return JSON.stringify(value);
}

/** Insert a space before each uppercase letter that follows a lowercase one. */
function humanLabel(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function buildIdentifierMaps(model) {
  const entityNames = new Map();
  const relationNames = new Map();
  const attributeNames = new Map();

  for (const cls of model.resources.classes) {
    entityNames.set(cls.iri, safeIdentifier(iriLocalName(cls.iri), "Type"));
  }
  entityNames.set(SYNTHETIC_THING_IRI, "Thing");

  for (const prop of model.resources.objectProperties) {
    relationNames.set(prop.iri, safeIdentifier(iriLocalName(prop.iri), "Rel"));
  }

  for (const prop of model.resources.datatypeProperties) {
    attributeNames.set(prop.iri, safeIdentifier(iriLocalName(prop.iri), "Attr"));
  }

  return { entityNames, relationNames, attributeNames };
}

// ---------------------------------------------------------------------------
// SchemaResource rendering
// ---------------------------------------------------------------------------

/**
 * Normalize instance annotations (termToValue objects) to plain string arrays
 * matching the format used by classes/properties.
 */
function normalizeInstanceAnnotations(annotations) {
  const result = {};
  for (const [key, values] of Object.entries(annotations)) {
    result[key] = values.map((v) => (typeof v === "object" && v.value != null) ? v.value : String(v));
  }
  return result;
}

/**
 * Build a SchemaResource entry from an OWL resource (class, property, or individual).
 *
 * @param {string} iri        - Full OWL IRI
 * @param {string} typeLabel  - TypeQL identifier (e.g. "Event", "isPartOf")
 * @param {string} kind       - "entity" | "relation" | "attribute" | "individual"
 * @param {object} annotations - { prefLabel: string[], definition: string[], ... }
 * @returns {string}
 */
function renderSchemaResource(iri, typeLabel, kind, annotations, varName) {
  const prefLabel = annotations.prefLabel?.[0] ?? humanLabel(typeLabel);
  const definition = annotations.definition?.[0];
  const scopeNotes = annotations.scopeNote ?? [];
  const examples = annotations.example ?? [];
  const editorialNotes = annotations.editorialNote ?? [];
  const altLabels = annotations.altLabel ?? [];
  const historyNotes = annotations.historyNote ?? [];
  const seeAlsos = annotations.seeAlso ?? [];
  const domainIncludes = annotations.domainIncludes ?? [];
  const deprecated = annotations.deprecated?.[0];

  // Every type gets a SchemaResource, even if annotations are sparse.
  // At minimum we have docKey, iri, typeLabel, kind, prefLabel.
  const lines = [];
  lines.push(`put ${varName} isa SchemaResource,`);
  lines.push(`  has docKey ${tqlString(iri)},`);
  lines.push(`  has iri ${tqlString(iri)},`);
  lines.push(`  has typeLabel ${tqlString(typeLabel)},`);
  lines.push(`  has kind ${tqlString(kind)},`);
  lines.push(`  has prefLabel ${tqlString(prefLabel)}`);

  // Append optional multi-valued attributes
  if (definition) {
    lines[lines.length - 1] += ",";
    lines.push(`  has definition ${tqlString(definition)}`);
  }
  for (const note of scopeNotes) {
    lines[lines.length - 1] += ",";
    lines.push(`  has scopeNote ${tqlString(note)}`);
  }
  for (const ex of examples) {
    lines[lines.length - 1] += ",";
    lines.push(`  has example ${tqlString(ex)}`);
  }
  for (const note of editorialNotes) {
    lines[lines.length - 1] += ",";
    lines.push(`  has editorialNote ${tqlString(note)}`);
  }
  for (const alt of altLabels) {
    lines[lines.length - 1] += ",";
    lines.push(`  has altLabel ${tqlString(alt)}`);
  }
  for (const note of historyNotes) {
    lines[lines.length - 1] += ",";
    lines.push(`  has historyNote ${tqlString(note)}`);
  }
  for (const ref of seeAlsos) {
    lines[lines.length - 1] += ",";
    lines.push(`  has seeAlso ${tqlString(ref)}`);
  }
  for (const dom of domainIncludes) {
    lines[lines.length - 1] += ",";
    lines.push(`  has domainIncludes ${tqlString(dom)}`);
  }
  if (deprecated === "true" || deprecated === true) {
    lines[lines.length - 1] += ",";
    lines.push(`  has deprecated true`);
  }

  // Terminate
  lines[lines.length - 1] += ";";

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const model = await loadOntologyModel(root);
  const { entityNames, relationNames, attributeNames } = buildIdentifierMaps(model);

  const manifest = packageJson.provenance?.manifest ?? "";
  const header = [
    "# Provenance bootstrap",
    `# upstream-repo: ${packageJson.upstream?.repo ?? ""}`,
    `# upstream-tag: ${packageJson.upstream?.tag ?? ""}`,
    `# upstream-commit: ${packageJson.upstream?.commit ?? ""}`,
    "# source-artifacts:",
    ...(packageJson.upstream?.sourceArtifacts ?? []).map((f) => `# - ${f}`),
    `# manifest: ${manifest}`,
    `# generator: gist-schema-docs-emitter/1.0.0`,
    ""
  ].join("\n");

  const blocks = [];
  let varCounter = 0;

  // SchemaModule declaration
  blocks.push(
    `put $gist_core isa SchemaModule,\n` +
    `  has moduleKey "gist-core",\n` +
    `  has moduleName "gistCore",\n` +
    `  has moduleKind "gist-core";`
  );

  // Synthetic Thing entity (owl:Thing has no annotations in gist)
  {
    const varName = `$r${++varCounter}`;
    const tql = renderSchemaResource(
      SYNTHETIC_THING_IRI,
      "Thing",
      "entity",
      { prefLabel: ["Thing"], definition: ["The universal root type. All gist entities are direct or indirect subtypes of Thing."] },
      varName
    );
    blocks.push(tql + `\nput (resource: ${varName}, module: $gist_core) isa inModule;`);
  }

  // Classes → entity SchemaResources
  for (const cls of model.resources.classes) {
    const typeLabel = entityNames.get(cls.iri) ?? iriLocalName(cls.iri);
    const varName = `$r${++varCounter}`;
    const tql = renderSchemaResource(cls.iri, typeLabel, "entity", cls.annotations, varName);
    blocks.push(tql + `\nput (resource: ${varName}, module: $gist_core) isa inModule;`);
  }

  // Object properties → relation SchemaResources
  for (const prop of model.resources.objectProperties) {
    const typeLabel = relationNames.get(prop.iri) ?? iriLocalName(prop.iri);
    const varName = `$r${++varCounter}`;
    const tql = renderSchemaResource(prop.iri, typeLabel, "relation", prop.annotations, varName);
    blocks.push(tql + `\nput (resource: ${varName}, module: $gist_core) isa inModule;`);
  }

  // Datatype properties → attribute SchemaResources
  for (const prop of model.resources.datatypeProperties) {
    const typeLabel = attributeNames.get(prop.iri) ?? iriLocalName(prop.iri);
    const varName = `$r${++varCounter}`;
    const tql = renderSchemaResource(prop.iri, typeLabel, "attribute", prop.annotations, varName);
    blocks.push(tql + `\nput (resource: ${varName}, module: $gist_core) isa inModule;`);
  }

  // Instances (controlled vocabulary individuals) → individual SchemaResources
  for (const inst of model.resources.instances) {
    const localName = iriLocalName(inst.iri);
    const varName = `$r${++varCounter}`;
    const normalized = normalizeInstanceAnnotations(inst.annotations);
    const tql = renderSchemaResource(inst.iri, localName, "individual", normalized, varName);
    blocks.push(tql + `\nput (resource: ${varName}, module: $gist_core) isa inModule;`);
  }

  const output = header + "\n" + blocks.join("\n\n") + "\n";
  const outPath = path.join(root, "data/gistCore-schema-docs.tql");
  await fs.writeFile(outPath, output, "utf8");

  // Summary
  const entityCount = model.resources.classes.length + 1; // +1 for synthetic Thing
  const relationCount = model.resources.objectProperties.length;
  const attributeCount = model.resources.datatypeProperties.length;
  const individualCount = model.resources.instances.length;
  const total = entityCount + relationCount + attributeCount + individualCount;

  const withDef = [
    ...model.resources.classes,
    ...model.resources.objectProperties,
    ...model.resources.datatypeProperties
  ].filter((r) => r.annotations.definition?.length > 0).length;

  const instancesWithDef = model.resources.instances
    .filter((r) => r.annotations.definition?.length > 0).length;

  console.log(`Wrote ${outPath}`);
  console.log(`  ${entityCount} entity docs (${model.resources.classes.length} classes + 1 synthetic Thing)`);
  console.log(`  ${relationCount} relation docs`);
  console.log(`  ${attributeCount} attribute docs`);
  console.log(`  ${individualCount} individual docs (${instancesWithDef} with definitions)`);
  console.log(`  ${total} total SchemaResource entries`);
  console.log(`  ${withDef + instancesWithDef} have definitions from OWL, ${total - withDef - instancesWithDef} have typeLabel/prefLabel only`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
