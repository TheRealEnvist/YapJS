'use strict';
function objectOptions(value, allowed, label = 'options') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`Unsupported ${label} field: ${key}`);
  return value;
}
function text(value, label, { max, empty = false, nullable = false, trim = true } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string${nullable ? ' or null' : ''}.`);
  const result = trim ? value.trim() : value;
  if (!empty && !result) throw new TypeError(`${label} cannot be empty.`);
  if (max !== undefined && result.length > max) throw new RangeError(`${label} cannot exceed ${max} characters.`);
  return result;
}
function channelName(value, type = 'text') {
  const input = text(value, 'Channel name');
  const name = type === 'voice' ? input.replace(/\s+/g, ' ') : input.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-\p{Extended_Pictographic}\u200d\ufe0f]/gu, '');
  if (!name) throw new TypeError('Channel name cannot be empty after normalization.');
  if (name.length > 100) throw new RangeError('Channel name cannot exceed 100 characters.');
  return name;
}
function boolean(value, label) { if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`); return value; }
module.exports = { objectOptions, text, channelName, boolean };
