const GENERATED_SECTION_START = "# -- BEGIN GENERATED STRUCTURAL METADATA --";
const GENERATED_SECTION_END = "# -- END GENERATED STRUCTURAL METADATA --";

function tqlString(value) {
  return JSON.stringify(value);
}

function stripComments(text) {
  return text.replace(/^#.*$/gm, "");
}

function splitStatements(text) {
  const statements = [];
  let current = "";

  for (const char of text) {
    current += char;
    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function extractDefineStatements(text) {
  const cleaned = stripComments(text);
  const parts = cleaned.split(/\bdefine\b/gi).slice(1);
  return parts.flatMap((part) => splitStatements(part));
}

function splitCapabilities(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureType(structure, typeLabel, kind = "entity") {
  if (!structure.typeKinds.has(typeLabel)) {
    structure.typeKinds.set(typeLabel, kind);
  }
}

function ensureSet(map, key) {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
}

function parseOwnsToken(token) {
  const match = /^owns\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(token);
  return match?.[1] ?? null;
}

function parsePlaysToken(token) {
  const match = /^plays\s+([A-Za-z_][A-Za-z0-9_]*:[A-Za-z_][A-Za-z0-9_]*)/.exec(token);
  return match?.[1] ?? null;
}

function parseRelatesToken(token) {
  const match = /^relates\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?$/.exec(token);
  return match?.[1] ?? null;
}

function roleTypeLabel(relationLabel, roleLabel) {
  return `${relationLabel}:${roleLabel}`;
}

function normalizeStructure(structure) {
  const attributeResources = Array.from(structure.attributes).sort().map((typeLabel) => ({
    typeLabel,
    kind: "attribute",
    valueTypeName: structure.attributeValueTypes.get(typeLabel) ?? null,
  }));

  const roleResources = Array.from(structure.relatesEdges)
    .sort((lhs, rhs) => lhs.localeCompare(rhs))
    .map((edgeKey) => {
      const [relationLabel, roleLabel] = edgeKey.split("::");
      return {
        typeLabel: roleTypeLabel(relationLabel, roleLabel),
        relationLabel,
        roleName: roleLabel,
        kind: "role",
      };
    });

  const subtypeEdges = Array.from(structure.subtypeEdges)
    .sort((lhs, rhs) => lhs.localeCompare(rhs))
    .map((edgeKey) => {
      const [subtype, supertype] = edgeKey.split("::");
      return { subtype, supertype };
    });

  const ownsEdges = Array.from(structure.ownsEdges)
    .sort((lhs, rhs) => lhs.localeCompare(rhs))
    .map((edgeKey) => {
      const [owner, attribute] = edgeKey.split("::");
      return { owner, attribute };
    });

  const playsEdges = Array.from(structure.playsEdges)
    .sort((lhs, rhs) => lhs.localeCompare(rhs))
    .map((edgeKey) => {
      const [player, role] = edgeKey.split("::");
      return { player, role };
    });

  const relatesEdges = Array.from(structure.relatesEdges)
    .sort((lhs, rhs) => lhs.localeCompare(rhs))
    .map((edgeKey) => {
      const [relationLabel, roleLabel] = edgeKey.split("::");
      return { relationLabel, roleLabel, roleTypeLabel: roleTypeLabel(relationLabel, roleLabel) };
    });

  return {
    typeKinds: new Map(structure.typeKinds),
    attributeResources,
    roleResources,
    subtypeEdges,
    ownsEdges,
    playsEdges,
    relatesEdges,
  };
}

function parseTypeQLSchemaStructure(schemaTexts) {
  const structure = {
    typeKinds: new Map(),
    attributes: new Set(),
    attributeValueTypes: new Map(),
    subtypeEdges: new Set(),
    ownsEdges: new Set(),
    playsEdges: new Set(),
    relatesEdges: new Set(),
  };

  for (const schemaText of schemaTexts) {
    const statements = extractDefineStatements(schemaText);

    for (const statement of statements) {
      const normalized = statement.replace(/\s+/g, " ").trim().replace(/;$/, "");
      if (!normalized) continue;

      if (normalized.startsWith("attribute ")) {
        const match = /^attribute\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*,)?\s+value\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(normalized);
        if (!match) continue;
        const [, attributeLabel, valueTypeName] = match;
        structure.attributes.add(attributeLabel);
        structure.typeKinds.set(attributeLabel, "attribute");
        structure.attributeValueTypes.set(attributeLabel, valueTypeName);
        continue;
      }

      if (normalized.startsWith("entity ")) {
        const match = /^entity\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+sub\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s*,\s*(.*))?$/.exec(normalized);
        if (!match) continue;
        const [, entityLabel, supertypeLabel, capabilityText] = match;
        ensureType(structure, entityLabel, "entity");
        if (supertypeLabel) {
          structure.subtypeEdges.add(`${entityLabel}::${supertypeLabel}`);
        }
        for (const token of splitCapabilities(capabilityText ?? "")) {
          const ownedAttribute = parseOwnsToken(token);
          if (ownedAttribute) {
            structure.ownsEdges.add(`${entityLabel}::${ownedAttribute}`);
            structure.attributes.add(ownedAttribute);
            ensureType(structure, ownedAttribute, "attribute");
            continue;
          }
          const playedRole = parsePlaysToken(token);
          if (playedRole) {
            structure.playsEdges.add(`${entityLabel}::${playedRole}`);
          }
        }
        continue;
      }

      if (normalized.startsWith("relation ")) {
        const match = /^relation\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+sub\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s*,\s*(.*))?$/.exec(normalized);
        if (!match) continue;
        const [, relationLabel, supertypeLabel, capabilityText] = match;
        ensureType(structure, relationLabel, "relation");
        if (supertypeLabel) {
          structure.subtypeEdges.add(`${relationLabel}::${supertypeLabel}`);
        }
        for (const token of splitCapabilities(capabilityText ?? "")) {
          const roleLabel = parseRelatesToken(token);
          if (roleLabel) {
            structure.relatesEdges.add(`${relationLabel}::${roleLabel}`);
            continue;
          }
          const ownedAttribute = parseOwnsToken(token);
          if (ownedAttribute) {
            structure.ownsEdges.add(`${relationLabel}::${ownedAttribute}`);
            structure.attributes.add(ownedAttribute);
            ensureType(structure, ownedAttribute, "attribute");
          }
        }
        continue;
      }

      const extensionMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/.exec(normalized);
      if (!extensionMatch) continue;

      const [, typeLabel, capabilityText] = extensionMatch;
      for (const token of splitCapabilities(capabilityText)) {
        const ownedAttribute = parseOwnsToken(token);
        if (ownedAttribute) {
          structure.ownsEdges.add(`${typeLabel}::${ownedAttribute}`);
          structure.attributes.add(ownedAttribute);
          ensureType(structure, ownedAttribute, "attribute");
          continue;
        }

        const playedRole = parsePlaysToken(token);
        if (playedRole) {
          structure.playsEdges.add(`${typeLabel}::${playedRole}`);
          continue;
        }

        const relatedRole = parseRelatesToken(token);
        if (relatedRole) {
          ensureType(structure, typeLabel, "relation");
          structure.relatesEdges.add(`${typeLabel}::${relatedRole}`);
        }
      }
    }
  }

  return normalizeStructure(structure);
}

function renderRoleResourceBlock({ resource, repoUrl, moduleKey, variable }) {
  const docKey = `${repoUrl}#${resource.typeLabel}`;
  return [
    `put ${variable} isa SchemaResource,`,
    `  has docKey ${tqlString(docKey)},`,
    `  has iri ${tqlString(docKey)},`,
    `  has typeLabel ${tqlString(resource.typeLabel)},`,
    `  has kind "role",`,
    `  has roleName ${tqlString(resource.roleName)},`,
    `  has prefLabel ${tqlString(resource.roleName)},`,
    `  has definition ${tqlString(`Role '${resource.roleName}' in relation '${resource.relationLabel}'.`)};`,
    "match",
    `  $schema_module isa SchemaModule, has moduleKey ${tqlString(moduleKey)};`,
    `  $schema_resource isa SchemaResource, has docKey ${tqlString(docKey)};`,
    "  not {",
    "    (resource: $schema_resource, module: $schema_module) isa inModule;",
    "  };",
    "insert",
    "  (resource: $schema_resource, module: $schema_module) isa inModule;",
  ].join("\n");
}

function renderEdgeBlock({ leftLabel, rightLabel, relationLabel, leftRoleLabel, rightRoleLabel }) {
  return [
    "match",
    `  $struct_left isa SchemaResource, has typeLabel ${tqlString(leftLabel)};`,
    `  $struct_right isa SchemaResource, has typeLabel ${tqlString(rightLabel)};`,
    "  not {",
    `    (${leftRoleLabel}: $struct_left, ${rightRoleLabel}: $struct_right) isa ${relationLabel};`,
    "  };",
    "insert",
    `  (${leftRoleLabel}: $struct_left, ${rightRoleLabel}: $struct_right) isa ${relationLabel};`,
  ].join("\n");
}

function renderAttributeValueTypeBlock({ attributeLabel, valueTypeName }) {
  return [
    "match",
    `  $schema_resource isa SchemaResource, has typeLabel ${tqlString(attributeLabel)};`,
    "  not {",
    `    $schema_resource has valueTypeName ${tqlString(valueTypeName)};`,
    "  };",
    "insert",
    `  $schema_resource has valueTypeName ${tqlString(valueTypeName)};`,
  ].join("\n");
}

function renderStructuralMetadataSection({ repoUrl, moduleKey, structure }) {
  const blocks = [
    GENERATED_SECTION_START,
    "# Generated from authoritative schema definitions. Do not hand-edit this section.",
    "",
  ];

  structure.roleResources.forEach((resource, index) => {
    blocks.push(renderRoleResourceBlock({
      resource,
      repoUrl,
      moduleKey,
      variable: `$generated_role_${index + 1}`,
    }));
    blocks.push("");
  });

  structure.attributeResources
    .filter((resource) => resource.valueTypeName)
    .forEach((resource) => {
      blocks.push(renderAttributeValueTypeBlock({
        attributeLabel: resource.typeLabel,
        valueTypeName: resource.valueTypeName,
      }));
      blocks.push("");
    });

  structure.subtypeEdges.forEach((edge) => {
    blocks.push(renderEdgeBlock({
      leftLabel: edge.subtype,
      rightLabel: edge.supertype,
      relationLabel: "schemaSubTypeOf",
      leftRoleLabel: "subtypeResource",
      rightRoleLabel: "supertypeResource",
    }));
    blocks.push("");
  });

  structure.ownsEdges.forEach((edge) => {
    blocks.push(renderEdgeBlock({
      leftLabel: edge.owner,
      rightLabel: edge.attribute,
      relationLabel: "schemaOwns",
      leftRoleLabel: "ownerResource",
      rightRoleLabel: "attributeResource",
    }));
    blocks.push("");
  });

  structure.playsEdges.forEach((edge) => {
    blocks.push(renderEdgeBlock({
      leftLabel: edge.player,
      rightLabel: edge.role,
      relationLabel: "schemaPlays",
      leftRoleLabel: "playerResource",
      rightRoleLabel: "roleResource",
    }));
    blocks.push("");
  });

  structure.relatesEdges.forEach((edge) => {
    blocks.push(renderEdgeBlock({
      leftLabel: edge.relationLabel,
      rightLabel: edge.roleTypeLabel,
      relationLabel: "schemaRelates",
      leftRoleLabel: "relationResource",
      rightRoleLabel: "roleResource",
    }));
    blocks.push("");
  });

  blocks.push(GENERATED_SECTION_END);
  return blocks.join("\n").trimEnd();
}

function replaceGeneratedStructuralSection(text, generatedSection) {
  const pattern = new RegExp(
    `${GENERATED_SECTION_START}[\\s\\S]*?${GENERATED_SECTION_END}\\s*`,
    "m"
  );
  const withoutGenerated = text.replace(pattern, "").trimEnd();
  const suffix = generatedSection?.trim() ? `\n\n${generatedSection.trim()}\n` : "\n";
  return `${withoutGenerated}${suffix}`;
}

export {
  GENERATED_SECTION_END,
  GENERATED_SECTION_START,
  parseTypeQLSchemaStructure,
  renderStructuralMetadataSection,
  replaceGeneratedStructuralSection,
  roleTypeLabel,
  tqlString,
};
