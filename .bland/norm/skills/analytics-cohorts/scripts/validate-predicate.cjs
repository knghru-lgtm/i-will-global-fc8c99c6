#!/usr/bin/env node
// Offline check for a cohort column predicate (the `predicate.where` of
// POST /v2/analytics/cohorts). It applies the rules the API applies to the
// same value, against a copy of the table allowlist (trusted-layer.json, keyed
// by table name; `available: false` marks a table the API refuses for now), and
// reports each refusal with the same path and message the API answers with.
// The copy lists the tables and columns meant for customer predicates; the API
// may accept a few more, which this check refuses as unknown (fail closed).
// It is not the API: a clean result still needs the live request, and the
// API stays the authority whenever its allowlist moves ahead of this copy.
//
// Usage: node validate-predicate.cjs <predicate.json>
//   predicate.json: a whole cohort request body, { "predicate": { ... } },
//   { "where": ... }, or the bare `where` node. A request or predicate with
//   no `where`, and a bare `{}`, mean "no where": valid, light, 0 leaves
//   (`where` is optional; an empty predicate is every call in the window).
// Prints { valid, cost_class, leaves, violations: [{ path, message }] } and
// exits 1 when the predicate is refused, 2 on a usage or read error.
'use strict';
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const TABLES = JSON.parse(readFileSync(join(__dirname, 'trusted-layer.json'), 'utf8'));

const MAX_DEPTH = 8;
const MAX_LEAVES = 64;
const MAX_IN_VALUES = 200;

const OUTCOMES = Object.freeze([
  'contained',
  'escalated_cold',
  'escalated_warm',
  'ai_abandoned',
  'abandoned',
  'agent_ended',
  'voicemail',
  'not_connected',
  'errored',
]);

const OPS = Object.freeze(['=', '!=', 'in', 'not_in', '<', '<=', '>', '>=', 'is_null', 'is_not_null', 'contains']);
const ORDERED_OPS = ['<', '<=', '>', '>='];
const NULL_OPS = ['is_null', 'is_not_null'];
const LIST_OPS = ['in', 'not_in'];

// Columns computed from a call rather than stored on it. Bare names only.
const VIRTUAL_COLUMNS = Object.freeze({outcome: 'outcome', connected: 'predicate', early_exit: 'predicate'});

// The ops each column kind takes.
const OPS_BY_KIND = Object.freeze({
  string: OPS,
  number: OPS.filter(op => op !== 'contains'),
  boolean: ['=', '!=', ...NULL_OPS],
  timestamp: ['=', '!=', ...ORDERED_OPS, ...NULL_OPS],
  timestamp_ntz: ['=', '!=', ...ORDERED_OPS, ...NULL_OPS],
  date: ['=', '!=', ...ORDERED_OPS, ...NULL_OPS],
  complex: NULL_OPS,
  outcome: ['=', '!=', ...LIST_OPS],
  predicate: ['=', '!='],
});

const TIMESTAMP_HINT = 'an ISO-8601 instant with a zone and at most millisecond precision';
const VALUE_HINT = Object.freeze({
  string: 'a string',
  outcome: `one of ${OUTCOMES.join(', ')}`,
  number: 'a finite number',
  boolean: 'a boolean',
  predicate: 'a boolean',
  timestamp: TIMESTAMP_HINT,
  timestamp_ntz: TIMESTAMP_HINT,
  date: 'a YYYY-MM-DD day',
  complex: 'nothing',
});

const NUMERIC_TYPE = /^(tinyint|smallint|int|integer|bigint|float|double|decimal(\(\d+,\s*\d+\))?)$/;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// A stored column type, as the predicate's type class.
function columnKind(storedType) {
  if (storedType === 'string') return 'string';
  if (storedType === 'boolean') return 'boolean';
  if (storedType === 'timestamp') return 'timestamp';
  if (storedType === 'timestamp_ntz') return 'timestamp_ntz';
  if (storedType === 'date') return 'date';
  if (NUMERIC_TYPE.test(storedType)) return 'number';
  return 'complex';
}

// ---- calendar and instant checks -------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// The regex alone accepts 2026-02-30, and Date overflows it into March rather
// than rejecting it, so round-trip the parsed day and require the same text.
function isRealCalendarDay(stamp) {
  const parsed = new Date(`${stamp}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === stamp;
}

// An ISO-8601 instant with a Z or a numeric offset: a leap-year-aware date,
// hours and minutes, optional seconds with any fraction. The same shape the
// API's request schema accepts for an instant.
const DATE_SOURCE = '((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))';
const INSTANT_RE = new RegExp(`^${DATE_SOURCE}T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|([+-]\\d{2}:?\\d{2}))$`);

function isIsoInstant(value) {
  return typeof value === 'string'
    && INSTANT_RE.test(value)
    && !Number.isNaN(new Date(value).getTime())
    && isRealCalendarDay(value.slice(0, 10));
}

const TIMESTAMP_FRACTION_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(\d+)/;
const TIMESTAMP_ZONE_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

// The named precision or zone rule a timestamp literal breaks, or null. The
// API writes the instant in UTC at millisecond precision, so a fourth
// fractional digit would be dropped and a zone-less value read in an
// unknown zone; both are refused. Values not shaped like a timestamp at all
// fall through to the generic hint.
function timestampLiteralBreach(value, kind) {
  if (kind !== 'timestamp' && kind !== 'timestamp_ntz') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const match = TIMESTAMP_FRACTION_RE.exec(value);
  if (match && match[1].length > 3) return 'timestamp precision beyond milliseconds is not supported';
  if (!TIMESTAMP_ZONE_RE.test(value)) return 'timestamp needs an explicit zone';
  return null;
}

function valueFitsKind(value, kind) {
  switch (kind) {
    case 'string': return typeof value === 'string';
    case 'outcome': return typeof value === 'string' && OUTCOMES.includes(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
    case 'predicate': return typeof value === 'boolean';
    case 'timestamp':
    case 'timestamp_ntz': return typeof value === 'string' && timestampLiteralBreach(value, kind) === null && isIsoInstant(value);
    case 'date': return typeof value === 'string' && DAY_RE.test(value) && isRealCalendarDay(value);
    default: return false;
  }
}

// ---- column resolution -----------------------------------------------------

function findTable(table) {
  return hasOwn(TABLES, table) ? TABLES[table] : null;
}

// Resolve a leaf's `col`: "<column>" against calls (or a virtual column),
// "<table>.<column>" against that allowlisted table. Returns
// { table, column, kind, virtual, entry } or { error }.
function resolveColumn(col) {
  if (typeof col !== 'string' || col === '') return {error: 'must be a column name'};
  const parts = col.split('.');
  if (parts.length > 2 || parts.some(part => part === '')) {
    return {error: `${col} must be <column> or <table>.<column>`};
  }
  if (parts.length === 1 && hasOwn(VIRTUAL_COLUMNS, col)) {
    const calls = findTable('calls');
    if (!calls) return {error: 'calls is not allowlisted'};
    return {table: 'calls', column: col, kind: VIRTUAL_COLUMNS[col], virtual: col, entry: calls};
  }
  const [table, column] = parts.length === 2 ? parts : ['calls', parts[0]];
  const entry = findTable(table);
  if (!entry) return {error: `unknown or unallowlisted table: ${table}`};
  if (entry.available === false) {
    return {error: `table not available (not yet in the lake in any region): ${table}`};
  }
  if (!hasOwn(entry.columns, column)) return {error: `unknown column: ${table}.${column}`};
  if (entry.deny.includes(column)) {
    return {error: `denied column (may not be used in a predicate): ${table}.${column}`};
  }
  return {table, column, kind: columnKind(entry.columns[column]), virtual: null, entry};
}

// ---- the walk ----------------------------------------------------------------

// Every refusal for a raw `where` value plus the leaves counted, each refusal
// naming its node. The walk stops counting (and refusing) once it passes the
// leaf cap, exactly as the API does.
function analyzePredicate(raw, root = 'where') {
  const violations = [];
  let leaves = 0;
  const walk = (node, path, depth) => {
    if (leaves > MAX_LEAVES) return;
    if (depth > MAX_DEPTH) {
      violations.push({path, message: `nesting exceeds the maximum depth of ${MAX_DEPTH}`});
      return;
    }
    if (!isPlainObject(node)) {
      violations.push({path, message: 'must be an object'});
      return;
    }
    const keys = Object.keys(node);
    const group = keys.length === 1 ? keys[0] : null;
    if (group === 'and' || group === 'or') {
      const children = node[group];
      if (!Array.isArray(children) || children.length === 0) {
        violations.push({path: `${path}.${group}`, message: 'must be a non-empty array'});
        return;
      }
      children.forEach((child, i) => walk(child, `${path}.${group}[${i}]`, depth + 1));
      return;
    }
    if (group === 'not') {
      walk(node.not, `${path}.not`, depth + 1);
      return;
    }
    leaves += 1;
    if (leaves > MAX_LEAVES) {
      violations.push({path: root, message: `more than ${MAX_LEAVES} leaves`});
      return;
    }
    const unknownKey = keys.find(key => key !== 'col' && key !== 'op' && key !== 'value');
    if (unknownKey !== undefined) {
      violations.push({path: `${path}.${unknownKey}`, message: 'unknown key; a node is { and } | { or } | { not } | { col, op, value? }'});
      return;
    }
    const {col, op, value} = node;
    if (typeof col !== 'string' || col === '') {
      violations.push({path: `${path}.col`, message: 'must be a column name'});
      return;
    }
    const resolved = resolveColumn(col);
    if (resolved.error) {
      violations.push({path: `${path}.col`, message: resolved.error});
      return;
    }
    if (typeof op !== 'string' || !OPS.includes(op)) {
      violations.push({path: `${path}.op`, message: `must be one of ${OPS.join(', ')}`});
      return;
    }
    if (!OPS_BY_KIND[resolved.kind].includes(op)) {
      violations.push({path: `${path}.op`, message: `"${op}" does not apply to ${col} (${resolved.kind})`});
      return;
    }
    if (NULL_OPS.includes(op)) {
      if (value !== undefined) violations.push({path: `${path}.value`, message: `must be absent for ${op}`});
      return;
    }
    const hint = VALUE_HINT[resolved.kind];
    if (LIST_OPS.includes(op)) {
      if (!Array.isArray(value) || value.length === 0) {
        violations.push({path: `${path}.value`, message: `${op} takes a non-empty array of ${hint}`});
      } else if (value.length > MAX_IN_VALUES) {
        violations.push({path: `${path}.value`, message: `${op} takes at most ${MAX_IN_VALUES} values`});
      } else if (!value.every(v => valueFitsKind(v, resolved.kind))) {
        violations.push({path: `${path}.value`, message: `every element must be ${hint}`});
      }
      return;
    }
    if (!valueFitsKind(value, resolved.kind)) {
      violations.push({path: `${path}.value`, message: timestampLiteralBreach(value, resolved.kind) ?? `must be ${hint}`});
    } else if (op === 'contains' && value === '') {
      violations.push({path: `${path}.value`, message: 'contains takes a non-empty string'});
    }
  };
  walk(raw, root, 1);
  return {violations, leaves};
}

// Every refusal for a raw `where` value; empty when the predicate is valid.
function validatePredicate(raw, root = 'where') {
  return analyzePredicate(raw, root).violations;
}

// "heavy" when any leaf reads a heavy table, else "light". A leaf whose
// column does not resolve, a node that is not a well-formed group, or a node
// deeper than MAX_DEPTH counts as heavy, so an invalid predicate never reads
// as cheap. The depth bound also keeps hostile input from exhausting the stack.
function predicateCostClass(raw) {
  const cost = (node, depth) => {
    if (depth > MAX_DEPTH || !isPlainObject(node)) return 'heavy';
    for (const group of ['and', 'or']) {
      if (hasOwn(node, group)) {
        const children = node[group];
        if (!Array.isArray(children) || children.length === 0) return 'heavy';
        return children.some(child => cost(child, depth + 1) === 'heavy') ? 'heavy' : 'light';
      }
    }
    if (hasOwn(node, 'not')) return cost(node.not, depth + 1);
    const resolved = resolveColumn(node.col);
    return resolved.error ? 'heavy' : resolved.entry.cost;
  };
  return cost(raw, 1);
}

// Keys of a cohort request body and of its `predicate` object. Neither set
// overlaps a predicate node's keys (and, or, not, col, op, value), so a file
// carrying only wrapper keys is a request or a predicate, and a file carrying
// any node key is the bare node itself, whatever else it carries: a node with
// a stray `day` beside its `col` is a malformed node to refuse, not a
// predicate with no `where`.
const REQUEST_KEYS = ['agent_key', 'window', 'predicate'];
const PREDICATE_KEYS = ['metric', 'outcomes', 'hour_utc', 'day', 'waypoint', 'disposition', 'eligible_for_scoring', 'sampling', 'where'];
const NODE_KEYS = ['and', 'or', 'not', 'col', 'op', 'value'];

// Find the `where` node inside whatever the file holds, in this order:
//   1. anything carrying a node key: the bare `where` node itself;
//   2. a whole cohort request (any of REQUEST_KEYS): its `predicate.where`;
//   3. a predicate object (any of PREDICATE_KEYS): its `where`;
//   4. an empty object `{}`: an empty predicate, so no `where`;
//   5. anything else: the bare `where` node itself.
// Returns { where } when there is one to check, { absent: true } when there
// is none (valid: `where` is optional, and an empty predicate means every
// conversation in the window), or { violation } when `predicate` itself is
// not an object. Only this file-level unwrapping treats `{}` as "no where":
// validatePredicate({}) still refuses it, as the API refuses `where: {}`.
function locateWhere(document) {
  if (!isPlainObject(document)) return {where: document};
  const keys = Object.keys(document);
  if (keys.length === 0) return {absent: true};
  if (keys.some(key => NODE_KEYS.includes(key))) return {where: document};
  if (keys.some(key => REQUEST_KEYS.includes(key))) {
    if (!hasOwn(document, 'predicate')) return {absent: true};
    if (!isPlainObject(document.predicate)) return {violation: {path: 'predicate', message: 'must be an object'}};
    return hasOwn(document.predicate, 'where') ? {where: document.predicate.where} : {absent: true};
  }
  if (keys.some(key => PREDICATE_KEYS.includes(key))) {
    return hasOwn(document, 'where') ? {where: document.where} : {absent: true};
  }
  return {where: document};
}

function check(document) {
  const located = locateWhere(document);
  if (located.absent) return {valid: true, cost_class: 'light', leaves: 0, violations: []};
  if (located.violation) return {valid: false, cost_class: 'heavy', leaves: 0, violations: [located.violation]};
  const {violations, leaves} = analyzePredicate(located.where);
  // A refused predicate reports heavy without walking it again.
  if (violations.length > 0) return {valid: false, cost_class: 'heavy', leaves, violations};
  return {valid: true, cost_class: predicateCostClass(located.where), leaves, violations};
}

module.exports = {
  validatePredicate,
  analyzePredicate,
  predicateCostClass,
  resolveColumn,
  columnKind,
  check,
  locateWhere,
  MAX_DEPTH,
  MAX_LEAVES,
  MAX_IN_VALUES,
  OUTCOMES,
  OPS,
  OPS_BY_KIND,
  VALUE_HINT,
  VIRTUAL_COLUMNS,
  TABLES,
};

if (require.main === module) {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error([
      'Usage: node validate-predicate.cjs <predicate.json>',
      '  The file holds a cohort request body, { "predicate": { ... } }, { "where": ... }, or a bare where node.',
      '  No where (a request or predicate without one, or a bare {}) is valid: light, 0 leaves.',
    ].join('\n'));
    process.exit(2);
  }
  let document;
  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`validate-predicate: cannot read ${path}: ${error.message}`);
    process.exit(2);
  }
  const result = check(document);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}
