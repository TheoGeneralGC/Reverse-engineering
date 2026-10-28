export const PERSONALIZATION_FIELDS = ['greeting', 'signoff', 'jobTitle', 'company', 'companyDescription', 'writing', 'scheduling', 'events'] as const;
export type PersonalizationField = typeof PERSONALIZATION_FIELDS[number];
export type PersonalizationFact = { id: string; text: string; deletedAt: string | null };
export type PersonalizationSettings = Record<PersonalizationField, string> & {
  accountId: string; revision: number; enabled: boolean; facts: PersonalizationFact[]; updatedAt: string | null;
};
export type PersonalizationPatch = {
  expectedRevision: number;
  changes: Partial<Record<PersonalizationField, string>> & { facts?: { id: string; text: string }[] };
};
export type PersonalizationSnapshot = {
  accountId: string; revision: number; hash: string; enabled: boolean; text: string;
  totalCharacters: number; suppliedCharacters: number; truncated: boolean;
  totalBytes: number; suppliedBytes: number;
};
