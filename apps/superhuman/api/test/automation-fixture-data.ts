import type { Store } from '../src/store.ts';
import type { Account, Preferences, Thread } from '../src/types.ts';
import type { AutomationConfiguration, AutomationBuiltinId } from '../src/automation-types.ts';
import { automationHash } from '../src/automation-store.ts';
import { createAutomationFixtureClassifier } from '../src/automation-fixtures.ts';

/** Explicit synthetic-only harness input. Importing does nothing; seed refuses
 * any populated Store. No production startup path invokes this helper. */
export function automationDemoFixture() {
  const account: Account = { id: 'automation-demo', provider: 'demo', email: 'alex@automation.example.test', name: 'Alex Demo', color: '#8268c9' };
  const customId = '7a464983-5280-44a5-b8c2-d792ed35347e';
  const threads: Thread[] = [
    ['automation-marketing', 'news@vendor.example.test', 'Weekly fictional announcement'],
    ['automation-cedar', 'partner@company.example.test', 'Cedar fictional update'],
    ['automation-both', 'news@vendor.example.test', 'Cedar fictional announcement'],
    ['automation-protected', 'protected@safe.example.test', 'Protected fictional announcement'],
  ].map(([id, email, subject]) => {
    const sender = { email, name: 'Synthetic sender' };
    return { id, accountId: account.id, subject, sender, participants: [sender, { name: account.name, email: account.email }], snippet: 'Controlled synthetic automation fixture only.', lastMessageAt: '2026-10-28T00:00:00.000Z', unread: true, starred: false, important: false, folder: 'inbox', labels: ['automation-manual'], messages: [{ id: 'message-' + id, sender, to: [{ name: account.name, email: account.email }], date: '2026-10-28T00:00:00.000Z', text: 'Cedar has three fictional samples. No real participant or delivery.', attachments: [] }] };
  });
  const configuration: AutomationConfiguration = {
    labels: [{ id: 'builtin-marketing', name: 'Marketing', prompt: '', groups: [] }, { id: customId, name: 'Cedar review', prompt: '', groups: [{ operator: 'or', queryOperator: 'or', items: [{ type: 'subject', value: 'Cedar' }] }] }],
    archive: { labelIds: ['builtin-marketing'], always: [], never: ['protected@safe.example.test'] },
  };
  const classifier = createAutomationFixtureClassifier({ accountId: account.id, fixtureId: 'automation-browser-demo', version: 'v1', threadHashes: Object.fromEntries(threads.map(thread => [thread.id, automationHash(thread)])), builtinMatches: Object.fromEntries(threads.map(thread => [thread.id, thread.id === 'automation-cedar' ? [] : ['builtin-marketing']])) as Record<string, AutomationBuiltinId[]>, promptMatches: {}, historyComplete: true, emailedBefore: [] });
  const preferences: Preferences = { theme: 'light', activeAccountId: account.id, signature: '', defaultRemind: 'tomorrow', splitInbox: ['Important', 'Other'], snippets: [], 'Auto Advance': true, 'Hide Empty Split Inboxes': false, 'Backtick as Escape': false, 'Show Sender Full Names': true };
  return {
    account: structuredClone(account), threads: structuredClone(threads), configuration: structuredClone(configuration), classifier,
    seed(store: Store) {
      store.db.exec('BEGIN IMMEDIATE');
      try {
        if (Number(store.db.prepare('SELECT count(*) AS n FROM records').get()!.n) !== 0) throw new Error('Automation fixture seeding requires an empty synthetic Store');
        store.put('account', account.id, structuredClone(account)); store.put('preferences', 'global', structuredClone(preferences));
        store.put('label', 'automation-manual', { id: 'automation-manual', accountId: account.id, name: 'Existing manual label' });
        for (const thread of threads) store.put('thread', thread.id, structuredClone(thread));
        store.db.exec('COMMIT');
      } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    },
  };
}
