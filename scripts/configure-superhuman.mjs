import { readFileSync,writeFileSync,existsSync,chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(root,'apps/superhuman/api/.env');
const args=process.argv.slice(2),updates={};
let aiProvider='anthropic',aiRequested=false,aiModel,aiKeyFile,aiWorkspace;
for(let i=0;i<args.length;i++){
 if(args[i]==='--google'){
  const file=args[++i];if(!file)throw new Error('--google requires the local OAuth JSON path');
  const contents=readFileSync(resolve(file),'utf8');let document;
  try{document=JSON.parse(contents)}catch{throw new Error('Could not parse Google OAuth JSON file')}
  const client=document?.web;
  if(!client?.client_id||!client?.client_secret)throw new Error('Expected a Google OAuth Web application client JSON file');
  updates.GOOGLE_CLIENT_ID=client.client_id;updates.GOOGLE_CLIENT_SECRET=client.client_secret;
 }else if(args[i]==='--ai-provider'||args[i].startsWith('--ai-provider=')){
  aiProvider=args[i].includes('=')?args[i].slice('--ai-provider='.length):args[++i];
  if(!['anthropic','openai'].includes(aiProvider))throw new Error('--ai-provider must be anthropic or openai');aiRequested=true;
 }else if(args[i]==='--model'){
  if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('--model requires a model ID');aiModel=args[++i].trim();if(!aiModel)throw new Error('--model requires a model ID');aiRequested=true;
 }else if(args[i]==='--ai-key-file'){
  if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('--ai-key-file requires a path');aiKeyFile=args[++i];aiRequested=true;
 }else if(args[i]==='--ai-workspace'){
  if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('--ai-workspace requires an Anthropic workspace ID');aiWorkspace=args[++i].trim();if(!aiWorkspace)throw new Error('--ai-workspace requires an Anthropic workspace ID');aiRequested=true;
 }else if(args[i]==='--test-senders'){
  if(!args[i+1])throw new Error('--test-senders requires comma-separated explicitly approved addresses');updates.APPROVED_TEST_SENDERS=args[++i];
 }else if(args[i]==='--test-recipients'){
  if(!args[i+1])throw new Error('--test-recipients requires comma-separated explicitly approved addresses');updates.APPROVED_TEST_RECIPIENTS=args[++i];
 }else throw new Error('Unknown option; supported options are --google, --ai-provider, --model, --ai-key-file, --ai-workspace, --test-senders and --test-recipients');
}
if(aiRequested){
 updates.AI_PROVIDER=aiProvider;
 const prefix=aiProvider==='anthropic'?'ANTHROPIC':'OPENAI';
 if(aiModel!==undefined)updates[`${prefix}_MODEL`]=aiModel;
 if(aiKeyFile!==undefined){const key=readFileSync(resolve(aiKeyFile),'utf8').trim();if(!key)throw new Error('--ai-key-file must contain a nonempty API key');updates[`${prefix}_API_KEY`]=key;}
 if(aiWorkspace!==undefined){if(aiProvider!=='anthropic')throw new Error('--ai-workspace is only supported with --ai-provider anthropic');updates.ANTHROPIC_WORKSPACE_ID=aiWorkspace;}
}
let source=readFileSync(existsSync(destination)?destination:resolve(root,'apps/superhuman/api/.env.example'),'utf8');
if(!/^TOKEN_ENCRYPTION_KEY=.+/m.test(source))updates.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('hex');
for(const [key,value] of Object.entries(updates)){
 if(typeof value!=='string'||/[\r\n"\\]/.test(value))throw new Error(`Unsupported characters in ${key}`);
 const line=`${key}="${value}"`,pattern=new RegExp(`^${key}=.*$`,'m');
 source=pattern.test(source)?source.replace(pattern,()=>line):source.trimEnd()+'\n'+line+'\n';
}
writeFileSync(destination,source,{mode:0o600});chmodSync(destination,0o600);
console.log(`Updated ${destination}: ${Object.keys(updates).join(', ')||'no credential changes'}. Values were not printed.`);
console.log('Restart the API to load configuration.');
