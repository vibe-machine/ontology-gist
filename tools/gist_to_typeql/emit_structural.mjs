import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  OWL_ALL_VALUES_FROM,
  OWL_CARDINALITY,
  OWL_HAS_VALUE,
  OWL_INTERSECTION_OF,
  OWL_INVERSE_OF,
  OWL_MAX_CARDINALITY,
  OWL_MAX_QUALIFIED_CARDINALITY,
  OWL_MIN_CARDINALITY,
  OWL_MIN_QUALIFIED_CARDINALITY,
  OWL_ON_CLASS,
  OWL_ON_PROPERTY,
  OWL_QUALIFIED_CARDINALITY,
  OWL_RESTRICTION,
  OWL_SOME_VALUES_FROM,
  OWL_UNION_OF,
  RDF_FIRST,
  RDF_NIL,
  RDF_REST,
  RDF_TYPE,
  loadOntologyModel,
} from "./model.mjs";
import {
  parseTypeQLSchemaStructure,
  renderStructuralMetadataSection,
  replaceGeneratedStructuralSection,
} from "../shared/schema_structure.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const MANIFEST_PATH = packageJson.provenance.manifest;
const MANIFEST_PREFIX = `manifests/gist-v${packageJson.version}`;
const GENERATOR = "gist-structural-emitter/0.5.0";
const SYNTHETIC_THING_IRI = "http://www.w3.org/2002/07/owl#Thing";
const SCHEMA_DOCS_PATH = "data/gistCore-schema-docs.tql";
const SCHEMA_DOCS_APPLY_UNIT_PREFIX = "generated/apply-units/data/gistCore-schema-docs";
const SEMANTIC_ROLE_OVERRIDES = new Map([
  [
    "https://w3id.org/semanticarts/ns/ontology/gist/isProducedBy",
    { subject: "product", object: "producer" }
  ]
]);
const RESERVED_IDENTIFIERS = new Set([
  "and",
  "attribute",
  "define",
  "entity",
  "fetch",
  "function",
  "group",
  "has",
  "insert",
  "isa",
  "is",
  "label",
  "links",
  "match",
  "not",
  "offset",
  "or",
  "owns",
  "plays",
  "reduce",
  "relation",
  "relates",
  "rule",
  "select",
  "sort",
  "sub",
  "thing",
  "type",
  "value"
]);

const NUMERIC_TYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#decimal",
  "http://www.w3.org/2001/XMLSchema#double",
  "http://www.w3.org/2001/XMLSchema#float",
  "http://www.w3.org/2001/XMLSchema#int",
  "http://www.w3.org/2001/XMLSchema#integer",
  "http://www.w3.org/2001/XMLSchema#byte",
  "http://www.w3.org/2001/XMLSchema#long",
  "http://www.w3.org/2001/XMLSchema#negativeInteger",
  "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
  "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
  "http://www.w3.org/2001/XMLSchema#positiveInteger",
  "http://www.w3.org/2001/XMLSchema#short",
  "http://www.w3.org/2001/XMLSchema#unsignedByte",
  "http://www.w3.org/2001/XMLSchema#unsignedInt",
  "http://www.w3.org/2001/XMLSchema#unsignedLong",
  "http://www.w3.org/2001/XMLSchema#unsignedShort",
  "http://www.w3.org/2002/07/owl#rational",
  "http://www.w3.org/2002/07/owl#real"
]);

const INTEGER_TYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#int",
  "http://www.w3.org/2001/XMLSchema#integer",
  "http://www.w3.org/2001/XMLSchema#byte",
  "http://www.w3.org/2001/XMLSchema#long",
  "http://www.w3.org/2001/XMLSchema#negativeInteger",
  "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
  "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
  "http://www.w3.org/2001/XMLSchema#positiveInteger",
  "http://www.w3.org/2001/XMLSchema#short",
  "http://www.w3.org/2001/XMLSchema#unsignedByte",
  "http://www.w3.org/2001/XMLSchema#unsignedInt",
  "http://www.w3.org/2001/XMLSchema#unsignedLong",
  "http://www.w3.org/2001/XMLSchema#unsignedShort"
]);

const DATETIME_TYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#date",
  "http://www.w3.org/2001/XMLSchema#dateTime"
]);

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function sha256File(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

const BOOLEAN_TYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#boolean"
]);

const STRING_TYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#string",
  "http://www.w3.org/2001/XMLSchema#anyURI"
]);

function iriLocalName(iri) {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

function safeIdentifier(name, suffix) {
  return RESERVED_IDENTIFIERS.has(name) ? `${name}${suffix}` : name;
}

function roleNamesForProperty(propertyIri, relationName) {
  const override = SEMANTIC_ROLE_OVERRIDES.get(propertyIri);
  if (override) return override;
  return {
    subject: `${relationName}Subject`,
    object: `${relationName}Object`
  };
}

function tqlString(value) {
  return JSON.stringify(value);
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function replaceSchemaDocApplyUnitPaths(paths, applyUnitPaths, { includeSchemaDocsPath = false } = {}) {
  if (!Array.isArray(paths)) return paths;
  const next = paths.filter((entry) =>
    entry !== SCHEMA_DOCS_PATH && !entry.startsWith(`${SCHEMA_DOCS_APPLY_UNIT_PREFIX}/`)
  );
  if (includeSchemaDocsPath) next.push(SCHEMA_DOCS_PATH);
  next.push(...applyUnitPaths);
  return next;
}

async function renderSchemaDocApplyUnits(docsText, outputRoot) {
  const toolingPath = path.join(root, "..", "ontology-tooling", "src/lib/executable-package.mjs");
  const { testing } = await import(pathToFileURL(toolingPath).href);
  const chunks = testing.buildContextualChunks(docsText.trim());
  const outputDir = path.join(outputRoot, SCHEMA_DOCS_APPLY_UNIT_PREFIX);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const paths = [];
  const artifacts = [];
  for (const [index, chunk] of chunks.entries()) {
    const relativePath = `${SCHEMA_DOCS_APPLY_UNIT_PREFIX}/${String(index + 1).padStart(4, "0")}.tql`;
    const text = testing.renderShardWithHeaders(SCHEMA_DOCS_PATH, chunk, {
      manifestPath: MANIFEST_PATH,
      upstreamCommit: packageJson.upstream.commit,
    });
    await fs.writeFile(path.join(outputRoot, relativePath), text, "utf8");
    paths.push(relativePath);
    artifacts.push({
      kind: "apply-unit",
      path: relativePath,
      sha256: sha256Text(text),
    });
  }

  return { paths, artifacts };
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

  return {
    entity(iri) {
      return entityNames.get(iri) ?? safeIdentifier(iriLocalName(iri), "Type");
    },
    relation(iri) {
      return relationNames.get(iri) ?? safeIdentifier(iriLocalName(iri), "Rel");
    },
    attribute(iriOrLocal) {
      if (iriOrLocal === "sourceIRI") return "sourceIRI";
      return attributeNames.get(iriOrLocal) ?? safeIdentifier(iriLocalName(iriOrLocal), "Attr");
    }
  };
}

function lineList(values, prefix = "    ") {
  return values.map((value) => `${prefix}${value}`);
}

function getBlankNodeEntries(model, id) {
  return model.blankNodes[id] ?? [];
}

function getBlankNodeObjects(model, id, predicate) {
  return getBlankNodeEntries(model, id)
    .filter((entry) => entry.predicate === predicate)
    .map((entry) => entry.object);
}

function resolveRdfList(model, nodeId) {
  const values = [];
  let current = nodeId;
  const seen = new Set();

  while (current && current !== RDF_NIL) {
    if (seen.has(current)) break;
    seen.add(current);
    const first = getBlankNodeObjects(model, current, RDF_FIRST)[0];
    if (!first) break;
    values.push(first);
    const rest = getBlankNodeObjects(model, current, RDF_REST)[0];
    if (!rest) break;
    current = rest.value;
  }

  return values;
}

function parseExpression(model, term) {
  if (!term) return { kind: "unknown" };
  if (term.termType === "NamedNode") return { kind: "named", iri: term.value };
  if (term.termType !== "BlankNode") return { kind: "literal", value: term.value, datatype: term.datatype ?? null };

  const nodeId = term.value;
  const typeValues = getBlankNodeObjects(model, nodeId, RDF_TYPE).map((entry) => entry.value);
  if (typeValues.includes(OWL_RESTRICTION)) {
    const onProperty = getBlankNodeObjects(model, nodeId, OWL_ON_PROPERTY)[0];
    let property = null;
    let inverse = false;
    if (onProperty?.termType === "NamedNode") {
      property = onProperty.value;
    } else if (onProperty?.termType === "BlankNode") {
      const inverseTerm = getBlankNodeObjects(model, onProperty.value, OWL_INVERSE_OF)[0];
      if (inverseTerm?.termType === "NamedNode") {
        property = inverseTerm.value;
        inverse = true;
      }
    }

    return {
      kind: "restriction",
      property,
      inverse,
      someValuesFrom: parseExpression(model, getBlankNodeObjects(model, nodeId, OWL_SOME_VALUES_FROM)[0]),
      allValuesFrom: parseExpression(model, getBlankNodeObjects(model, nodeId, OWL_ALL_VALUES_FROM)[0]),
      onClass: parseExpression(model, getBlankNodeObjects(model, nodeId, OWL_ON_CLASS)[0]),
      hasValue: parseExpression(model, getBlankNodeObjects(model, nodeId, OWL_HAS_VALUE)[0]),
      minQualifiedCardinality: Number.parseInt(getBlankNodeObjects(model, nodeId, OWL_MIN_QUALIFIED_CARDINALITY)[0]?.value ?? "", 10) || null,
      maxQualifiedCardinality: Number.parseInt(getBlankNodeObjects(model, nodeId, OWL_MAX_QUALIFIED_CARDINALITY)[0]?.value ?? "", 10) || null,
      qualifiedCardinality: Number.parseInt(getBlankNodeObjects(model, nodeId, OWL_QUALIFIED_CARDINALITY)[0]?.value ?? "", 10) || null,
      minCardinality: Number.parseInt(getBlankNodeObjects(model, nodeId, OWL_MIN_CARDINALITY)[0]?.value ?? "", 10) || null,
      maxCardinality: Number.parseInt(getBlankNodeObjects(model, nodeId, OWL_MAX_CARDINALITY)[0]?.value ?? "", 10) || null,
      cardinality: Number.parseInt(getBlankNodeObjects(model, nodeId, OWL_CARDINALITY)[0]?.value ?? "", 10) || null
    };
  }

  const unionOf = getBlankNodeObjects(model, nodeId, OWL_UNION_OF)[0];
  if (unionOf?.termType === "BlankNode") {
    return {
      kind: "union",
      members: resolveRdfList(model, unionOf.value).map((entry) => parseExpression(model, entry))
    };
  }

  const intersectionOf = getBlankNodeObjects(model, nodeId, OWL_INTERSECTION_OF)[0];
  if (intersectionOf?.termType === "BlankNode") {
    return {
      kind: "intersection",
      members: resolveRdfList(model, intersectionOf.value).map((entry) => parseExpression(model, entry))
    };
  }

  return { kind: "blank", id: nodeId };
}

function collectNamedClasses(expr) {
  if (!expr) return [];
  if (expr.kind === "named") return [expr.iri];
  if (expr.kind === "union" || expr.kind === "intersection") {
    return expr.members.flatMap((member) => collectNamedClasses(member));
  }
  if (expr.kind === "restriction") {
    return [
      ...collectNamedClasses(expr.someValuesFrom),
      ...collectNamedClasses(expr.allValuesFrom),
      ...collectNamedClasses(expr.onClass)
    ];
  }
  return [];
}

function collectDirectSuperclassCandidates(expr) {
  if (!expr) return [];
  if (expr.kind === "named") return [expr.iri];
  if (expr.kind === "intersection") {
    return expr.members.filter((member) => member.kind === "named").map((member) => member.iri);
  }
  return [];
}

function collectRestrictionDetails(expr, classIri, target) {
  if (!expr) return;

  if (expr.kind === "restriction" && expr.property) {
    if (!target.has(expr.property)) {
      target.set(expr.property, { subject: new Set(), object: new Set(), inverse: false });
    }
    const entry = target.get(expr.property);
    const role = expr.inverse ? "object" : "subject";
    entry[role].add(classIri);
    if (expr.inverse) entry.inverse = true;

    for (const valueExpr of [expr.someValuesFrom, expr.allValuesFrom, expr.onClass]) {
      for (const named of collectNamedClasses(valueExpr)) {
        if (expr.inverse) entry.subject.add(named);
        else entry.object.add(named);
      }
    }
  }

  if (expr.kind === "intersection" || expr.kind === "union") {
    for (const member of expr.members) collectRestrictionDetails(member, classIri, target);
  }
}

function buildRestrictionIndex(model) {
  const index = new Map();
  for (const cls of model.resources.classes) {
    for (const term of [...cls.subClassOf, ...cls.equivalentClass]) {
      collectRestrictionDetails(parseExpression(model, term), cls.iri, index);
    }
  }
  return index;
}

function buildInstanceTypeIndex(model) {
  const index = new Map();
  for (const instance of model.resources.instances) {
    index.set(instance.iri, instance.types);
  }
  return index;
}

function choosePrimarySupertype(model, cls) {
  const namedSubclasses = cls.subClassOf
    .filter((term) => term.termType === "NamedNode" && term.value !== cls.iri)
    .map((term) => term.value);
  if (namedSubclasses.length) return uniqueSorted(namedSubclasses)[0];

  const equivalentNamed = cls.equivalentClass
    .flatMap((term) => collectDirectSuperclassCandidates(parseExpression(model, term)))
    .filter((value) => value !== cls.iri);
  return uniqueSorted(equivalentNamed)[0] ?? null;
}

function inferPropertyTypes(model) {
  const restrictionIndex = buildRestrictionIndex(model);
  const instanceTypeIndex = buildInstanceTypeIndex(model);
  const propertyInfo = new Map();
  const propertyTypes = new Map();

  for (const property of [...model.resources.objectProperties, ...model.resources.datatypeProperties]) {
    const localName = iriLocalName(property.iri);
    propertyTypes.set(property.iri, property);
    propertyInfo.set(property.iri, {
      domain: new Set(),
      range: new Set(),
      notes: []
    });

    for (const term of property.domain) {
      for (const iri of collectNamedClasses(parseExpression(model, term))) {
        propertyInfo.get(property.iri).domain.add(iri);
      }
    }
    for (const term of property.range) {
      for (const iri of collectNamedClasses(parseExpression(model, term))) {
        propertyInfo.get(property.iri).range.add(iri);
      }
    }

    const restriction = restrictionIndex.get(property.iri);
    if (restriction) {
      for (const iri of restriction.subject) propertyInfo.get(property.iri).domain.add(iri);
      for (const iri of restriction.object) propertyInfo.get(property.iri).range.add(iri);
    }

    for (const term of property.range) {
      const expr = parseExpression(model, term);
      if (expr.kind === "restriction" && expr.hasValue?.kind === "named") {
        const instanceTypes = instanceTypeIndex.get(expr.hasValue.iri) ?? [];
        for (const iri of instanceTypes) propertyInfo.get(property.iri).range.add(iri);
      }
    }

    if (!property.domain.length && !property.range.length && !restriction) {
      propertyInfo.get(property.iri).notes.push(`no explicit structural typing for ${localName}`);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const property of [...model.resources.objectProperties, ...model.resources.datatypeProperties]) {
      const info = propertyInfo.get(property.iri);
      for (const superProp of property.subPropertyOf.filter((term) => term.termType === "NamedNode")) {
        const inherited = propertyInfo.get(superProp.value);
        if (!inherited) continue;
        for (const iri of inherited.domain) {
          if (!info.domain.has(iri)) {
            info.domain.add(iri);
            changed = true;
          }
        }
        for (const iri of inherited.range) {
          if (!info.range.has(iri)) {
            info.range.add(iri);
            changed = true;
          }
        }
      }
    }
  }

  return { propertyInfo, propertyTypes };
}

function inferAttributeValueType(model, property, propertyInfo) {
  const rangeTerms = [];
  const queue = [property];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current.iri)) continue;
    seen.add(current.iri);
    rangeTerms.push(...current.range.map((term) => parseExpression(model, term)));
    for (const superProp of current.subPropertyOf.filter((term) => term.termType === "NamedNode")) {
      const next = propertyInfo.propertyTypes.get(superProp.value);
      if (next) queue.push(next);
    }
  }

  const namedRanges = uniqueSorted(rangeTerms.flatMap((expr) => collectNamedClasses(expr)));
  if (namedRanges.some((iri) => DATETIME_TYPES.has(iri))) return "datetime";
  if (namedRanges.some((iri) => BOOLEAN_TYPES.has(iri))) return "boolean";
  if (namedRanges.length && namedRanges.every((iri) => INTEGER_TYPES.has(iri))) return "integer";
  if (namedRanges.some((iri) => NUMERIC_TYPES.has(iri))) return "double";
  if (namedRanges.some((iri) => STRING_TYPES.has(iri))) return "string";
  return "string";
}

function buildNamedSuperPropertyMap(properties) {
  const propertyIris = new Set(properties.map((property) => property.iri));
  const supertypeByIri = new Map();

  for (const property of properties) {
    const namedSupertypes = uniqueSorted(
      property.subPropertyOf
        .filter((term) => term.termType === "NamedNode" && propertyIris.has(term.value))
        .map((term) => term.value)
    );
    if (namedSupertypes.length > 1) {
      throw new Error(
        `multiple named TypeDB-mapped supertypes for ${property.iri}: ${namedSupertypes.join(", ")}`
      );
    }
    if (namedSupertypes.length === 1) supertypeByIri.set(property.iri, namedSupertypes[0]);
  }

  return supertypeByIri;
}

function collectPropertyHierarchyStats(model) {
  const datatypeSupertypeByIri = buildNamedSuperPropertyMap(model.resources.datatypeProperties);
  const objectSupertypeByIri = buildNamedSuperPropertyMap(model.resources.objectProperties);
  return {
    datatypeSupertypeByIri,
    objectSupertypeByIri,
    datatypeSubPropertyEdges: datatypeSupertypeByIri.size,
    objectSubPropertyEdges: objectSupertypeByIri.size,
    roleSpecializations: objectSupertypeByIri.size * 2,
  };
}

function validateAttributeSubtypeValueCompatibility(model, propertyInfo, attributeSupertypeByIri, identifiers) {
  for (const [propertyIri, supertypeIri] of attributeSupertypeByIri.entries()) {
    const property = propertyInfo.propertyTypes.get(propertyIri);
    const supertype = propertyInfo.propertyTypes.get(supertypeIri);
    const propertyValueType = inferAttributeValueType(model, property, propertyInfo);
    const supertypeValueType = inferAttributeValueType(model, supertype, propertyInfo);
    if (propertyValueType !== supertypeValueType) {
      throw new Error(
        `attribute subtype value mismatch: ${identifiers.attribute(propertyIri)} (${propertyValueType}) sub ` +
        `${identifiers.attribute(supertypeIri)} (${supertypeValueType})`
      );
    }
  }
}

function buildLabelSupertypeMap(supertypeByIri, labelForIri) {
  const result = new Map();
  for (const [subtypeIri, supertypeIri] of supertypeByIri.entries()) {
    result.set(labelForIri(subtypeIri), labelForIri(supertypeIri));
  }
  return result;
}

function hasAncestor(label, ancestorLabel, supertypeByLabel) {
  let current = supertypeByLabel.get(label);
  const seen = new Set();
  while (current && !seen.has(current)) {
    if (current === ancestorLabel) return true;
    seen.add(current);
    current = supertypeByLabel.get(current);
  }
  return false;
}

function buildEntityDefinitions(model, propertyInfo, identifiers) {
  const definitions = new Map();
  const seedInstanceOwners = new Map();
  const hierarchyStats = collectPropertyHierarchyStats(model);
  const attributeSupertypeByLabel = buildLabelSupertypeMap(
    hierarchyStats.datatypeSupertypeByIri,
    (iri) => identifiers.attribute(iri)
  );

  definitions.set(SYNTHETIC_THING_IRI, {
    name: identifiers.entity(SYNTHETIC_THING_IRI),
    supertype: null,
    owns: new Set(),
    plays: new Set()
  });

  for (const instance of model.resources.instances) {
    for (const type of instance.types) {
      if (!seedInstanceOwners.has(type)) seedInstanceOwners.set(type, new Set());
      seedInstanceOwners.get(type).add("sourceIRI");
      if (instance.annotations.prefLabel?.length) {
        seedInstanceOwners.get(type).add(identifiers.attribute("https://w3id.org/semanticarts/ns/ontology/gist/name"));
      }
      if (instance.annotations.definition?.length) {
        seedInstanceOwners.get(type).add(identifiers.attribute("https://w3id.org/semanticarts/ns/ontology/gist/description"));
      }
      for (const prop of instance.properties) {
        if (model.resources.datatypeProperties.some((item) => item.iri === prop.predicate)) {
          seedInstanceOwners.get(type).add(identifiers.attribute(prop.predicate));
        }
      }
    }
  }

  for (const cls of model.resources.classes) {
    definitions.set(cls.iri, {
      name: identifiers.entity(cls.iri),
      supertype: choosePrimarySupertype(model, cls) ?? SYNTHETIC_THING_IRI,
      owns: new Set(seedInstanceOwners.get(cls.iri) ?? []),
      plays: new Set()
    });
  }

  for (const property of model.resources.datatypeProperties) {
    const localName = identifiers.attribute(property.iri);
    const info = propertyInfo.propertyInfo.get(property.iri);
    for (const owner of info.domain) {
      if (definitions.has(owner)) definitions.get(owner).owns.add(localName);
    }
  }

  for (const property of model.resources.objectProperties) {
    const localName = identifiers.relation(property.iri);
    const info = propertyInfo.propertyInfo.get(property.iri);
    const roles = roleNamesForProperty(property.iri, localName);
    for (const owner of info.domain) {
      if (definitions.has(owner)) definitions.get(owner).plays.add(`${localName}:${roles.subject}`);
    }
    for (const owner of info.range) {
      if (definitions.has(owner)) definitions.get(owner).plays.add(`${localName}:${roles.object}`);
    }
  }

  const inheritedCache = new Map();
  function inheritedCapabilities(classIri) {
    if (inheritedCache.has(classIri)) return inheritedCache.get(classIri);
    const definition = definitions.get(classIri);
    const inherited = { owns: new Set(), plays: new Set() };
    if (definition?.supertype && definitions.has(definition.supertype)) {
      const parent = inheritedCapabilities(definition.supertype);
      for (const item of parent.owns) inherited.owns.add(item);
      for (const item of parent.plays) inherited.plays.add(item);
      for (const item of definitions.get(definition.supertype).owns) inherited.owns.add(item);
      for (const item of definitions.get(definition.supertype).plays) inherited.plays.add(item);
    }
    inheritedCache.set(classIri, inherited);
    return inherited;
  }

  for (const [classIri, definition] of definitions.entries()) {
    const inherited = inheritedCapabilities(classIri);
    for (const item of inherited.owns) definition.owns.delete(item);
    for (const item of inherited.plays) definition.plays.delete(item);

    for (const ownedAttribute of Array.from(definition.owns)) {
      for (const inheritedAttribute of inherited.owns) {
        if (hasAncestor(ownedAttribute, inheritedAttribute, attributeSupertypeByLabel)) {
          definition.owns.delete(ownedAttribute);
          break;
        }
      }
    }
  }

  return definitions;
}

function renderSchema(model, propertyInfo, entityDefinitions, identifiers) {
  const hierarchyStats = collectPropertyHierarchyStats(model);
  validateAttributeSubtypeValueCompatibility(
    model,
    propertyInfo,
    hierarchyStats.datatypeSupertypeByIri,
    identifiers
  );

  const lines = [
    "# Provenance bootstrap",
    "# upstream-repo: https://github.com/semanticarts/gist",
    "# upstream-tag: v14.0.0",
    "# upstream-commit: 6ab80c158a7fa56a1b5d3d824b125b92107e8f08",
    "# source-artifacts:",
    "# - upstream/gist/v14.0.0/ontologies/gistCore.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistMediaTypes.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistPrefixDeclarations.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistValidationAnnotations.ttl",
    `# manifest: ${MANIFEST_PATH}`,
    `# generator: ${GENERATOR}`,
    "",
    "define",
    ""
  ];

  const attributeDefinitions = [
    { name: "sourceIRI", line: "attribute sourceIRI value string;" },
    ...model.resources.datatypeProperties.map((property) => {
      const localName = identifiers.attribute(property.iri);
      const supertypeIri = hierarchyStats.datatypeSupertypeByIri.get(property.iri);
      return {
        name: localName,
        line: supertypeIri
          ? `attribute ${localName} sub ${identifiers.attribute(supertypeIri)};`
          : `attribute ${localName} value ${inferAttributeValueType(model, property, propertyInfo)};`,
      };
    })
  ];

  for (const definition of attributeDefinitions.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(definition.line);
  }

  lines.push("");

  for (const property of model.resources.objectProperties) {
    const localName = identifiers.relation(property.iri);
    const definition = property.annotations.definition?.[0];
    const notes = [];
    if (definition) notes.push(definition);
    if (property.types.includes("http://www.w3.org/2002/07/owl#TransitiveProperty")) notes.push("transitive in OWL");
    if (property.types.includes("http://www.w3.org/2002/07/owl#SymmetricProperty")) notes.push("symmetric in OWL");
    if (property.types.includes("http://www.w3.org/2002/07/owl#FunctionalProperty")) notes.push("functional in OWL");
    if (property.types.includes("http://www.w3.org/2002/07/owl#InverseFunctionalProperty")) notes.push("inverse-functional in OWL");
    for (const note of notes) lines.push(`# ${localName}: ${note}`);
    const supertypeIri = hierarchyStats.objectSupertypeByIri.get(property.iri);
    const roles = roleNamesForProperty(property.iri, localName);
    if (supertypeIri) {
      const supertypeName = identifiers.relation(supertypeIri);
      const supertypeRoles = roleNamesForProperty(supertypeIri, supertypeName);
      lines.push(`relation ${localName} sub ${supertypeName},`);
      lines.push(`    relates ${roles.subject} as ${supertypeRoles.subject},`);
      lines.push(`    relates ${roles.object} as ${supertypeRoles.object};`);
    } else {
      lines.push(`relation ${localName},`);
      lines.push(`    relates ${roles.subject},`);
      lines.push(`    relates ${roles.object};`);
    }
    lines.push("");
  }

  const classList = [
    {
      iri: SYNTHETIC_THING_IRI,
      annotations: { definition: ["Synthetic root used to anchor owl:Thing semantics for untyped role players."] }
    },
    ...model.resources.classes
  ]
    .sort((a, b) => iriLocalName(a.iri).localeCompare(iriLocalName(b.iri)));

  for (const cls of classList) {
    const definition = entityDefinitions.get(cls.iri);
    const header = cls.annotations.definition?.[0] ? `# ${cls.annotations.definition[0]}` : `# ${iriLocalName(cls.iri)}`;
    lines.push(header);
    const firstLine = definition.supertype
      ? `entity ${definition.name} sub ${identifiers.entity(definition.supertype)},`
      : `entity ${definition.name},`;
    lines.push(firstLine);
    const members = [
      ...Array.from(definition.owns).sort((a, b) => a.localeCompare(b)).map((name) => `owns ${name}`),
      ...Array.from(definition.plays).sort((a, b) => a.localeCompare(b)).map((play) => `plays ${play}`)
    ];
    if (!members.length) {
      lines[lines.length - 1] = `${firstLine.slice(0, -1)};`;
    } else {
      const body = lineList(members.map((item) => `${item},`));
      body[body.length - 1] = body[body.length - 1].replace(/,$/, ";");
      lines.push(...body);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderSeedData(model, identifiers) {
  const lines = [
    "# Provenance bootstrap",
    "# upstream-repo: https://github.com/semanticarts/gist",
    "# upstream-tag: v14.0.0",
    "# upstream-commit: 6ab80c158a7fa56a1b5d3d824b125b92107e8f08",
    "# source-artifacts:",
    "# - upstream/gist/v14.0.0/ontologies/gistCore.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistMediaTypes.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistPrefixDeclarations.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistValidationAnnotations.ttl",
    `# manifest: ${MANIFEST_PATH}`,
    `# generator: ${GENERATOR}`,
    ""
  ];

  const sortedInstances = model.resources.instances
    .slice()
    .sort((a, b) => a.iri.localeCompare(b.iri));

  sortedInstances.forEach((instance, index) => {
    const variable = `$i${index + 1}`;
    const typeName = identifiers.entity(instance.types[0]);
    const attrs = [`has sourceIRI ${tqlString(instance.iri)}`];
    if (instance.annotations.prefLabel?.[0]?.value) {
      attrs.push(
        `has ${identifiers.attribute("https://w3id.org/semanticarts/ns/ontology/gist/name")} ${tqlString(instance.annotations.prefLabel[0].value)}`
      );
    }
    if (instance.annotations.definition?.[0]?.value) {
      attrs.push(
        `has ${identifiers.attribute("https://w3id.org/semanticarts/ns/ontology/gist/description")} ${tqlString(instance.annotations.definition[0].value)}`
      );
    }

    for (const prop of instance.properties) {
      const literalValues = prop.values.filter((value) => value.termType === "Literal");
      if (!literalValues.length) continue;
      if (!model.resources.datatypeProperties.some((item) => item.iri === prop.predicate)) continue;
      if (iriLocalName(prop.predicate) === "license") continue;
      const first = literalValues[0];
      attrs.push(`has ${identifiers.attribute(prop.predicate)} ${tqlString(first.value)}`);
    }

    lines.push(`put ${variable} isa ${typeName},`);
    const formattedAttrs = lineList(attrs.map((item) => `${item},`), "  ");
    formattedAttrs[formattedAttrs.length - 1] = formattedAttrs[formattedAttrs.length - 1].replace(/,$/, ";");
    lines.push(...formattedAttrs);
    lines.push("");
  });

  return lines.join("\n");
}

function renderProvenanceData(manifest) {
  const moduleRepoUrl = manifest.upstream.repoUrl;
  const moduleVersionKey = `${moduleRepoUrl}@${manifest.package.version}`;
  const lines = [
    "# Provenance bootstrap",
    "# upstream-repo: https://github.com/semanticarts/gist",
    "# upstream-tag: v14.0.0",
    "# upstream-commit: 6ab80c158a7fa56a1b5d3d824b125b92107e8f08",
    "# source-artifacts:",
    "# - upstream/gist/v14.0.0/ontologies/gistCore.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistMediaTypes.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistPrefixDeclarations.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistValidationAnnotations.ttl",
    `# manifest: ${MANIFEST_PATH}`,
    `# generator: ${GENERATOR}`,
    ""
  ];

  lines.push(`put $module isa OntologyModule,`);
  lines.push(`  has moduleName ${tqlString(manifest.package.name)},`);
  lines.push(`  has moduleRepoUrl ${tqlString(moduleRepoUrl)};`);
  lines.push("");
  lines.push(`put $version isa OntologyModuleVersion,`);
  lines.push(`  has moduleVersionKey ${tqlString(moduleVersionKey)},`);
  lines.push(`  has moduleVersion ${tqlString(manifest.package.version)},`);
  lines.push(`  has upstreamCommit ${tqlString(manifest.upstream.commit)},`);
  lines.push(`  has manifestPath ${tqlString(MANIFEST_PATH)},`);
  lines.push(`  has generatorName ${tqlString(manifest.generator.name)},`);
  lines.push(`  has generatorVersion ${tqlString(manifest.generator.version)},`);
  lines.push(`  has generatedAt ${tqlString(manifest.generator.generatedAt)};`);
  lines.push(`put (version: $version, module: $module) isa ontologyModuleVersionOf;`);
  lines.push("");

  manifest.upstream.sourceArtifacts.forEach((artifact, index) => {
    const variable = `$s${index + 1}`;
    lines.push(`put ${variable} isa SourceArtifactRecord,`);
    lines.push(`  has sourcePath ${tqlString(artifact.path)},`);
    lines.push(`  has sourceSha256 ${tqlString(artifact.sha256)};`);
    lines.push(`put (version: $version, sourceArtifact: ${variable}) isa ontologyModuleVersionBasedOnSourceArtifact;`);
    lines.push("");
  });

  const generatedArtifacts = manifest.artifacts.filter((artifact) => artifact.path !== "data/gistCore-provenance.tql");
  generatedArtifacts.forEach((artifact, index) => {
    const variable = `$g${index + 1}`;
    lines.push(`put ${variable} isa GeneratedArtifactRecord,`);
    lines.push(`  has artifactPath ${tqlString(artifact.path)},`);
    lines.push(`  has artifactKind ${tqlString(artifact.kind)},`);
    lines.push(`  has artifactSha256 ${tqlString(artifact.sha256)};`);
    lines.push(`put (generatedArtifact: ${variable}, version: $version) isa generatedArtifactForOntologyModuleVersion;`);
    lines.push("");
  });

  return lines.join("\n");
}

function indentText(text, prefix = "  ") {
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function mergeWarnings(items) {
  return uniqueSorted(items.flatMap((item) => item ?? []));
}

function buildAxiomQueryArtifacts(model, identifiers) {
  const classIris = new Set(model.resources.classes.map((item) => item.iri));
  const objectPropertyIris = new Set(model.resources.objectProperties.map((item) => item.iri));
  const datatypePropertyIris = new Set(model.resources.datatypeProperties.map((item) => item.iri));
  const instanceTypes = new Map(model.resources.instances.map((item) => [item.iri, item.types]));

  function createContext() {
    let counter = 0;
    return {
      nextVar(stem) {
        counter += 1;
        return `$${stem.replace(/[^A-Za-z0-9_]/g, "_")}_${counter}`;
      }
    };
  }

  function hasConcreteExpr(expr) {
    return expr && expr.kind !== "unknown";
  }

  function cardinalitySummary(expr) {
    const exact = expr.qualifiedCardinality ?? expr.cardinality ?? null;
    const min = exact ?? expr.minQualifiedCardinality ?? expr.minCardinality ?? null;
    const max = exact ?? expr.maxQualifiedCardinality ?? expr.maxCardinality ?? null;
    return { exact, min, max };
  }

  function distinctConceptClause(leftVar, rightVar) {
    return `not {\n${indentText(`${leftVar} is ${rightVar};`)}\n};`;
  }

  function distinctValueClause(leftVar, rightVar) {
    return `not {\n${indentText(`${leftVar} == ${rightVar};`)}\n};`;
  }

  function compileExpression(expr, subjectVar, ctx) {
    if (!expr || expr.kind === "unknown") return { clauses: [], warnings: [] };

    if (expr.kind === "named") {
      if (classIris.has(expr.iri)) {
        return { clauses: [`${subjectVar} isa ${identifiers.entity(expr.iri)};`], warnings: [] };
      }
      if (expr.iri === SYNTHETIC_THING_IRI) {
        return { clauses: [`${subjectVar} isa ${identifiers.entity(SYNTHETIC_THING_IRI)};`], warnings: [] };
      }
      if (instanceTypes.has(expr.iri)) {
        return { clauses: [`${subjectVar} has sourceIRI ${tqlString(expr.iri)};`], warnings: [] };
      }
      if (expr.iri.startsWith("http://www.w3.org/2001/XMLSchema#")) {
        return { clauses: [], warnings: [] };
      }
      return {
        clauses: [`${subjectVar} has sourceIRI ${tqlString(expr.iri)};`],
        warnings: [`named target ${expr.iri} treated as sourceIRI lookup`]
      };
    }

    if (expr.kind === "intersection") {
      const compiled = expr.members.map((member) => compileExpression(member, subjectVar, ctx));
      return {
        clauses: compiled.flatMap((item) => item.clauses),
        warnings: mergeWarnings(compiled.map((item) => item.warnings))
      };
    }

    if (expr.kind === "union") {
      const compiled = expr.members.map((member) => compileExpression(member, subjectVar, ctx));
      const nonEmpty = compiled.filter((item) => item.clauses.length > 0);
      if (!nonEmpty.length) {
        return { clauses: [], warnings: mergeWarnings(compiled.map((item) => item.warnings)) };
      }
      const clause = `${nonEmpty
        .map((item) => `{\n${indentText(item.clauses.join("\n"))}\n}`)
        .join(" or ")};`;
      return {
        clauses: [clause],
        warnings: mergeWarnings(compiled.map((item) => item.warnings))
      };
    }

    if (expr.kind === "restriction") {
      if (!expr.property) {
        return { clauses: [], warnings: ["restriction without onProperty was skipped"] };
      }

      const relationName = identifiers.relation(expr.property);
      const attributeName = identifiers.attribute(expr.property);
      const targetExpr = hasConcreteExpr(expr.someValuesFrom)
        ? expr.someValuesFrom
        : hasConcreteExpr(expr.onClass)
          ? expr.onClass
          : hasConcreteExpr(expr.hasValue)
            ? expr.hasValue
            : hasConcreteExpr(expr.allValuesFrom)
              ? expr.allValuesFrom
              : null;
      const card = cardinalitySummary(expr);
      const warnings = [];
      const clauses = [];
      const propertyLabel = iriLocalName(expr.property);

      if (objectPropertyIris.has(expr.property)) {
        const roles = roleNamesForProperty(expr.property, relationName);
        const selfRole = expr.inverse ? roles.object : roles.subject;
        const otherRole = expr.inverse ? roles.subject : roles.object;
        const relationPattern = (targetVar) => `(${selfRole}: ${subjectVar}, ${otherRole}: ${targetVar}) isa ${relationName};`;
        const compileTargetClauses = (targetVar, target = targetExpr) => {
          const compiledTarget = target ? compileExpression(target, targetVar, ctx) : { clauses: [], warnings: [] };
          warnings.push(...compiledTarget.warnings);
          return compiledTarget.clauses;
        };
        const addWitnesses = (count, target = targetExpr) => {
          const witnesses = [];
          for (let index = 0; index < count; index += 1) {
            const targetVar = ctx.nextVar(iriLocalName(expr.property).toLowerCase());
            witnesses.push(targetVar);
            clauses.push(relationPattern(targetVar));
            clauses.push(...compileTargetClauses(targetVar, target));
          }
          for (let left = 0; left < witnesses.length; left += 1) {
            for (let right = left + 1; right < witnesses.length; right += 1) {
              clauses.push(distinctConceptClause(witnesses[left], witnesses[right]));
            }
          }
          return witnesses;
        };
        const addNoAdditionalWitnesses = (witnesses, target = targetExpr) => {
          const targetVar = ctx.nextVar(`extra_${iriLocalName(expr.property).toLowerCase()}`);
          const block = [`${relationPattern(targetVar)}`, ...compileTargetClauses(targetVar, target)];
          for (const witness of witnesses) block.push(distinctConceptClause(targetVar, witness));
          clauses.push(`not {\n${indentText(block.join("\n"))}\n};`);
        };

        const addAbsenceConstraint = (target = targetExpr) => {
          const targetVar = ctx.nextVar(`forbidden_${iriLocalName(expr.property).toLowerCase()}`);
          const block = [`${relationPattern(targetVar)}`, ...compileTargetClauses(targetVar, target)].join("\n");
          clauses.push(`not {\n${indentText(block)}\n};`);
        };

        if (card.exact === 0 || card.max === 0) {
          addAbsenceConstraint();
        } else if (card.exact === 1) {
          const witnesses = addWitnesses(1);
          addNoAdditionalWitnesses(witnesses);
        } else if (card.exact === 2) {
          const witnesses = addWitnesses(2);
          addNoAdditionalWitnesses(witnesses);
        } else if (card.exact !== null && card.exact > 2) {
          warnings.push(`${propertyLabel} exact cardinality ${card.exact} is not yet enforced exactly`);
          addWitnesses(1);
        } else if (card.min === 2) {
          addWitnesses(2);
        } else if (card.min !== null && card.min > 2) {
          warnings.push(`${propertyLabel} min cardinality ${card.min} is not yet enforced exactly`);
          addWitnesses(1);
        } else if (card.max === 1) {
          const first = ctx.nextVar(iriLocalName(expr.property).toLowerCase());
          const second = ctx.nextVar(iriLocalName(expr.property).toLowerCase());
          const block = [
            relationPattern(first),
            ...compileTargetClauses(first),
            relationPattern(second),
            ...compileTargetClauses(second),
            distinctConceptClause(first, second)
          ];
          clauses.push(`not {\n${indentText(block.join("\n"))}\n};`);
        } else if (card.max !== null && card.max > 1) {
          warnings.push(`${propertyLabel} max cardinality ${card.max} is not yet enforced exactly`);
        } else if (targetExpr || (card.min !== null && card.min > 0)) {
          addWitnesses(1);
        }

        if (hasConcreteExpr(expr.allValuesFrom)) {
          const targetVar = ctx.nextVar(`violating_${iriLocalName(expr.property).toLowerCase()}`);
          const compiledTarget = compileExpression(expr.allValuesFrom, targetVar, ctx);
          warnings.push(...compiledTarget.warnings);
          clauses.push(
            `not {\n${indentText(
              `${relationPattern(targetVar)}\nnot {\n${indentText(compiledTarget.clauses.join("\n"), "    ")}\n};`
            )}\n};`
          );
        }

      } else if (datatypePropertyIris.has(expr.property)) {
        const literalConstraint = (literalVar, target = targetExpr) => {
          if (!target || target.kind === "unknown") return [];
          if (target.kind === "literal") return [`${literalVar} == ${tqlString(target.value)};`];
          if (target.kind === "named") return [];
          warnings.push(`${propertyLabel} datatype target ${target.kind} is not yet enforced exactly`);
          return [];
        };
        const addLiteralWitnesses = (count, target = targetExpr) => {
          const witnesses = [];
          for (let index = 0; index < count; index += 1) {
            const literalVar = ctx.nextVar(iriLocalName(expr.property).toLowerCase());
            witnesses.push(literalVar);
            clauses.push(`${subjectVar} has ${attributeName} ${literalVar};`);
            clauses.push(...literalConstraint(literalVar, target));
          }
          for (let left = 0; left < witnesses.length; left += 1) {
            for (let right = left + 1; right < witnesses.length; right += 1) {
              clauses.push(distinctValueClause(witnesses[left], witnesses[right]));
            }
          }
          return witnesses;
        };
        const addNoAdditionalLiteralWitnesses = (witnesses, target = targetExpr) => {
          const literalVar = ctx.nextVar(`extra_${iriLocalName(expr.property).toLowerCase()}`);
          const block = [`${subjectVar} has ${attributeName} ${literalVar};`, ...literalConstraint(literalVar, target)];
          for (const witness of witnesses) block.push(distinctValueClause(literalVar, witness));
          clauses.push(`not {\n${indentText(block.join("\n"))}\n};`);
        };

        if (card.exact === 0 || card.max === 0) {
          const literalVar = ctx.nextVar(`forbidden_${iriLocalName(expr.property).toLowerCase()}`);
          const block = [`${subjectVar} has ${attributeName} ${literalVar};`, ...literalConstraint(literalVar)];
          clauses.push(`not {\n${indentText(block.join("\n"))}\n};`);
        } else if (card.exact === 1) {
          const witnesses = addLiteralWitnesses(1);
          addNoAdditionalLiteralWitnesses(witnesses);
        } else if (card.exact === 2) {
          const witnesses = addLiteralWitnesses(2);
          addNoAdditionalLiteralWitnesses(witnesses);
        } else if (card.exact !== null && card.exact > 2) {
          warnings.push(`${propertyLabel} exact cardinality ${card.exact} is not yet enforced exactly`);
          addLiteralWitnesses(1);
        } else if (card.min === 2) {
          addLiteralWitnesses(2);
        } else if (card.min !== null && card.min > 2) {
          warnings.push(`${propertyLabel} min cardinality ${card.min} is not yet enforced exactly`);
          addLiteralWitnesses(1);
        } else if (card.max === 1) {
          const first = ctx.nextVar(iriLocalName(expr.property).toLowerCase());
          const second = ctx.nextVar(iriLocalName(expr.property).toLowerCase());
          const block = [
            `${subjectVar} has ${attributeName} ${first};`,
            ...literalConstraint(first),
            `${subjectVar} has ${attributeName} ${second};`,
            ...literalConstraint(second),
            distinctValueClause(first, second)
          ];
          clauses.push(`not {\n${indentText(block.join("\n"))}\n};`);
        } else if (card.max !== null && card.max > 1) {
          warnings.push(`${propertyLabel} max cardinality ${card.max} is not yet enforced exactly`);
        } else {
          addLiteralWitnesses(1);
        }

        if (hasConcreteExpr(expr.allValuesFrom) && expr.allValuesFrom.kind !== "named") {
          warnings.push(`${propertyLabel} allValuesFrom on datatype property could not be enforced exactly`);
        }
      } else {
        warnings.push(`restriction property ${expr.property} is not mapped into schema or attribute generation`);
      }

      return {
        clauses,
        warnings: mergeWarnings([warnings])
      };
    }

    return {
      clauses: [],
      warnings: [`expression kind ${expr.kind} is not currently query-emitted`]
    };
  }

  const queryEntries = [];
  const fetchCandidate = [`fetch {`, `  "candidate": $candidate`, `};`];
  const queryLines = [
    "# Provenance bootstrap",
    "# upstream-repo: https://github.com/semanticarts/gist",
    "# upstream-tag: v14.0.0",
    "# upstream-commit: 6ab80c158a7fa56a1b5d3d824b125b92107e8f08",
    "# source-artifacts:",
    "# - upstream/gist/v14.0.0/ontologies/gistCore.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistMediaTypes.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistPrefixDeclarations.ttl",
    "# - upstream/gist/v14.0.0/ontologies/gistValidationAnnotations.ttl",
    `# manifest: ${MANIFEST_PATH}`,
    `# generator: ${GENERATOR}`,
    ""
  ];

  const classesWithEquivalent = model.resources.classes
    .filter((cls) => cls.equivalentClass.length > 0)
    .sort((a, b) => iriLocalName(a.iri).localeCompare(iriLocalName(b.iri)));

  for (const cls of classesWithEquivalent) {
    const ctx = createContext();
    const typeLabel = iriLocalName(cls.iri);
    const entityName = identifiers.entity(cls.iri);
    const compiled = cls.equivalentClass.map((term) => compileExpression(parseExpression(model, term), "$candidate", ctx));
    const clauses = compiled.flatMap((item) => item.clauses);
    const warnings = mergeWarnings(compiled.map((item) => item.warnings));

    if (!clauses.length) continue;

    const queryDefs = [
      {
        name: `axiom::${typeLabel}::satisfies`,
        kind: "satisfies",
        body: [`match`, `  $candidate isa ${entityName};`, ...clauses.flatMap((clause) => indentText(clause).split("\n")), ...fetchCandidate]
      },
      {
        name: `axiom::${typeLabel}::violation::equivalent-class-1`,
        kind: "violation",
        body: [
          `match`,
          `  $candidate isa ${entityName};`,
          `  not {`,
          indentText(clauses.join("\n"), "    "),
          `  };`,
          ...fetchCandidate
        ]
      },
      {
        name: `axiom::${typeLabel}::candidates`,
        kind: "candidates",
        body: [
          `match`,
          ...clauses.flatMap((clause) => indentText(clause).split("\n")),
          `  not {`,
          `    $candidate isa ${entityName};`,
          `  };`,
          ...fetchCandidate
        ]
      }
    ];

    for (const definition of queryDefs) {
      queryLines.push(`# name: ${definition.name}`);
      queryLines.push(`# source-class: ${cls.iri}`);
      for (const warning of warnings) queryLines.push(`# warning: ${warning}`);
      queryLines.push(...definition.body);
      queryLines.push("");
      queryEntries.push({
        name: definition.name,
        kind: definition.kind,
        file: "queries/gistCore-axioms.tql",
        marker: `# name: ${definition.name}`,
        classIri: cls.iri,
        typeLabel,
        warnings
      });
    }
  }

  return {
    library: `${queryLines.join("\n").trim()}\n`,
    index: JSON.stringify(
      {
        package: "gist",
        version: packageJson.version,
        generatedBy: GENERATOR,
        file: "queries/gistCore-axioms.tql",
        queryCount: queryEntries.length,
        queries: queryEntries
      },
      null,
      2
    ) + "\n",
    summary: {
      classesCovered: uniqueSorted(queryEntries.map((entry) => entry.classIri)),
      warnings: uniqueSorted(queryEntries.flatMap((entry) => entry.warnings))
    }
  };
}

function renderReport(model, propertyInfo, entityDefinitions, identifiers) {
  const axiomArtifacts = buildAxiomQueryArtifacts(model, identifiers);
  const hierarchyStats = collectPropertyHierarchyStats(model);
  const renamedRelations = model.resources.objectProperties
    .map((property) => ({
      iri: property.iri,
      typeLabel: iriLocalName(property.iri),
      generatedLabel: identifiers.relation(property.iri)
    }))
    .filter((item) => item.generatedLabel !== item.typeLabel);
  const renamedAttributes = model.resources.datatypeProperties
    .map((property) => ({
      iri: property.iri,
      typeLabel: iriLocalName(property.iri),
      generatedLabel: identifiers.attribute(property.iri)
    }))
    .filter((item) => item.generatedLabel !== item.typeLabel);
  const renamedClasses = model.resources.classes
    .map((cls) => ({
      iri: cls.iri,
      typeLabel: iriLocalName(cls.iri),
      generatedLabel: identifiers.entity(cls.iri)
    }))
    .filter((item) => item.generatedLabel !== item.typeLabel);

  const report = {
    package: "gist",
    version: packageJson.version,
    generatedBy: GENERATOR,
    summary: {
      classes: model.resources.classes.length,
      objectProperties: model.resources.objectProperties.length,
      datatypeProperties: model.resources.datatypeProperties.length,
      seedInstances: model.resources.instances.length
    },
    strategy: {
      unionDomainRange: "emit one relation per OWL object property and allow every named union member to play the appropriate subject/object role",
      inverseProperties: "emit the inverse property as its own relation; preserve OWL inverse/functionality characteristics as report metadata",
      datatypePropertyHierarchy: "emit named datatype-property rdfs:subPropertyOf edges as TypeDB attribute subtyping; root attributes carry primitive value types",
      objectPropertyHierarchy: "emit named object-property rdfs:subPropertyOf edges as TypeDB relation subtyping with subject/object role specialization",
      datetimeProperties: "map xsd:date and xsd:dateTime primitive ranges to TypeDB datetime values on root attributes; hierarchy is preserved structurally",
      multipleInheritance: "choose the deterministic first named superclass; preserve equivalent-class restrictions in the IR/report for later axiom-query generation"
    },
    coverage: {
      propertyHierarchy: {
        datatypeSubPropertyEdgesDiscovered: hierarchyStats.datatypeSubPropertyEdges,
        datatypeSubPropertyEdgesEmitted: hierarchyStats.datatypeSubPropertyEdges,
        objectSubPropertyEdgesDiscovered: hierarchyStats.objectSubPropertyEdges,
        objectSubPropertyEdgesEmitted: hierarchyStats.objectSubPropertyEdges,
        roleSpecializationsEmitted: hierarchyStats.roleSpecializations
      },
      classesWithoutNamedSupertype: model.resources.classes
        .filter((cls) => entityDefinitions.get(cls.iri).supertype === null)
        .map((cls) => cls.iri),
      propertiesWithoutDomainAfterInference: [...model.resources.objectProperties, ...model.resources.datatypeProperties]
        .filter((property) => propertyInfo.propertyInfo.get(property.iri).domain.size === 0)
        .map((property) => property.iri),
      propertiesWithoutRangeAfterInference: [...model.resources.objectProperties, ...model.resources.datatypeProperties]
        .filter((property) => propertyInfo.propertyInfo.get(property.iri).range.size === 0)
        .map((property) => property.iri),
      equivalentClassAxiomsPending: model.resources.classes
        .filter((cls) => cls.equivalentClass.length > 0)
        .filter((cls) => !axiomArtifacts.summary.classesCovered.includes(cls.iri))
        .map((cls) => cls.iri),
      queryableProvenanceSeedDataPending: false,
      axiomQueryCoverage: {
        classesCovered: axiomArtifacts.summary.classesCovered,
        approximations: axiomArtifacts.summary.warnings
      },
      renamedIdentifiers: {
        relations: renamedRelations,
        attributes: renamedAttributes,
        classes: renamedClasses
      }
    },
    classes: model.resources.classes.map((cls) => ({
      iri: cls.iri,
      typeLabel: iriLocalName(cls.iri),
      generatedLabel: identifiers.entity(cls.iri),
      supertype: entityDefinitions.get(cls.iri).supertype,
      owns: Array.from(entityDefinitions.get(cls.iri).owns).sort(),
      plays: Array.from(entityDefinitions.get(cls.iri).plays).sort()
    })),
    properties: [...model.resources.objectProperties, ...model.resources.datatypeProperties].map((property) => ({
      iri: property.iri,
      typeLabel: iriLocalName(property.iri),
      generatedLabel: model.resources.objectProperties.some((item) => item.iri === property.iri)
        ? identifiers.relation(property.iri)
        : identifiers.attribute(property.iri),
      domain: Array.from(propertyInfo.propertyInfo.get(property.iri).domain).sort(),
      range: Array.from(propertyInfo.propertyInfo.get(property.iri).range).sort(),
      owlTypes: property.types
    }))
  };

  return JSON.stringify(report, null, 2) + "\n";
}

async function main() {
  const outIndex = process.argv.indexOf("--out-dir");
  const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : ".";
  const outputRoot = path.isAbsolute(outDir) ? outDir : path.join(root, outDir);
  const model = await loadOntologyModel(root);
  let currentManifest = { artifacts: [] };
  try {
    currentManifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST_PATH), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const identifiers = buildIdentifierMaps(model);
  const propertyInfo = inferPropertyTypes(model);
  const entityDefinitions = buildEntityDefinitions(model, propertyInfo, identifiers);
  const axiomArtifacts = buildAxiomQueryArtifacts(model, identifiers);
  const schemaText = renderSchema(model, propertyInfo, entityDefinitions, identifiers);
  const docsPath = path.join(outputRoot, SCHEMA_DOCS_PATH);
  const structure = parseTypeQLSchemaStructure([schemaText]);
  const existingDocsText = await fs.readFile(path.join(root, "data/gistCore-schema-docs.tql"), "utf8");
  const docsText = replaceGeneratedStructuralSection(
    existingDocsText,
    renderStructuralMetadataSection({
      repoUrl: packageJson.source,
      moduleKey: "gist-core",
      structure,
    })
  );
  const seedDataText = renderSeedData(model, identifiers);
  const reportText = renderReport(model, propertyInfo, entityDefinitions, identifiers);
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  await fs.mkdir(path.join(outputRoot, "schema"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "data"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "queries"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "manifests"), { recursive: true });

  await fs.writeFile(path.join(outputRoot, "schema/gistCore.tql"), schemaText, "utf8");
  await fs.writeFile(docsPath, docsText, "utf8");
  const schemaDocApplyUnits = await renderSchemaDocApplyUnits(docsText, outputRoot);
  await fs.writeFile(path.join(outputRoot, "data/gistCore-domain-seeds.tql"), seedDataText, "utf8");
  await fs.writeFile(path.join(outputRoot, "queries/gistCore-axioms.tql"), axiomArtifacts.library, "utf8");
  await fs.writeFile(path.join(outputRoot, `${MANIFEST_PREFIX}.axiom-queries.json`), axiomArtifacts.index, "utf8");
  await fs.writeFile(path.join(outputRoot, `${MANIFEST_PREFIX}.translation-report.json`), reportText, "utf8");

  const artifactEntries = [
    {
      kind: "meta-schema",
      path: "schema/self-describing-schema.tql",
      sha256: await sha256File(path.join(root, "schema/self-describing-schema.tql")),
    },
    {
      kind: "provenance-schema",
      path: "schema/package-provenance.tql",
      sha256: await sha256File(path.join(root, "schema/package-provenance.tql")),
    },
    {
      kind: "administrative-schema",
      path: "schema/administrative-operations.tql",
      sha256: await sha256File(path.join(root, "schema/administrative-operations.tql")),
    },
    {
      kind: "schema",
      path: "schema/gistCore.tql",
      sha256: sha256Text(schemaText),
    },
    {
      kind: "domain-seeds",
      path: "data/gistCore-domain-seeds.tql",
      sha256: sha256Text(seedDataText),
    },
    {
      kind: "documentation",
      path: SCHEMA_DOCS_PATH,
      sha256: sha256Text(docsText),
    },
    {
      kind: "axiom-query-library",
      path: "queries/gistCore-axioms.tql",
      sha256: sha256Text(axiomArtifacts.library),
    },
    {
      kind: "axiom-query-index",
      path: `${MANIFEST_PREFIX}.axiom-queries.json`,
      sha256: sha256Text(axiomArtifacts.index),
    },
    {
      kind: "ir-summary",
      path: `${MANIFEST_PREFIX}.ir-summary.json`,
      sha256: await sha256File(path.join(root, `${MANIFEST_PREFIX}.ir-summary.json`)),
    },
    {
      kind: "translation-report",
      path: `${MANIFEST_PREFIX}.translation-report.json`,
      sha256: sha256Text(reportText),
    },
  ];

  const upstreamSourceArtifacts = currentManifest.upstream?.sourceArtifacts ?? await Promise.all(
    packageJson.upstream.sourceArtifacts.map(async (artifactPath) => ({
      path: artifactPath,
      sha256: await sha256File(path.join(root, artifactPath)),
    }))
  );

  const manifestBase = {
    ...currentManifest,
    package: {
      ...(currentManifest.package ?? {}),
      name: packageJson.name,
      version: packageJson.version,
    },
    upstream: {
      repoUrl: currentManifest.upstream?.repoUrl ?? packageJson.upstream.repo,
      tag: currentManifest.upstream?.tag ?? packageJson.upstream.tag,
      commit: currentManifest.upstream?.commit ?? packageJson.upstream.commit,
      sourceArtifacts: upstreamSourceArtifacts,
    },
    generator: {
      ...(currentManifest.generator ?? {}),
      name: currentManifest.generator?.name ?? GENERATOR.split("/")[0],
      version: currentManifest.generator?.version ?? GENERATOR.split("/")[1],
      generatedAt,
    },
    artifacts: artifactEntries,
  };

  const provenanceText = renderProvenanceData(manifestBase);
  const manifest = {
    ...manifestBase,
    artifacts: [
      artifactEntries[0],
      artifactEntries[1],
      artifactEntries[2],
      artifactEntries[3],
      artifactEntries[4],
      {
        kind: "provenance-seeds",
        path: "data/gistCore-provenance.tql",
        sha256: sha256Text(provenanceText),
      },
      ...artifactEntries.slice(5),
      ...schemaDocApplyUnits.artifacts,
    ],
  };

  await fs.writeFile(path.join(outputRoot, "data/gistCore-provenance.tql"), provenanceText, "utf8");
  await fs.writeFile(
    path.join(outputRoot, `${MANIFEST_PREFIX}.translation-manifest.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  if (outputRoot === root) {
    const nextPackageJson = structuredClone(packageJson);
    nextPackageJson.data = replaceSchemaDocApplyUnitPaths(packageJson.data, schemaDocApplyUnits.paths);
    nextPackageJson.assembly = {
      ...(packageJson.assembly ?? {}),
      loadOrder: replaceSchemaDocApplyUnitPaths(packageJson.assembly?.loadOrder, schemaDocApplyUnits.paths),
      generatedArtifacts: replaceSchemaDocApplyUnitPaths(
        packageJson.assembly?.generatedArtifacts,
        schemaDocApplyUnits.paths,
        { includeSchemaDocsPath: true }
      ),
    };
    await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify(nextPackageJson, null, 2)}\n`, "utf8");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
