import type { Draft, DeliveryAttempt, Account } from '../src/types.ts';
export function parseReadOnlyFlags(args: string[]): { verify: boolean; runId: string };
export function validateControlledSnapshot(state: unknown, draft: Draft, attempt: DeliveryAttempt, account: Account, participants: string[], runId: string): void;
export function createReadOnlyGmailFetcher(accessToken: string, after: number, implementation?: typeof fetch): { fetcher: typeof fetch; counters: { getAttempts: number; blockedAttempts: number; profile: number; lists: number; metadata: number } };
