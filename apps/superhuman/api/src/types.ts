export type Person = { name: string; email: string };
export type ContactSuggestion = Person & { formatted: string };
export type ContactSuggestionOptions = { accountId: string; q: string; limit?: number };
export type ContactSuggestionPage = { contacts: ContactSuggestion[]; source: 'local-message-participants'; limited: true };
export type ContactContextOptions = { accountId: string; email: string; excludeThreadId?: string };
export type ContactContextPage = { contact: Person; matched: boolean; threads: ThreadSummary[]; source: 'local-message-participants'; limited: true };
export type Account = { id: string; email: string; name: string; provider: 'demo' | 'google'; color: string; lastSyncedAt?: string };
export type Attachment = { id: string; name: string; mimeType: string; size: number; messageId?: string; partId?: string; source?: 'provider' | 'embedded' | 'unavailable'; contentId?: string };
export type Message = { trackingRead?: {messageRef:string}; id: string; sender: Person; to: Person[]; cc?: Person[]; date: string; text: string; html?: string; attachments: Attachment[]; internetMessageId?: string; references?: string; providerLabels?: string[] };
export type Thread = {
  id: string; accountId: string; providerId?: string; subject: string; snippet: string;
  sender: Person; participants: Person[]; lastMessageAt: string; unread: boolean;
  starred: boolean; important: boolean; folder: string; labels: string[];
  messages: Message[]; snoozedUntil?: string; snoozeRetryAt?: string; snoozeError?: string; split?: string; muted?: boolean; syncGeneration?: string; providerLabels?: string[];
};
export type ThreadSummary = Pick<Thread, 'id' | 'accountId' | 'providerId' | 'subject' | 'snippet' | 'sender' | 'participants' | 'lastMessageAt' | 'unread' | 'starred' | 'important' | 'folder' | 'labels' | 'snoozedUntil' | 'snoozeRetryAt' | 'snoozeError' | 'split' | 'muted' | 'providerLabels'> & { messageCount: number; hasAttachments: boolean };
export type ThreadListOptions = { accountId: string; folder?: string; q?: string; split?: 'important' | 'other' | 'calendar' | 'all'; limit?: number; cursor?: string | null; timeZone?: string };
export type ThreadListPage = { threads: ThreadSummary[]; total: number; counts: { inbox: number; important: number; other: number; calendar: number }; nextCursor: string | null; hasMore: boolean };
export type Draft = { id: string; accountId: string; threadId?: string; to: string; cc: string; bcc: string; subject: string; body: string; html?: string; attachments?: Attachment[]; providerDraftId?: string; providerDraftSyncedAt?: string; updatedAt: string; artifactSendId?: string; composerSendId?: string; deliveryReplyContext?: { id?: string; internetMessageId?: string; references?: string; providerThreadId?: string }; revision?: number; status: 'draft' | 'send_queued' | 'scheduled' | 'sending' | 'delivery_held' | 'delivery_unknown' | 'sent' | 'failed'; scheduledAt?: string; error?: string; deliveryAttemptId?: string; deliveryMessageId?: string; deliveryMarker?: string; providerMessageId?: string; providerInternetMessageId?: string; deliveryMarkerVerified?: boolean };
export type DeliveryAttempt = { id: string; draftId: string; status: 'not_issued' | 'dispatching' | 'unknown' | 'sent'; messageId: string; marker?: string; startedAt: string; completedAt?: string; providerMessageId?: string; providerInternetMessageId?: string; markerVerified?: boolean; error?: string };
export type DeliveryReconciliation = { found: boolean; matches: number; scanComplete: boolean; scannedCandidates: number; reason: 'verified' | 'legacy_attempt_unverifiable' | 'attempt_identity_unverified' | 'account_identity_unverified' | 'no_marker_match' | 'multiple_marker_matches' | 'scan_limit_reached' | 'provider_read_failed' | 'invalid_candidate'; providerMessageId?: string; providerInternetMessageId?: string };
export type Label = { id: string; accountId: string; name: string; color?: string; providerId?: string };
export type Preferences = { theme: string; activeAccountId: string; signature: string; defaultRemind: string; splitInbox: string[]; snippets: { id: string; title: string; body: string }[]; 'Auto Advance'?: boolean; 'Hide Empty Split Inboxes'?: boolean; 'Backtick as Escape'?: boolean; 'Show Sender Full Names'?: boolean; [key: string]: unknown };
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
