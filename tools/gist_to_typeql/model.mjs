import fs from "node:fs/promises";
import path from "node:path";

import { Parser } from "n3";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const RDF_FIRST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
export const RDF_REST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
export const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
export const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
export const RDFS_SUBPROPERTY = "http://www.w3.org/2000/01/rdf-schema#subPropertyOf";
export const RDFS_DOMAIN = "http://www.w3.org/2000/01/rdf-schema#domain";
export const RDFS_RANGE = "http://www.w3.org/2000/01/rdf-schema#range";
export const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
export const OWL_OBJECT_PROPERTY = "http://www.w3.org/2002/07/owl#ObjectProperty";
export const OWL_DATATYPE_PROPERTY = "http://www.w3.org/2002/07/owl#DatatypeProperty";
export const OWL_ANNOTATION_PROPERTY = "http://www.w3.org/2002/07/owl#AnnotationProperty";
export const OWL_NAMED_INDIVIDUAL = "http://www.w3.org/2002/07/owl#NamedIndividual";
export const OWL_ONTOLOGY = "http://www.w3.org/2002/07/owl#Ontology";
export const OWL_EQUIVALENT_CLASS = "http://www.w3.org/2002/07/owl#equivalentClass";
export const OWL_UNION_OF = "http://www.w3.org/2002/07/owl#unionOf";
export const OWL_INTERSECTION_OF = "http://www.w3.org/2002/07/owl#intersectionOf";
export const OWL_RESTRICTION = "http://www.w3.org/2002/07/owl#Restriction";
export const OWL_ON_PROPERTY = "http://www.w3.org/2002/07/owl#onProperty";
export const OWL_SOME_VALUES_FROM = "http://www.w3.org/2002/07/owl#someValuesFrom";
export const OWL_ALL_VALUES_FROM = "http://www.w3.org/2002/07/owl#allValuesFrom";
export const OWL_ON_CLASS = "http://www.w3.org/2002/07/owl#onClass";
export const OWL_HAS_VALUE = "http://www.w3.org/2002/07/owl#hasValue";
export const OWL_INVERSE_OF = "http://www.w3.org/2002/07/owl#inverseOf";

export const ANNOTATION_MAP = {
  "http://www.w3.org/2004/02/skos/core#prefLabel": "prefLabel",
  "http://www.w3.org/2004/02/skos/core#definition": "definition",
  "http://www.w3.org/2004/02/skos/core#example": "example",
  "http://www.w3.org/2004/02/skos/core#scopeNote": "scopeNote",
  "http://www.w3.org/2004/02/skos/core#editorialNote": "editorialNote",
  "http://www.w3.org/2004/02/skos/core#altLabel": "altLabel",
  "http://www.w3.org/2004/02/skos/core#historyNote": "historyNote",
  "http://www.w3.org/2000/01/rdf-schema#seeAlso": "seeAlso",
  "https://w3id.org/semanticarts/ns/ontology/gist/domainIncludes": "domainIncludes",
  "http://www.w3.org/2002/07/owl#deprecated": "deprecated"
};

const RESOURCE_TYPES = new Set([
  OWL_CLASS,
  OWL_OBJECT_PROPERTY,
  OWL_DATATYPE_PROPERTY,
  OWL_ANNOTATION_PROPERTY,
  OWL_NAMED_INDIVIDUAL
]);

const NON_INSTANCE_TYPES = new Set([
  OWL_CLASS,
  OWL_OBJECT_PROPERTY,
  OWL_DATATYPE_PROPERTY,
  OWL_ANNOTATION_PROPERTY,
  OWL_NAMED_INDIVIDUAL,
  OWL_ONTOLOGY
]);

export function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])])
    );
  }
  return value;
}

export function termToValue(term) {
  if (term.termType === "Literal") {
    return {
      termType: "Literal",
      value: term.value,
      datatype: term.datatype?.value ?? null,
      language: term.language || null
    };
  }
  return {
    termType: term.termType,
    value: term.value
  };
}

function pushMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function getPredicateEntries(entry, predicate) {
  return (entry.predicates.get(predicate) ?? []).map(termToValue);
}

function buildResource(bySubject, subject, expectedType) {
  const entry = bySubject.get(subject);
  const predicates = entry.predicates;
  const rdfTypes = (predicates.get(RDF_TYPE) ?? []).map((term) => term.value).sort();
  if (!rdfTypes.includes(expectedType)) return null;

  const annotations = {};
  for (const [predicate, key] of Object.entries(ANNOTATION_MAP)) {
    const values = (predicates.get(predicate) ?? []).map((term) => termToValue(term).value);
    if (values.length) annotations[key] = values.sort();
  }

  return {
    iri: subject,
    types: rdfTypes,
    sourceFiles: Array.from(entry.sourceFiles).sort(),
    subClassOf: getPredicateEntries(entry, RDFS_SUBCLASS).sort((a, b) => a.value.localeCompare(b.value)),
    subPropertyOf: getPredicateEntries(entry, RDFS_SUBPROPERTY).sort((a, b) => a.value.localeCompare(b.value)),
    domain: getPredicateEntries(entry, RDFS_DOMAIN).sort((a, b) => a.value.localeCompare(b.value)),
    range: getPredicateEntries(entry, RDFS_RANGE).sort((a, b) => a.value.localeCompare(b.value)),
    equivalentClass: getPredicateEntries(entry, OWL_EQUIVALENT_CLASS).sort((a, b) => a.value.localeCompare(b.value)),
    annotations
  };
}

function buildInstance(bySubject, classIris, subject) {
  const entry = bySubject.get(subject);
  const predicates = entry.predicates;
  const assertedTypes = (predicates.get(RDF_TYPE) ?? [])
    .map((term) => term.value)
    .filter((value) => !NON_INSTANCE_TYPES.has(value) && classIris.has(value))
    .sort();
  if (!assertedTypes.length) return null;

  const annotations = {};
  for (const [predicate, key] of Object.entries(ANNOTATION_MAP)) {
    const values = (predicates.get(predicate) ?? []).map(termToValue);
    if (values.length) annotations[key] = values.sort((a, b) => `${a.termType}:${a.value}`.localeCompare(`${b.termType}:${b.value}`));
  }

  const properties = Array.from(predicates.entries())
    .filter(([predicate]) => predicate !== RDF_TYPE)
    .map(([predicate, terms]) => ({
      predicate,
      values: terms.map(termToValue).sort((a, b) => `${a.termType}:${a.value}`.localeCompare(`${b.termType}:${b.value}`))
    }))
    .sort((a, b) => a.predicate.localeCompare(b.predicate));

  return {
    iri: subject,
    types: assertedTypes,
    sourceFiles: Array.from(entry.sourceFiles).sort(),
    annotations,
    properties
  };
}

export async function loadOntologyModel(root) {
  const inventory = JSON.parse(
    await fs.readFile(path.join(root, "upstream/gist/v14.0.0/source-artifacts.json"), "utf8")
  );

  const parser = new Parser();
  const bySubject = new Map();

  for (const source of inventory.files) {
    const relPath = typeof source === "string" ? source : source.path;
    const absolutePath = path.join(root, "upstream/gist/v14.0.0", relPath);
    const ttl = await fs.readFile(absolutePath, "utf8");
    for (const quad of parser.parse(ttl)) {
      const subject = quad.subject.value;
      if (!bySubject.has(subject)) {
        bySubject.set(subject, {
          termType: quad.subject.termType,
          sourceFiles: new Set(),
          predicates: new Map()
        });
      }
      const entry = bySubject.get(subject);
      entry.sourceFiles.add(path.join("upstream/gist/v14.0.0", relPath));
      pushMap(entry.predicates, quad.predicate.value, quad.object);
    }
  }

  const resources = {
    classes: [],
    objectProperties: [],
    datatypeProperties: [],
    annotationProperties: [],
    namedIndividuals: [],
    instances: []
  };

  const blankNodes = {};

  for (const [subject, entry] of bySubject.entries()) {
    if (entry.termType === "BlankNode") {
      blankNodes[subject] = Array.from(entry.predicates.entries())
        .flatMap(([predicate, objects]) =>
          objects.map((object) => ({
            predicate,
            object: termToValue(object)
          }))
        )
        .sort((a, b) => `${a.predicate}:${a.object.value}`.localeCompare(`${b.predicate}:${b.object.value}`));
      continue;
    }

    const categories = [
      ["classes", OWL_CLASS],
      ["objectProperties", OWL_OBJECT_PROPERTY],
      ["datatypeProperties", OWL_DATATYPE_PROPERTY],
      ["annotationProperties", OWL_ANNOTATION_PROPERTY],
      ["namedIndividuals", OWL_NAMED_INDIVIDUAL]
    ];

    for (const [bucket, expectedType] of categories) {
      const resource = buildResource(bySubject, subject, expectedType);
      if (resource) resources[bucket].push(resource);
    }
  }

  for (const items of Object.values(resources)) {
    items.sort((a, b) => a.iri.localeCompare(b.iri));
  }

  const classIris = new Set(resources.classes.map((item) => item.iri));
  for (const [subject, entry] of bySubject.entries()) {
    if (entry.termType === "BlankNode") continue;
    const instance = buildInstance(bySubject, classIris, subject);
    if (instance) resources.instances.push(instance);
  }
  resources.instances.sort((a, b) => a.iri.localeCompare(b.iri));

  return {
    metadata: {
      package: "gist",
      version: "14.0.0",
      upstreamTag: "v14.0.0",
      upstreamCommit: "6ab80c158a7fa56a1b5d3d824b125b92107e8f08",
      sourceArtifacts: inventory.files.map((file) => (typeof file === "string" ? file : file.path))
    },
    counts: {
      classes: resources.classes.length,
      objectProperties: resources.objectProperties.length,
      datatypeProperties: resources.datatypeProperties.length,
      annotationProperties: resources.annotationProperties.length,
      namedIndividuals: resources.namedIndividuals.length,
      instances: resources.instances.length,
      blankNodes: Object.keys(blankNodes).length
    },
    resources,
    blankNodes
  };
}

export function isResourceType(value) {
  return RESOURCE_TYPES.has(value);
}
