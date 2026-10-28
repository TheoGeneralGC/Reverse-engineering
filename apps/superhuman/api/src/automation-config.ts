import { normalizeContactEmail } from './contacts.ts';
import { HttpError } from './types.ts';
import { automationHash } from './automation-store.ts';
import type { AutomationConfiguration, AutomationCustomLabel, AutomationCriterion, AutomationCriterionGroup, AutomationTemplate } from './automation-types.ts';

export const AUTOMATION_BUILTINS = [
  { id: 'builtin-marketing', name: 'Marketing' }, { id: 'builtin-news', name: 'News' },
  { id: 'builtin-pitch', name: 'Pitch' }, { id: 'builtin-social', name: 'Social' },
] as const;
export const AUTOMATION_TEMPLATE_NAMES: { id: string; name: string; category: AutomationTemplate['category'] }[] = [
  ...['Marketing', 'News', 'Pitch', 'Social', 'Respond', 'Meeting', 'Signature', 'Login', 'Comment', 'Recruiting'].map(name => ({ id: 'template-' + name.toLowerCase(), name, category: 'General' as const })),
  ...['Tax', 'Invoice'].map(name => ({ id: 'template-' + name.toLowerCase(), name, category: 'Finance' as const })),
  ...['Order', 'Shipping'].map(name => ({ id: 'template-' + name.toLowerCase(), name, category: 'Purchases' as const })),
  { id: 'template-travel', name: 'Travel', category: 'Travel' }, { id: 'template-contract', name: 'Contract', category: 'Legal' },
];
function invalid(message = 'Enter valid automation criteria'): never { throw new HttpError(400, message, 'automation_invalid_request'); }
function object(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid(); return value as Record<string, unknown>; }
const key = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validText = (value: unknown): value is string => typeof value === 'string' && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Surrogate}]/u.test(value);
export function automationLabelId(accountId: string, definitionId: string): string { return 'auto_' + automationHash({ accountId, definitionId }).slice(0, 40); }
export function normalizeAutomationSelector(value: unknown): string {
  if (!validText(value) || Buffer.byteLength(value) > 1024) invalid('Choose a sender email address or domain');
  const raw = value.trim();
  if (raw.includes('@')) { const email = normalizeContactEmail(raw); if (!email) invalid('Choose a sender email address or domain'); return email; }
  const email = normalizeContactEmail('fixture@' + raw), domain = email?.slice(email.indexOf('@') + 1);
  if (!domain || !domain.includes('.')) invalid('Choose a sender email address or domain');
  return domain;
}
function criterion(raw: unknown): AutomationCriterion {
  const value = object(raw, ['type', 'value']); if (typeof value.type !== 'string' || !['from', 'to', 'subject', 'label'].includes(value.type) || !validText(value.value)) invalid();
  const type = value.type as AutomationCriterion['type']; let text = type === 'label' ? value.value : value.value.trim();
  if (type === 'from' || type === 'to') text = normalizeAutomationSelector(text);
  else if (!text || type === 'label' && /\s/.test(text) || Buffer.byteLength(text) > (type === 'label' ? 1024 : 2000)) invalid();
  return { type, value: text };
}
function group(raw: unknown): AutomationCriterionGroup {
  const value = object(raw, ['operator', 'queryOperator', 'items']);
  if (typeof value.operator !== 'string' || !['or', 'and', 'exclude'].includes(value.operator) || typeof value.queryOperator !== 'string' || !['or', 'and'].includes(value.queryOperator) || !Array.isArray(value.items) || !value.items.length || value.items.length > 20) invalid();
  return { operator: value.operator as AutomationCriterionGroup['operator'], queryOperator: value.queryOperator as AutomationCriterionGroup['queryOperator'], items: value.items.map(criterion) };
}
export function parseAutomationLabel(raw: unknown): AutomationCustomLabel {
  const value = object(raw, ['id', 'name', 'prompt', 'groups']);
  if (!key(value.id) || !validText(value.name) || !value.name.trim() || Buffer.byteLength(value.name.trim()) > 2048 || typeof value.prompt !== 'string' || value.prompt.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\p{Surrogate}]/u.test(value.prompt) || !Array.isArray(value.groups) || value.groups.length > 8) invalid();
  const builtin = AUTOMATION_BUILTINS.find(label => label.id === value.id);
  if (builtin) { if (value.name.trim().toLowerCase() !== builtin.name.toLowerCase() || value.prompt !== '' || value.groups.length) invalid('Built-in category metadata cannot contain invented criteria'); return { id: builtin.id, name: builtin.name, prompt: '', groups: [] }; }
  const groups = value.groups.map(group);
  if (!value.prompt.trim() && !groups.length) invalid('Add a prompt or at least one criterion');
  return { id: value.id, name: value.name.trim(), prompt: value.prompt, groups };
}
export function emptyAutomationConfiguration(): AutomationConfiguration { return { labels: [], archive: { labelIds: [], always: [], never: [] } }; }
export function parseAutomationConfiguration(raw: unknown): AutomationConfiguration {
  const value = object(raw, ['labels', 'archive']), archive = object(value.archive, ['labelIds', 'always', 'never']);
  if (!Array.isArray(value.labels) || value.labels.length > 100 || !Array.isArray(archive.labelIds) || archive.labelIds.length > 104 || !Array.isArray(archive.always) || archive.always.length > 100 || !Array.isArray(archive.never) || archive.never.length > 100) invalid();
  const labels = value.labels.map(parseAutomationLabel), ids = new Set<string>(), names = new Set<string>(), reserved = new Set(AUTOMATION_BUILTINS.map(label => label.name.toLowerCase() as string));
  for (const label of labels) { if (ids.has(label.id) || names.has(label.name.toLowerCase()) || !AUTOMATION_BUILTINS.some(builtin => builtin.id === label.id) && reserved.has(label.name.toLowerCase())) invalid('Auto Label names and identities must be unique'); ids.add(label.id); names.add(label.name.toLowerCase()); }
  if (archive.labelIds.some(id => typeof id !== 'string' || !ids.has(id))) invalid('Select a configured Auto Label');
  return { labels, archive: { labelIds: [...new Set(archive.labelIds as string[])].sort(), always: [...new Set(archive.always.map(normalizeAutomationSelector))].sort(), never: [...new Set(archive.never.map(normalizeAutomationSelector))].sort() } };
}
