import type{SplitConfigurationResponse,SplitViewsResponse,SplitViewRef}from'./split-inbox-client.ts';
export const selectionViewRef=(selection:string):SplitViewRef=>selection.startsWith('custom:')?selection as SplitViewRef:selection.startsWith('builtin:')?selection as SplitViewRef:('builtin:'+selection.toLowerCase()) as SplitViewRef;
export type SplitTab={ref:SplitViewRef;name:string;total:number|null;estimated:boolean;issue:string|null};
export function splitTabs(options:{base:SplitConfigurationResponse|null|undefined;views:SplitViewsResponse|null|undefined;selected:SplitViewRef;legacy:string[];hideLegacyEmpty:boolean;legacyReady:boolean;legacyCounts:{important:number;other:number;calendar:number};sourceGeneration?:number}):SplitTab[]{
 const{base,views,selected}=options;
 if(!base?.settings.persisted)return(['important','other','calendar'] as const).filter(id=>options.legacy.includes(id[0].toUpperCase()+id.slice(1))&&(!options.hideLegacyEmpty||!options.legacyReady||options.legacyCounts[id]>0)).map(id=>({ref:`builtin:${id}` as const,name:id[0].toUpperCase()+id.slice(1),total:options.legacyCounts[id],estimated:false,issue:null}));
 const valid=views?.accountId===base.settings.accountId&&views.settingsRevision===base.settings.revision&&views.policyVersion===base.capabilities.policyVersion&&(options.sourceGeneration===undefined||views.sourceGeneration===options.sourceGeneration);
 return base.settings.order.flatMap(ref=>{const d=base.settings.custom.find(x=>'custom:'+x.id===ref);if(d&&!d.enabled)return[];const view=valid?views.views.find(v=>v.ref===ref):undefined,validation=d?base.validation.find(v=>v.id===d.id):undefined,issue=validation&&!validation.valid?validation.issue?.message||'Definition needs review':view?.issue?.message||null;
 const hide=d?.hideEmpty??view?.hideEmpty??false;if(!issue&&hide&&ref!==selected&&view?.count.total===0&&view.count.isComplete&&!view.count.isEstimate&&views?.coverage.status==='complete')return[];
 return[{ref,name:d?.name||ref.slice(8).replace(/^./,c=>c.toUpperCase()),total:issue?null:view?.count.total??null,estimated:!!view?.count.isEstimate,issue}];});
}
