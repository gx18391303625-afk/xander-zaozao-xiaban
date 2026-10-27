// Rebuild the navigation-only type graph from the pinned Amazon OpenAPI model.
// Usage: node scripts/build-aplus-schema.mjs /path/to/aplusContent_2020-11-01.json
import fs from 'node:fs';
import crypto from 'node:crypto';
const source = fs.readFileSync(process.argv[2]);
const digest = '4809c630a9329c1f844a5ddda604dada97c7eeb3bde73ccb54a48fe72fbb47de';
if (crypto.createHash('sha256').update(source).digest('hex') !== digest) throw new Error('Expected the pinned A+ model; review schema changes before updating this digest.');
const definitions = JSON.parse(source).definitions;
const graph = {};
function shape(schema) {
  if (schema.$ref) {
    const name = schema.$ref.replace('#/definitions/', '');
    visit(name);
    return name;
  }
  return {
    type: schema.type,
    ...(schema.required ? { required: schema.required } : {}),
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, shape(value)])) } : {}),
    ...(schema.items ? { items: shape(schema.items) } : {}),
  };
}
function visit(name) {
  if (Object.hasOwn(graph, name)) return;
  graph[name] = null;
  graph[name] = shape(definitions[name]);
}
visit('ContentDocument');
const header = '// Generated navigation metadata, not a replacement for Amazon validation.\n'
  + '// Source: amzn/selling-partner-api-models @ 7dcc8e9616e51d637f2065452b357655b623f880\n'
  + '// models/aplus-content-api-model/aplusContent_2020-11-01.json\n'
  + '// Derived from the Apache-2.0 model; see docs/licenses/amazon-sp-api-models.txt.\n'
  + '// Rebuild with scripts/build-aplus-schema.mjs. Do not edit by hand.\n';
fs.writeFileSync(new URL('../lib/aplus-schema-types.js', import.meta.url), header + 'export const APLUS_TYPES = {\n'
  + Object.keys(graph).sort().map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(graph[name])},`).join('\n') + '\n};\n');
console.log(`Generated ${Object.keys(graph).length} reachable A+ types.`);
