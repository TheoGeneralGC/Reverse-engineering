// Browser-safe account-private source contracts. Team sharing is unavailable.
export type KnowledgeSourceStatus='pending'|'processing'|'ready'|'error';
export type KnowledgeSource={
 id:string;accountId:string;revision:number;kind:'file'|'link';visibility:'private';
 name:string;description:string;descriptionOrigin?:'local-excerpt'|'user';status:KnowledgeSourceStatus;createdAt:string;updatedAt:string;
 contentVersion:string;contentHash:string;indexedAt:string|null;chunkCount:number;extractedBytes:number;truncated:boolean;
 file?:{name:string;bytes:number;mediaType:string;extension:string;sha256:string};
 link?:{url:string;requestedUrl:string;scope:'single-page';fetchedAt:string|null;mediaType?:string;extension?:'html'|'txt'};
 extraction?:{parser:string;warnings:string[]};
 error:null|{code:string;message:string;retry:'explicit'|'none'};
};
export type KnowledgeSourcePage={sources:KnowledgeSource[];nextCursor:string|null;hasMore:boolean};
export type KnowledgeStatus={
 implemented:true;visibility:'private';teamSharing:false;maxFileBytes:number;extensions:string[];
 parsers:{text:boolean;html:boolean;pdf:boolean;word:boolean;presentation:boolean};
 counts:{pending:number;processing:number;ready:number;error:number};
 limitations:string[];
};
export type KnowledgeUploadQuery={accountId:string;clientRequestId:string;name:string};
export type KnowledgeEdit={accountId:string;expectedRevision:number;name?:string;description?:string};
export type KnowledgeLinkInput={accountId:string;clientRequestId:string;url:string};
export type KnowledgeChunk={id:string;sourceId:string;accountId:string;contentVersion:string;ordinal:number;text:string;label:string;sha256:string};
export type KnowledgeSearchHit={source:KnowledgeSource;chunkId:string;chunkHash:string;ordinal:number;excerpt:string};
export type KnowledgeRead={source:KnowledgeSource;chunks:KnowledgeChunk[];truncated:boolean};
export type KnowledgeExtraction={text:string;parser:string;truncated:boolean;warnings:string[]};
