import { FBA_ACTION_DATA, FBA_DEFINITIONS, FBA_SCHEMA_SOURCE } from './fba-inbound-schema-data.js';

export { FBA_SCHEMA_SOURCE };
export const FBA_ACTIONS = Object.freeze(Object.fromEntries(Object.entries(FBA_ACTION_DATA)
  .map(([name, descriptor]) => [name, Object.freeze({ ...descriptor })])));

const own = (object, key) => Object.hasOwn(object, key);
const datePattern = '^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$';
const patterns = new Map();
const minuteWindows = new Set([
  'WindowInput.start', 'DeliveryWindowOption.startDate', 'DeliveryWindowOption.endDate', 'DeliveryWindowOption.validUntil',
  'SelectedDeliveryWindow.startDate', 'SelectedDeliveryWindow.endDate', 'SelectedDeliveryWindow.editableUntil',
  'Window.start', 'Window.end', 'Window.editableUntil',
]);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (path, reason) => { throw new Error(`FBA ${path}: ${reason}`); };

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function validDateTime(value, minutePrecision) {
  // The official readiness/delivery windows also allow ISO minute precision;
  // retain it for the selected/readback projections of those same windows.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59
    || (match[4] === undefined ? !minutePrecision : Number(match[4]) > 59)) return false;
  return match[6].toUpperCase() === 'Z' || (Number(match[6].slice(1, 3)) <= 23 && Number(match[6].slice(4, 6)) <= 59);
}

function validate(schema, value, path, context, typeName) {
  if (schema.$ref) {
    if (!own(FBA_DEFINITIONS, schema.$ref)) fail(path, 'unknown schema reference');
    return validate(FBA_DEFINITIONS[schema.$ref], value, path, context, schema.$ref);
  }
  if (schema.type === 'object') {
    if (!plainObject(value)) fail(path, 'expected an object');
    if (context.active.has(value)) fail(path, 'cyclic data is not JSON');
    context.active.add(value);
    try {
      for (const key of schema.required || []) {
        // Amazon now deprecates this response field in favor of supportedConfigurations.
        // Its presence is optional only for explicit response compatibility validation.
        if (context.allowUnknown && typeName === 'PackingOption' && key === 'supportedShippingConfigurations') continue;
        if (!own(value, key)) fail(`${path}.${key}`, 'required field is missing');
      }
      for (const key of Object.keys(value)) {
        if (!own(schema.properties || {}, key)) {
          if (!context.allowUnknown) fail(`${path}.${key}`, 'unknown field');
          continue;
        }
        const property = schema.properties[key];
        validate(property, value[key], `${path}.${key}`, context, typeName ? `${typeName}.${key}` : undefined);
      }
    } finally { context.active.delete(value); }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(path, 'expected an array');
    if (context.active.has(value)) fail(path, 'cyclic data is not JSON');
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(path, `requires at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(path, `allows at most ${schema.maxItems} items`);
    context.active.add(value);
    try {
      for (let index = 0; index < value.length; index++) {
        if (!own(value, index)) fail(`${path}[${index}]`, 'array holes are not valid values');
        validate(schema.items, value[index], `${path}[${index}]`, context);
      }
      if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) fail(path, 'duplicate array items');
    } finally { context.active.delete(value); }
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail(path, 'expected a string');
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail(path, `minimum length is ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength) fail(path, `maximum length is ${schema.maxLength}`);
    if (schema.pattern) {
      if (!patterns.has(schema.pattern)) patterns.set(schema.pattern, new RegExp(schema.pattern));
      const match = patterns.get(schema.pattern).exec(value);
      // JavaScript's $ also matches before a final newline; an anchored API ID
      // pattern must cover the actual complete input, including trailing bytes.
      if (!match || (schema.pattern.startsWith('^') && schema.pattern.endsWith('$') && match[0] !== value)) fail(path, 'does not match the required pattern');
    }
    if ((schema.format === 'date' || schema.pattern === datePattern) && !validDate(value)) fail(path, 'invalid calendar date');
    if (schema.format === 'date-time' && !validDateTime(value, minuteWindows.has(typeName))) fail(path, 'invalid ISO date-time with timezone');
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)
      || (schema.type === 'integer' && !Number.isSafeInteger(value))) fail(path, `expected a finite ${schema.type}`);
    if (schema.minimum !== undefined && (schema.exclusiveMinimum ? value <= schema.minimum : value < schema.minimum)) fail(path, `minimum is ${schema.minimum}`);
    if (schema.maximum !== undefined && (schema.exclusiveMaximum ? value >= schema.maximum : value > schema.maximum)) fail(path, `maximum is ${schema.maximum}`);
    if (schema.multipleOf !== undefined && !Number.isInteger(value / schema.multipleOf)) fail(path, `must be a multiple of ${schema.multipleOf}`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  } else fail(path, 'unsupported schema type');
  if (schema.enum && !schema.enum.includes(value)) fail(path, `expected one of ${schema.enum.join(', ')}`);
}

export function validateFbaType(name, value, { allowUnknown = false } = {}) {
  if (typeof name !== 'string' || !own(FBA_DEFINITIONS, name)) fail(String(name), 'unknown type');
  if (typeof allowUnknown !== 'boolean') fail(name, 'allowUnknown must be a boolean');
  validate(FBA_DEFINITIONS[name], value, name, { allowUnknown, active: new WeakSet() }, name);
  return value;
}

export function validateFbaBody(action, body) {
  if (typeof action !== 'string' || !own(FBA_ACTIONS, action)) fail(String(action), 'unknown action');
  const { bodyType } = FBA_ACTIONS[action];
  if (bodyType === null) {
    if (body !== undefined) fail(action, 'this operation does not accept a request body');
    return body;
  }
  return validateFbaType(bodyType, body);
}

export function fbaId(value, name, { min = 38, max = 38 } = {}) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) fail(name || 'ID', 'invalid ID length bounds');
  if (typeof value !== 'string' || value.length < min || value.length > max || /[^a-zA-Z0-9-]/.test(value)) {
    fail(name || 'ID', `expected an alphanumeric/dash string of length ${min === max ? min : `${min}–${max}`}`);
  }
  return value;
}
