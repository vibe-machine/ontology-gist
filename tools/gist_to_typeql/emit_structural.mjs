import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OWL_ALL_VALUES_FROM,
  OWL_HAS_VALUE,
  OWL_INTERSECTION_OF,
  OWL_INVERSE_OF,
  OWL_ON_CLASS,
  OWL_ON_PROPERTY,
  OWL_RESTRICTION,
  OWL_SOME_VALUES_FROM,
  OWL_UNION_OF,
  RDF_FIRST,
  RDF_NIL,
  RDF_REST,
  RDF_TYPE,
  loadOntologyModel,
} from "./model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const MANIFEST_PATH = "manifests/gist-v14.0.0.translation-manifest.json";
const GENERATOR = "gist-structural-emitter/0.3.0";
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

function tqlString(value) {
  return JSON.stringify(value);
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function buildIdentifierMaps(model) {
  const entityNames = new Map();
  const relationNames = new Map();
  const attributeNames = new Map();

  for (const cls of model.resources.classes) {
    entityNames.set(cls.iri, safeIdentifier(iriLocalName(cls.iri), "Type"));
  }
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
      hasValue: parseExpression(model, getBlankNodeObjects(model, nodeId, OWL_HAS_VALUE)[0])
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

function buildEntityDefinitions(model, propertyInfo, identifiers) {
  const definitions = new Map();
  const seedInstanceOwners = new Map();

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
      supertype: choosePrimarySupertype(model, cls),
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
    const subjectRole = `${localName}Subject`;
    const objectRole = `${localName}Object`;
    for (const owner of info.domain) {
      if (definitions.has(owner)) definitions.get(owner).plays.add(`${localName}:${subjectRole}`);
    }
    for (const owner of info.range) {
      if (definitions.has(owner)) definitions.get(owner).plays.add(`${localName}:${objectRole}`);
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
  }

  return definitions;
}

function renderSchema(model, propertyInfo, entityDefinitions, identifiers) {
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

  const attributeNames = new Set(["sourceIRI"]);
  for (const property of model.resources.datatypeProperties) attributeNames.add(identifiers.attribute(property.iri));

  for (const attributeName of Array.from(attributeNames).sort((a, b) => a.localeCompare(b))) {
    if (attributeName === "sourceIRI") {
      lines.push(`attribute ${attributeName} value string;`);
      continue;
    }
    const property = model.resources.datatypeProperties.find((item) => identifiers.attribute(item.iri) === attributeName);
    lines.push(`attribute ${attributeName} value ${inferAttributeValueType(model, property, propertyInfo)};`);
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
    lines.push(`relation ${localName},`);
    lines.push(`    relates ${localName}Subject,`);
    lines.push(`    relates ${localName}Object;`);
    lines.push("");
  }

  const classList = model.resources.classes
    .slice()
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
    "",
    "insert",
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

    lines.push(`${variable} isa ${typeName},`);
    const formattedAttrs = lineList(attrs.map((item) => `${item},`), "  ");
    formattedAttrs[formattedAttrs.length - 1] = formattedAttrs[formattedAttrs.length - 1].replace(/,$/, ";");
    lines.push(...formattedAttrs);
    lines.push("");
  });

  return lines.join("\n");
}

function renderProvenanceData(manifest) {
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
    "insert",
    ""
  ];

  lines.push(`$build isa OntologyPackageBuild,`);
  lines.push(`  has buildKey ${tqlString(`${manifest.package.name}@${manifest.package.version}:${manifest.upstream.commit}`)},`);
  lines.push(`  has packageName ${tqlString(manifest.package.name)},`);
  lines.push(`  has packageVersion ${tqlString(manifest.package.version)},`);
  lines.push(`  has upstreamRepoUrl ${tqlString(manifest.upstream.repoUrl)},`);
  lines.push(`  has upstreamTag ${tqlString(manifest.upstream.tag)},`);
  lines.push(`  has upstreamCommit ${tqlString(manifest.upstream.commit)},`);
  lines.push(`  has manifestPath ${tqlString(MANIFEST_PATH)},`);
  lines.push(`  has generatorName ${tqlString(manifest.generator.name)},`);
  lines.push(`  has generatorVersion ${tqlString(manifest.generator.version)},`);
  lines.push(`  has generatedAt ${tqlString(manifest.generator.generatedAt)};`);
  lines.push("");

  manifest.upstream.sourceArtifacts.forEach((artifact, index) => {
    const variable = `$s${index + 1}`;
    lines.push(`${variable} isa SourceArtifactRecord,`);
    lines.push(`  has sourcePath ${tqlString(artifact.path)},`);
    lines.push(`  has sourceSha256 ${tqlString(artifact.sha256)};`);
    lines.push(`(build: $build, sourceArtifact: ${variable}) isa buildHasSourceArtifact;`);
    lines.push("");
  });

  const generatedArtifacts = manifest.artifacts.filter((artifact) => artifact.path !== "data/gistCore-provenance.tql");
  generatedArtifacts.forEach((artifact, index) => {
    const variable = `$g${index + 1}`;
    lines.push(`${variable} isa GeneratedArtifactRecord,`);
    lines.push(`  has artifactPath ${tqlString(artifact.path)},`);
    lines.push(`  has artifactKind ${tqlString(artifact.kind)},`);
    lines.push(`  has artifactSha256 ${tqlString(artifact.sha256)};`);
    lines.push(`(build: $build, generatedArtifact: ${variable}) isa buildHasGeneratedArtifact;`);
    lines.push("");
  });

  return lines.join("\n");
}

function renderReport(model, propertyInfo, entityDefinitions, identifiers) {
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
    version: "14.0.0",
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
      datetimeProperties: "flatten xsd:date and xsd:dateTime variants to TypeDB datetime attributes",
      multipleInheritance: "choose the deterministic first named superclass; preserve equivalent-class restrictions in the IR/report for later axiom-query generation"
    },
    coverage: {
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
        .map((cls) => cls.iri),
      queryableProvenanceSeedDataPending: false,
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
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST_PATH), "utf8"));
  const identifiers = buildIdentifierMaps(model);
  const propertyInfo = inferPropertyTypes(model);
  const entityDefinitions = buildEntityDefinitions(model, propertyInfo, identifiers);

  await fs.mkdir(path.join(outputRoot, "schema"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "data"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "manifests"), { recursive: true });

  await fs.writeFile(path.join(outputRoot, "schema/gistCore.tql"), renderSchema(model, propertyInfo, entityDefinitions, identifiers), "utf8");
  await fs.writeFile(path.join(outputRoot, "data/gistCore-domain-seeds.tql"), renderSeedData(model, identifiers), "utf8");
  await fs.writeFile(path.join(outputRoot, "data/gistCore-provenance.tql"), renderProvenanceData(manifest), "utf8");
  await fs.writeFile(
    path.join(outputRoot, "manifests/gist-v14.0.0.translation-report.json"),
    renderReport(model, propertyInfo, entityDefinitions, identifiers),
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
