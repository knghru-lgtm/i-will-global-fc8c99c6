#!/usr/bin/env node
// Offline check for a customer waypoint definition against the agent's member
// list from GET /v2/analytics/agents/<agent>/pathway/definition. It applies the
// same rules the API applies on PUT/POST so most 422 loops never reach the API.
// It is not the API: a clean result still needs the live write.
//
// Usage: node validate-definition.cjs <definition.json> <members.json>
//   definition.json: { "definition": { "groups": [...] } } or { "groups": [...] }
//   members.json:    the definition read's data (or its `members` array)
'use strict';
const {readFileSync} = require('node:fs');

const MAX_GROUPS = 7;
const GROUP_KEYS = new Set(['id', 'label', 'members', 'stage']);
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 512;
const EXCLUDED = new Set(['__entry__', 'global-prompt']);
const SYNTHETIC = new Set(['__start', '__initialization']);
const RESERVED_GROUP_ID = '__unclassified__';
const DEFINITION_REF = '#definition';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

function memberIds(members) {
  const list = Array.isArray(members) ? members : object(members) && Array.isArray(members.members) ? members.members : object(members) && object(members.data) ? members.data.members : null;
  if (!Array.isArray(list)) throw new Error('members: expected an array, a definition read, or its data');
  return new Set(list.map(entry => (typeof entry === 'string' ? entry : object(entry) ? entry.id : undefined)).filter(text));
}

function groupsOf(definition) {
  const inner = object(definition) && object(definition.definition) ? definition.definition : definition;
  return object(inner) && Array.isArray(inner.groups) ? inner.groups : null;
}

function validateDefinition(definition, members) {
  const known = memberIds(members);
  const groups = groupsOf(definition);
  const violations = [];
  const violate = (rule, id, message) => violations.push({rule, id, message});
  if (!groups || groups.length === 0) {
    violate('no_groups', DEFINITION_REF, 'the definition has no groups');
    return {valid: false, violations, unclassified: [...known]};
  }
  const inner = object(definition) && object(definition.definition) ? definition.definition : definition;
  for (const key of Object.keys(inner)) if (key !== 'groups') violate('unknown_key', DEFINITION_REF, `${key} is not a definition field; the API refuses unknown keys with 400`);
  if (groups.length > MAX_GROUPS) violate('too_many_groups', DEFINITION_REF, `the definition has ${groups.length} groups; at most ${MAX_GROUPS} are allowed`);
  const seenGroups = new Set();
  const seenMembers = new Set();
  const staged = groups.filter(g => object(g) && g.stage !== undefined);
  let real = false;
  groups.forEach((group, index) => {
    const ref = object(group) && text(group.id) ? group.id.trim() : `#${index}`;
    if (object(group)) for (const key of Object.keys(group)) if (!GROUP_KEYS.has(key)) violate('unknown_key', ref, `${key} is not a group field; the API refuses unknown keys with 400`);
    if (!object(group) || !text(group.id)) violate('missing_group_id', ref, 'a group id is empty');
    else if (group.id.length > MAX_ID_LENGTH) violate('missing_group_id', ref, `a group id must be at most ${MAX_ID_LENGTH} characters`);
    else if (group.id === RESERVED_GROUP_ID) violate('reserved_group_id', ref, `${RESERVED_GROUP_ID} is derived at read time and cannot be a group id`);
    else if (seenGroups.has(group.id)) violate('duplicate_group_id', ref, `group id ${group.id} is used more than once`);
    seenGroups.add(object(group) ? group.id : ref);
    if (!object(group) || !text(group.label) || group.label.length > MAX_LABEL_LENGTH) violate('missing_label', ref, `a group label must be a non-blank string of at most ${MAX_LABEL_LENGTH} characters`);
    if (staged.length > 0 && object(group) && group.stage === undefined) violate('stage_missing', ref, 'some groups have a stage and this one does not');
    if (object(group) && group.stage !== undefined && (!Number.isInteger(group.stage) || group.stage < 1)) violate('stage_invalid', ref, 'stage must be an integer of 1 or more');
    const list = object(group) && Array.isArray(group.members) ? group.members : [];
    if (list.length === 0) violate('empty_group', ref, 'a group has no members');
    if (list.length > 256) violate('too_many_members', ref, 'a group may name at most 256 members');
    for (const member of list) {
      if (!text(member)) { violate('unknown_member', String(member), 'a member id must be a non-empty string'); continue; }
      if (EXCLUDED.has(member)) { violate('excluded_member', member, `${member} is never stored in a definition`); continue; }
      if (SYNTHETIC.has(member)) { violate('synthetic_member', member, `${member} is placed automatically and cannot be grouped`); continue; }
      if (!known.has(member)) { violate('unknown_member', member, `${member} is not in the compiled waypoint list`); continue; }
      if (seenMembers.has(member)) { violate('duplicate_member', member, `${member} appears more than once; a member belongs to exactly one group`); continue; }
      seenMembers.add(member);
      real = true;
    }
  });
  if (!real) violate('no_real_members', DEFINITION_REF, 'the definition names no node, tool or authored hub of the compiled list');
  if (staged.length === groups.length && staged.length > 0) {
    const stages = [...new Set(staged.map(g => g.stage).filter(Number.isInteger))].sort((a, b) => a - b);
    if (stages.length && (stages[0] !== 1 || stages.some((s, i) => s !== i + 1))) violate('stage_not_dense', DEFINITION_REF, 'stages in use must be 1..N with no gap');
  }
  const unclassified = [...known].filter(id => !seenMembers.has(id));
  return {valid: violations.length === 0, violations, unclassified};
}

module.exports = {validateDefinition, MAX_GROUPS};

if (require.main === module) {
  const [definitionPath, membersPath] = process.argv.slice(2);
  if (!definitionPath || !membersPath) {
    console.error('Usage: node validate-definition.cjs <definition.json> <members.json>');
    process.exit(2);
  }
  const result = validateDefinition(JSON.parse(readFileSync(definitionPath, 'utf8')), JSON.parse(readFileSync(membersPath, 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}
