import { APLUS_TYPES } from './aplus-schema-types.js';
import { canonical } from './jsonfile.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const schemaFor = (type) => typeof type === 'string' ? APLUS_TYPES[type] : type;
const moduleSlots = Object.fromEntries(Object.keys(APLUS_TYPES.ContentModule.properties)
  .filter((key) => key !== 'contentModuleType')
  .map((key) => [key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase(), key]));

function mediaId(value, field) {
  // IDs are opaque: do not invent an Amazon ID format. Reject obvious URL/path
  // substitutes and invalid scalar types; Amazon still validates asset ownership.
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
      || /[\s\p{Cc}]|^[a-z][a-z0-9+.-]*:|^[~/.\\]|^[a-z]:[\\/]/iu.test(value)) {
    throw new Error(`A+ ${field} 需要有效的已上传素材 ID，不能是空白、公开 URL 或本机文件路径。`);
  }
}

// Navigate by the official field type, never infer an image from a crop field.
// Unknown extension fields keep the old conservative media checks and are sent
// unchanged to Amazon's full validation operation.
function visitMedia(value, type) {
  if (value === null) return; // Optional component slots can be null in readback.
  const schema = schemaFor(type);
  if (type === 'ImageComponent' || type === 'VideoComponent') {
    if (!object(value)) throw new Error(`A+ ${type} 必须是素材对象。`);
    if (type === 'ImageComponent') mediaId(value.uploadDestinationId, 'uploadDestinationId');
    else {
      mediaId(value.videoMediaId, 'videoMediaId');
      mediaId(value.imageMediaId, 'imageMediaId');
    }
  } else if (object(value)) {
    if (Object.hasOwn(value, 'uploadDestinationId')) mediaId(value.uploadDestinationId, 'uploadDestinationId');
    if (Object.hasOwn(value, 'imageCropSpecification')) mediaId(value.uploadDestinationId, 'uploadDestinationId');
  }
  if (typeof value !== 'object') return;
  if (object(value) && schema?.type === 'object') {
    for (const key of schema.required || []) {
      if (['ImageComponent', 'VideoComponent'].includes(schema.properties?.[key]) && value[key] == null) {
        throw new Error(`A+ ${key} 缺少必填素材对象及已上传素材 ID。`);
      }
    }
  }
  if (type === 'ContentModule') {
    const selected = moduleSlots[value.contentModuleType];
    if (selected) {
      if (!object(value[selected])) throw new Error(`A+ ${value.contentModuleType} 缺少对应的 ${selected} 模块对象。`);
      for (const key of Object.values(moduleSlots)) {
        if (key !== selected && value[key] != null) throw new Error(`A+ ${value.contentModuleType} 不能同时包含 ${key} 模块内容。`);
      }
    }
  }
  if (Array.isArray(value)) {
    for (const child of value) visitMedia(child, schema?.type === 'array' ? schema.items : undefined);
  } else {
    for (const [key, child] of Object.entries(value)) {
      visitMedia(child, schema?.type === 'object' ? schema.properties?.[key] : undefined);
    }
  }
}

export function validateAplusMedia(value) {
  visitMedia(value, 'ContentDocument');
}

function absentEquivalent(type, key, schema) {
  // Live Premium video readbacks can return crop:null or omit crop although the
  // published schema lists it as required. This narrow compatibility exception
  // does not apply to ImageComponent or to a non-null crop object.
  return (type === 'VideoComponent' && key === 'imageCropSpecification')
    || (Object.hasOwn(schema.properties || {}, key) && !(schema.required || []).includes(key));
}

function equalTyped(a, b, type) {
  const schema = schemaFor(type);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => equalTyped(value, b[index], schema?.type === 'array' ? schema.items : undefined));
  }
  if (object(a) && object(b) && schema?.type === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const inA = Object.hasOwn(a, key), inB = Object.hasOwn(b, key);
      if (!inA || !inB) {
        if (absentEquivalent(type, key, schema) && (inA ? a[key] : b[key]) === null) continue;
        return false;
      }
      if (!equalTyped(a[key], b[key], schema.properties?.[key])) return false;
    }
    return true;
  }
  // Unknown fields, required fields, empty arrays/strings, false and zero retain
  // their exact meaning. Inputs and hash-covered proposal JSON are never edited.
  return canonical(a) === canonical(b);
}

export function aplusDocumentsMatch(actual, expected) {
  try {
    validateAplusMedia(actual);
    validateAplusMedia(expected);
    return equalTyped(actual, expected, 'ContentDocument');
  } catch {
    return false;
  }
}
