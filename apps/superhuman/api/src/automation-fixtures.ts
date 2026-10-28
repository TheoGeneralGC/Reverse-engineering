import { normalizeContactEmail } from './contacts.ts';
import { automationHash } from './automation-store.ts';
import { AUTOMATION_BUILTINS, automationLabelId, normalizeAutomationSelector } from './automation-config.ts';
import type { AutomationConfiguration, AutomationCriterion, AutomationCustomLabel, AutomationBuiltinId } from './automation-types.ts';
import type { AutomationFixtureClassifier } from './automation-engine.ts';
import type { Thread } from './types.ts';

export type AutomationFixtureEvidence = {
  accountId: string; fixtureId: string; version: string;
  threadHashes: Record<string, string>;
  builtinMatches: Record<string, AutomationBuiltinId[]>;
  promptMatches: Record<string, Record<string, boolean>>;
  historyComplete: boolean; emailedBefore: string[];
};
type Match = boolean | undefined;
const any = (values: Match[]): Match => values.some(value => value === true) ? true : values.some(value => value === undefined) ? undefined : false;
const all = (values: Match[]): Match => values.some(value => value === false) ? false : values.some(value => value === undefined) ? undefined : true;
const not = (value: Match): Match => value === undefined ? undefined : !value;
function selectorMatches(rawEmail: string, selector: string): Match {
  const email = normalizeContactEmail(rawEmail); if (!email) return undefined;
  if (selector.includes('@')) return email === selector;
  const domain = email.slice(email.indexOf('@') + 1); return domain === selector || domain.endsWith('.' + selector);
}
function criterionMatches(thread: Thread, item: AutomationCriterion): Match {
  if (item.type === 'from') return selectorMatches(thread.sender.email, item.value);
  if (item.type === 'to') return any((thread.messages.at(-1)?.to ?? []).map(person => selectorMatches(person.email, item.value)));
  if (item.type === 'subject') return thread.subject.toLowerCase().includes(item.value.toLowerCase());
  return thread.labels.includes(item.value);
}
function ruleMatches(thread: Thread, label: AutomationCustomLabel, promptMatch: Match): Match {
  let hasValue = !!label.prompt.trim(), value: Match = hasValue ? promptMatch : undefined;
  for (const group of label.groups) {
    const matched = group.queryOperator === 'and' ? all(group.items.map(item => criterionMatches(thread, item))) : any(group.items.map(item => criterionMatches(thread, item)));
    if (group.operator === 'exclude') { value = all([hasValue ? value : true, not(matched)]); hasValue = true; }
    else if (!hasValue) { value = matched; hasValue = true; }
    else value = group.operator === 'and' ? all([value, matched]) : any([value, matched]);
  }
  return hasValue ? value : undefined;
}

/** Explicit controlled evidence, never a fake paid/model classifier. Registered
 * exact thread hashes gate all work. Prompt/builtin outcomes come only from the
 * caller's synthetic annotations; absent annotations remain unknown. The local
 * predicate/precedence policy is documented separately from original behavior.
 */
export function createAutomationFixtureClassifier(input: AutomationFixtureEvidence): AutomationFixtureClassifier<AutomationConfiguration> {
  const fixture = structuredClone(input), builtinIds = new Set<string>(AUTOMATION_BUILTINS.map(label => label.id));
  if (!fixture.accountId || !/^[A-Za-z0-9_-]{1,128}$/.test(fixture.fixtureId) || !/^[A-Za-z0-9_-]{1,128}$/.test(fixture.version) || Object.keys(fixture.threadHashes).length > 1000 || Object.values(fixture.threadHashes).some(hash => !/^[a-f0-9]{64}$/.test(hash)) || typeof fixture.historyComplete !== 'boolean' || !Array.isArray(fixture.emailedBefore) || fixture.emailedBefore.length > 1000) throw new TypeError('Invalid synthetic automation evidence');
  fixture.emailedBefore = fixture.emailedBefore.map(normalizeAutomationSelector);
  for (const [threadId, matches] of Object.entries(fixture.builtinMatches)) if (!Object.hasOwn(fixture.threadHashes, threadId) || !Array.isArray(matches) || matches.length > 4 || matches.some(id => !builtinIds.has(id)) || new Set(matches).size !== matches.length) throw new TypeError('Invalid fixture classification');
  for (const [threadId, matches] of Object.entries(fixture.promptMatches)) if (!Object.hasOwn(fixture.threadHashes, threadId) || !matches || typeof matches !== 'object' || Array.isArray(matches) || Object.values(matches).some(value => typeof value !== 'boolean')) throw new TypeError('Invalid fixture prompt evidence');
  return {
    provenance: { kind: 'synthetic-fixture', classifierId: fixture.fixtureId, classifierVersion: fixture.version, fixtureSetHash: automationHash(fixture) },
    async classify({ accountId, configuration, threads }) {
      return threads.map(thread => {
        if (accountId !== fixture.accountId || !Object.hasOwn(fixture.threadHashes, thread.id) || fixture.threadHashes[thread.id] !== automationHash(thread)) return { threadId: thread.id, addLabelIds: [], archive: false, classification: 'unclassified' as const, reasons: ['unregistered_or_changed_fixture'] };
        const builtin = Object.hasOwn(fixture.builtinMatches, thread.id) ? fixture.builtinMatches[thread.id] : undefined;
        const prompts = Object.hasOwn(fixture.promptMatches, thread.id) ? fixture.promptMatches[thread.id] : {};
        const customLabels = configuration.labels.filter(label => !builtinIds.has(label.id));
        const custom = new Map(customLabels.map(label => [label.id, ruleMatches(thread, label, Object.hasOwn(prompts, label.id) ? prompts[label.id] : undefined)]));
        const matched = [...(builtin ?? []).filter(id => configuration.labels.some(label => label.id === id)), ...customLabels.filter(label => custom.get(label.id) === true).map(label => label.id)];
        const selected = new Set(configuration.archive.labelIds), reasons: string[] = [];
        let archive = false;
        if (configuration.archive.never.some(selector => selectorMatches(thread.sender.email, selector) === true)) reasons.push('explicit_never_archive');
        else if (configuration.archive.always.some(selector => selectorMatches(thread.sender.email, selector) === true)) { archive = true; reasons.push('explicit_always_archive'); }
        else if (!fixture.historyComplete) reasons.push('fixture_history_unknown');
        else if (fixture.emailedBefore.some(selector => selectorMatches(thread.sender.email, selector) === true || selector.includes('@') && selectorMatches(thread.sender.email, selector.slice(selector.indexOf('@') + 1)) === true)) reasons.push('fixture_correspondence_exemption');
        else if (customLabels.some(label => !selected.has(label.id) && (custom.get(label.id) !== false || thread.labels.includes(automationLabelId(accountId, label.id))))) reasons.push('custom_label_exemption_or_unknown');
        else { archive = matched.some(id => selected.has(id)); reasons.push(archive ? 'selected_label_match' : 'no_selected_label_match'); }
        const unknown = configuration.labels.some(label => builtinIds.has(label.id)) && !builtin || [...custom.values()].some(value => value === undefined);
        if (unknown) reasons.push('fixture_classification_incomplete');
        return { threadId: thread.id, addLabelIds: matched.map(id => automationLabelId(accountId, id)), archive, classification: matched.length || archive || !unknown ? 'classified' as const : 'unclassified' as const, reasons };
      });
    },
  };
}
