import type {GoogleReminderCommand} from './google-reminder-command.ts';
import type {PrivateAnchor,ReminderSnapshot,ReturnedOccurrence,ReturnedOutbox} from './reminder-contract.ts';
import type {Thread} from './types.ts';
export type ReminderNativeScope={accountId:string;accountVersion:string;threadId:string};
export type ReminderAuthorFacts={messageId:string;fromHeaders:string[];singleAuthor:string|null};
export type ReminderNativePlan={version:1;attemptRef:string;scope:ReminderNativeScope;reminderRef:string;generation:number;purpose:'archive'|'insert';owner:string;signerId:string;leaseUntil:string;grantVersion:string;identityVersion:string;sourceAuthors:ReminderAuthorFacts[];anchor:PrivateAnchor;sourceThread:Thread;localSourceVersion:string;command:GoogleReminderCommand;commandHash:string;internetMessageId:string|null;markerMac:string|null;expectedPlain:string|null;expectedHtml:string|null;important:boolean};
export type ReminderNativeJournal={version:1;ref:string;scope:ReminderNativeScope;reminderRef:string;generation:number;attemptRef:string;purpose:'archive'|'insert';stage:'prepared'|'reclaimed'|'issued'|'ack'|'observed';at:string;planHash:string;previousRef:string|null;previousHash:string|null;detail:unknown};
export type ReminderNativeCurrent={scope:ReminderNativeScope;snapshot:ReminderSnapshot;anchor:PrivateAnchor;thread:Thread};
export type ReminderNativeReturn={occurrence:ReturnedOccurrence;outbox:ReturnedOutbox;carrierProviderMessageId:string;observationHash:string;attemptRef:string;sourceJournalRef:string;sourceJournalHash:string};
