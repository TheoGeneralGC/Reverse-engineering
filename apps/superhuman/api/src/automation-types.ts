// Local implementation contract informed by the bounded original form probe.
// Observed structure does not establish classifier quality or rule semantics.
export type AutomationCriterion = { type: 'from' | 'to' | 'subject' | 'label'; value: string };
export type AutomationCriterionGroup = {
  operator: 'or' | 'and' | 'exclude';
  queryOperator: 'or' | 'and';
  items: AutomationCriterion[];
};
// Preserve the independently observed prompt/group structure. These are local
// storage types, not a claim that original classification semantics are known.
export type AutomationCustomLabel = { id: string; name: string; prompt: string; groups: AutomationCriterionGroup[] };
export type AutomationBuiltinId = 'builtin-marketing' | 'builtin-news' | 'builtin-pitch' | 'builtin-social';
export type AutomationConfiguration = {
  labels: AutomationCustomLabel[];
  archive: { labelIds: string[]; always: string[]; never: string[] };
};
export type AutomationLabelMetadata = { id: string; name: string; kind: 'builtin' | 'custom'; mailLabelId: string; mailLabelAvailable: boolean };
export type AutomationTemplate = { id: string; name: string; category: 'General' | 'Finance' | 'Purchases' | 'Travel' | 'Legal'; state: 'in-use' | 'available'; criteriaPreset: 'unmeasured' };
export type AutomationSettingsResponse = {
  settings: AutomationSettingsEnvelope<AutomationConfiguration>;
  labels: AutomationLabelMetadata[];
  availableLabels: { id: string; name: string }[];
  labelOptionsLimited: boolean;
  templates: AutomationTemplate[];
  capabilities: { configuration: true; preview: boolean; apply: boolean; providerEffects: false; automaticProcessing: false; classifier: 'controlled-fixture' | 'unavailable' };
  limitations: string[];
};

export type AutomationSettingsEnvelope<Configuration> = {
  accountId: string;
  revision: number;
  configuration: Configuration;
  configurationHash: string;
  updatedAt: string | null;
  processing: 'manual-demo-only' | 'unavailable';
  providerEffects: false;
};

export type AutomationFixtureProvenance = {
  kind: 'synthetic-fixture'; classifierId: string; classifierVersion: string;
  fixtureSetHash: string;
};
export type AutomationThreadIdentity = { threadId: string; stateHash: string };
export type AutomationProposedEffect = {
  threadId: string;
  beforeHash: string;
  addLabelIds: string[];
  labelIdentities: { id: string; stateHash: string }[];
  archive: boolean;
  classification: 'classified' | 'unclassified';
  reasons: string[];
};
export type AutomationPreviewRequest = {
  accountId: string; clientRequestId: string;
  expectedSettingsRevision: number; threadIds: string[];
};
export type AutomationPreview = {
  id: string; accountId: string; clientRequestId: string;
  revision: number;
  settingsRevision: number; settingsHash: string;
  threadIdentities: AutomationThreadIdentity[];
  provenance: AutomationFixtureProvenance;
  state: 'prepared' | 'classifying' | 'completed' | 'failed' | 'interrupted';
  effects: AutomationProposedEffect[];
  previewHash: string | null;
  createdAt: string; completedAt: string | null;
  error: null | { code: string; message: string; retry: 'explicit-new-preview' };
};
export type AutomationApplyRequest = {
  accountId: string; clientRequestId: string; expectedPreviewHash: string;
};
export type AutomationAppliedThread = {
  threadId: string; beforeHash: string; afterHash: string;
  addedLabelIds: string[]; archived: boolean;
};
export type AutomationApplication = {
  id: string; accountId: string;
  previewId: string; previewHash: string; settingsRevision: number;
  appliedAt: string; threads: AutomationAppliedThread[];
  effectScope: 'synthetic-demo-local'; providerEffects: false;
};
export type AutomationApplyReceipt = {
  id: string; accountId: string; clientRequestId: string;
  applicationId: string; previewId: string; previewHash: string; acceptedAt: string;
};
export type AutomationApplyResponse = { application: AutomationApplication; receipt: AutomationApplyReceipt };
