import type { AutomationConfiguration, AutomationCriterion, AutomationCriterionGroup, AutomationCustomLabel } from '../../api/src/automation-types.ts';

export type RuleEditor = { id: string; name: string; prompt?: string; groups: AutomationCriterionGroup[] };
export type RuleField = AutomationCriterion['type'] | 'prompt';
const copy = <T>(value: T): T => structuredClone(value);
export const blankRule = (id: string): RuleEditor => ({ id, name: '', groups: [] });
export const editRule = (rule: AutomationCustomLabel): RuleEditor => ({ ...copy(rule), ...(rule.prompt ? {} : { prompt: undefined }) });
export const groupHasMultipleFrom = (group: AutomationCriterionGroup) => group.items.filter(item => item.type === 'from').length > 1;

export function addRuleField(rule: RuleEditor, type: RuleField, groupIndex = 0): RuleEditor {
  const next = copy(rule);
  if (type === 'prompt') {
    if (next.groups[groupIndex]?.operator !== 'exclude') next.prompt = '';
    return next;
  }
  next.groups[groupIndex] ??= { operator: 'or', queryOperator: 'or', items: [] };
  const group = next.groups[groupIndex];
  group.items.push({ type, value: '' });
  if (groupHasMultipleFrom(group)) {
    group.queryOperator = 'or';
    if (groupIndex === 0 && group.operator !== 'exclude') group.operator = 'or';
  }
  return next;
}

export function addExclusion(rule: RuleEditor): RuleEditor {
  if (rule.groups.some(group => group.operator === 'exclude')) return rule;
  const groups = copy(rule.groups);
  if (rule.prompt !== undefined && !groups.length) groups.push({ operator: 'or', queryOperator: 'or', items: [] });
  return { ...copy(rule), groups: [...groups, { operator: 'exclude', queryOperator: 'or', items: [] }] };
}

export function toggleRuleOperator(rule: RuleEditor, index: number): RuleEditor {
  const next = copy(rule), group = next.groups[index];
  if (!group || groupHasMultipleFrom(group)) return next;
  group.queryOperator = group.queryOperator === 'or' ? 'and' : 'or';
  if (index === 0 && group.operator !== 'exclude') group.operator = group.queryOperator;
  return next;
}

export function setRuleItem(rule: RuleEditor, groupIndex: number, itemIndex: number, value: string): RuleEditor {
  const next = copy(rule), item = next.groups[groupIndex]?.items[itemIndex];
  if (item) item.value = value;
  return next;
}

export function removeRuleField(rule: RuleEditor, groupIndex: number, itemIndex: number | 'prompt'): RuleEditor {
  const next = copy(rule);
  if (itemIndex === 'prompt') delete next.prompt;
  else next.groups[groupIndex]?.items.splice(itemIndex, 1);
  if (next.groups[groupIndex]?.items.length === 0 && !(groupIndex === 0 && next.prompt !== undefined)) next.groups.splice(groupIndex, 1);
  return next;
}

export function ruleError(rule: RuleEditor, siblings: readonly AutomationCustomLabel[]): string {
  if (!rule.name.trim()) return 'Name is required';
  if (siblings.some(item => item.id !== rule.id && item.name.trim().toLowerCase() === rule.name.trim().toLowerCase())) return 'A label with this name already exists.';
  if (rule.prompt !== undefined && !rule.prompt.trim()) return "This AI prompt can't be left empty";
  if ((rule.prompt?.length ?? 0) > 1000) return 'Prompt must be at most 1000 characters';
  const items = rule.groups.flatMap(group => group.items);
  if (!rule.prompt?.trim() && !items.length) return 'Add at least one field to proceed';
  if (items.some(item => !item.value.trim())) return "These fields can't be left empty";
  return '';
}

export function ruleValue(rule: RuleEditor): AutomationCustomLabel {
  return { id: rule.id, name: rule.name.trim(), prompt: rule.prompt ?? '', groups: copy(rule.groups).filter(group => group.items.length > 0).map(group => ({ ...group, items: group.items.map(item => ({ ...item, value: item.type === 'subject' ? item.value.trim() : item.value })) })) };
}

export function ruleDirty(rule: RuleEditor, initial: RuleEditor | null): boolean {
  if (initial) return JSON.stringify(rule) !== JSON.stringify(initial);
  return rule.name !== '' || (rule.prompt ?? '') !== '' || rule.groups.some(group => group.items.some(item => item.value !== ''));
}

// Local supported-selector policy, shared semantically with the API. This is
// not evidence for the original app's alias/domain matching behavior.
export function canonicalAutomationSelector(raw: string): string | undefined {
  if (new TextEncoder().encode(raw).length > 1024 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\uD800-\uDFFF]/u.test(raw)) return;
  const text = raw.normalize('NFKC').trim().toLowerCase(), parts = text.split('@');
  if (!text || (raw.includes('@') ? parts.length !== 2 : parts.length !== 1)) return;
  const local = parts.length === 2 ? parts[0] : undefined, rawDomain = parts.at(-1)!;
  if (local !== undefined && (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !/^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u.test(local))) return;
  try {
    const labels = rawDomain.replace(/[。．｡]/gu, '.').split('.').map(label => {
      if (/^[\x00-\x7f]*$/.test(label)) return label;
      const host = new URL('http://' + label + '.invalid').hostname;
      return host.endsWith('.invalid') ? host.slice(0, -8) : '';
    });
    if (!labels.every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) return;
    const domain = labels.join('.'), value = local === undefined ? domain : local + '@' + domain;
    if (domain.length > 253 || (local === undefined && !domain.includes('.')) || new TextEncoder().encode(local === undefined ? 'fixture@' + domain : value).length > 254) return;
    return value;
  } catch { return; }
}

export function configurationValue(input: AutomationConfiguration): AutomationConfiguration {
  const selector = (value: string) => { const checked = canonicalAutomationSelector(value); if (!checked) throw new Error('Enter a valid email address or domain.'); return checked; };
  return { labels: input.labels.map(rule => ({ ...copy(rule), name: rule.name.trim(), groups: rule.groups.map(group => ({ ...copy(group), items: group.items.map(item => ({ ...item, value: item.type === 'subject' ? item.value.trim() : item.type === 'from' || item.type === 'to' ? selector(item.value) : item.value })) })) })), archive: { labelIds: [...new Set(input.archive.labelIds)].sort(), always: [...new Set(input.archive.always.map(selector))].sort(), never: [...new Set(input.archive.never.map(selector))].sort() } };
}
