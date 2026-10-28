import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addExclusion, addRuleField, blankRule, canonicalAutomationSelector, removeRuleField, ruleDirty, ruleError, ruleValue, setRuleItem, toggleRuleOperator } from '../src/automation-rule.ts';

test('separate prompt preserves nested Include And and Exclude operators without changing input', () => {
  const initial = blankRule('rule');
  let rule = addRuleField(addRuleField(initial, 'from'), 'subject');
  assert.equal(rule.groups[0].queryOperator, 'or');
  rule = toggleRuleOperator(rule, 0);
  rule = addRuleField(rule, 'prompt');
  rule = addRuleField(addExclusion(rule), 'to', 1);
  assert.deepEqual(rule.groups.map(group => [group.operator, group.queryOperator]), [['and', 'and'], ['exclude', 'or']]);
  assert.equal(rule.prompt, '');
  assert.equal(initial.groups.length, 0);
  assert.equal(addRuleField(rule, 'prompt', 1).prompt, '');
  rule = toggleRuleOperator(rule, 1);
  assert.equal(rule.groups[1].operator, 'exclude');
  assert.equal(rule.groups[1].queryOperator, 'and');
});

test('local selectors reject unresolved names and preserve numeric and IDNA domain identity', () => {
  for (const raw of ['Jordan', 'localhost', 'a@b.test/path', 'a@b.test:80', 'a@@b.test', 'ＦＯＯ＠example.test', 'a\u0000@b.test', 'a'.repeat(1025)]) assert.equal(canonicalAutomationSelector(raw), undefined, raw);
  assert.equal(canonicalAutomationSelector('PERSON@BÜCHER.example'), 'person@xn--bcher-kva.example');
  assert.equal(canonicalAutomationSelector('bücher。12.34'), 'xn--bcher-kva.12.34');
  assert.equal(canonicalAutomationSelector('12.34'), '12.34');
  assert.equal(canonicalAutomationSelector('person@01.2.3.4'), 'person@01.2.3.4');
  assert.equal(canonicalAutomationSelector('person@localhost'), 'person@localhost');
});

test('multiple From uses declared Or constraint while unrelated fields remain intact', () => {
  let rule = toggleRuleOperator(addRuleField(addRuleField(blankRule('r'), 'from'), 'subject'), 0);
  rule = setRuleItem(rule, 0, 1, 'Owned subject');
  rule = addRuleField(rule, 'from');
  assert.equal(rule.groups[0].operator, 'or');
  assert.equal(rule.groups[0].queryOperator, 'or');
  assert.equal(toggleRuleOperator(rule, 0).groups[0].queryOperator, 'or');
  assert.equal(rule.groups[0].items[1].value, 'Owned subject');
});

test('blank local rows cancel cleanly but literal user text remains dirty and validation never erases it', () => {
  let rule = addRuleField(addExclusion(addRuleField(blankRule('r'), 'subject')), 'to', 1);
  assert.equal(ruleDirty(rule, null), false);
  rule = { ...rule, name: '  Owned rule  ' };
  assert.ok(ruleError(rule, []));
  assert.equal(rule.name, '  Owned rule  ');
  rule = setRuleItem(rule, 0, 0, '  project  ');
  rule = removeRuleField(rule, 1, 0);
  assert.equal(ruleError(rule, []), '');
  assert.equal(ruleValue(rule).groups[0].items[0].value, 'project');
  assert.equal(rule.name, '  Owned rule  ');
  assert.equal(ruleDirty(rule, null), true);
  assert.ok(ruleError({ ...rule, prompt: '' }, []));
  assert.ok(ruleError({ ...rule, prompt: 'x'.repeat(1001) }, []));
  assert.ok(ruleError(rule, [{ ...ruleValue(rule), id: 'other', name: 'owned RULE' }]));
});
