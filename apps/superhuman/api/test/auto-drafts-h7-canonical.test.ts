import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEngineStatus} from '../src/auto-drafts-generation-contract.ts';
import {status,digest} from '../../web/test/auto-drafts-v2-fixtures.ts';

// Actual browser fixture serialized to a raw-wire boundary; no App or transport.
const wire=()=>JSON.parse(JSON.stringify(status()));
test('H7 cloud capability round-trips strict booleans while all other capability contracts remain fixed',async()=>{
 const base=wire();
 for(const automaticCloudSave of [false,true]){
  const raw=wire();raw.capabilities.automaticCloudSave=automaticCloudSave;
  const result=await parseEngineStatus(raw,'fixture-a',digest);
  assert.deepEqual(result.capabilities,{...base.capabilities,automaticCloudSave});
 }
 for(const value of ['true','false',0,1,null,{},[]]){
  const raw=wire();raw.capabilities.automaticCloudSave=value;
  await assert.rejects(parseEngineStatus(raw,'fixture-a',digest));
 }
 const missing=wire();delete missing.capabilities.automaticCloudSave;
 await assert.rejects(parseEngineStatus(missing,'fixture-a',digest));
 const extra=wire();extra.capabilities.mode='managed';
 await assert.rejects(parseEngineStatus(extra,'fixture-a',digest));
 for(const key of ['followUps','teammateScheduling','automaticSend','automaticSchedule','originalGenerationVerified']){
  const raw=wire();raw.capabilities[key]=true;
  await assert.rejects(parseEngineStatus(raw,'fixture-a',digest));
 }
 const createOnly=wire();createOnly.capabilities.createOnly=false;
 await assert.rejects(parseEngineStatus(createOnly,'fixture-a',digest));
});
