import {createHash} from 'node:crypto';
import type{KnowledgeActionRequest,KnowledgeActionResponse,KnowledgeSource}from'../../api/src/knowledge-types.ts';
export function knowledgeActionFixture(source:KnowledgeSource,clientRequestId:string,request:KnowledgeActionRequest=source.kind==='file'?{kind:'file',name:source.file!.name,bytes:source.file!.bytes,sha256:source.file!.sha256}:{kind:'link',url:source.link!.requestedUrl}):KnowledgeActionResponse{
 const canonical=request.kind==='file'?{kind:'file',name:request.name,sha256:request.sha256}:request.kind==='link'?{kind:'link',url:request.url}:{kind:'retry',id:request.sourceId,expectedRevision:request.expectedRevision};
 return{receipt:{version:1,id:'receipt-'+clientRequestId,accountId:source.accountId,clientRequestId,sourceId:source.id,fingerprintProtocol:'knowledge-request-json-sha256-v1',fingerprint:createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),provenance:'accepted',acceptedAt:source.createdAt,acceptedContentVersion:source.contentVersion,request},source,resolution:{availability:'available',sourceId:source.id,currentContentVersion:source.contentVersion}};
}
