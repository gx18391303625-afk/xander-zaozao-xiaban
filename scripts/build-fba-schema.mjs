// Usage: node scripts/build-fba-schema.mjs /path/to/fulfillmentInbound_2024-03-20.json
// Regenerate only from the reviewed official bytes; schema upgrades need review.
import fs from 'node:fs';
import crypto from 'node:crypto';

const source = fs.readFileSync(process.argv[2]);
const sha256 = 'a4d4cdd08dd3f381f27154d7f9f503d45e0486d416c629598341bbd23c7ff487';
if (crypto.createHash('sha256').update(source).digest('hex') !== sha256) throw new Error('Expected the pinned Amazon Fulfillment Inbound model; review schema changes before updating its digest.');
const model = JSON.parse(source);
const commit = '6ff4ad1fddb377a8febd5a8a300575703d6ca93e';
const wanted = [
  'createInboundPlan', 'generatePackingOptions', 'confirmPackingOption', 'setPackingInformation',
  'generatePlacementOptions', 'confirmPlacementOption', 'generateTransportationOptions',
  'confirmTransportationOptions', 'generateDeliveryWindowOptions', 'confirmDeliveryWindowOptions',
  'updateShipmentTrackingDetails',
];
const actions = {};
for (const [path, methods] of Object.entries(model.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!wanted.includes(operation.operationId)) continue;
    const body = (operation.parameters || []).find((parameter) => parameter.in === 'body');
    if (body && (!body.required || !body.schema?.$ref)) throw new Error(`Unreviewed body contract: ${operation.operationId}`);
    actions[operation.operationId] = {
      method: method.toUpperCase(), path, bodyType: body ? body.schema.$ref.replace('#/definitions/', '') : null,
      operation: operation.operationId,
    };
  }
}
if (Object.keys(actions).length !== wanted.length) throw new Error('Missing or duplicate FBA action definitions.');

const constraints = ['type', 'required', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'format'];
function shape(schema) {
  if (schema.$ref) return { $ref: schema.$ref.replace('#/definitions/', '') };
  for (const key of ['allOf', 'anyOf', 'oneOf', 'additionalProperties', 'nullable', 'x-nullable']) {
    if (Object.hasOwn(schema, key)) throw new Error(`Unreviewed schema construct: ${key}`);
  }
  const out = Object.fromEntries(constraints.filter((key) => Object.hasOwn(schema, key)).map((key) => [key, schema[key]]));
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, shape(value)]));
  if (schema.items) out.items = shape(schema.items);
  return out;
}
const definitions = Object.fromEntries(Object.keys(model.definitions).sort().map((name) => [name, shape(model.definitions[name])]));
const metadata = { version: '2024-03-20', commit, sha256, blobSha: 'ca5a93436969e7e948e684c7f6953d608f40ad8e',
  url: `https://github.com/amzn/selling-partner-api-models/blob/${commit}/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json` };
const header = '// Generated from the pinned Amazon Fulfillment Inbound OpenAPI model. Do not edit by hand.\n'
  + '// Derived from the Apache-2.0 model; see docs/licenses/amazon-sp-api-models.txt.\n'
  + '// Rebuild with scripts/build-fba-schema.mjs. Business/account eligibility remains Amazon\'s responsibility.\n';
const output = header
  + `export const FBA_SCHEMA_SOURCE = ${JSON.stringify(metadata, null, 2)};\n`
  + `export const FBA_ACTION_DATA = ${JSON.stringify(Object.fromEntries(wanted.map((name) => [name, actions[name]])), null, 2)};\n`
  + 'export const FBA_DEFINITIONS = {\n'
  + Object.entries(definitions).map(([name, schema]) => `  ${JSON.stringify(name)}: ${JSON.stringify(schema)},`).join('\n') + '\n};\n';
fs.writeFileSync(new URL('../lib/fba-inbound-schema-data.js', import.meta.url), output);
console.log(`Generated ${Object.keys(actions).length} FBA actions and ${Object.keys(definitions).length} definitions.`);
