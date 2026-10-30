import test from 'node:test';
import assert from 'node:assert/strict';
import {commandArrowIndex} from '../src/command-selection.ts';
test('Command wraps in both directions using the current result count',()=>{assert.equal(commandArrowIndex(0,75,-1),74);assert.equal(commandArrowIndex(74,75,1),0);assert.equal(commandArrowIndex(20,75,-1),19);assert.equal(commandArrowIndex(20,75,1),21)});
test('empty and single-result Command lists never create an invalid highlight',()=>{for(const direction of [-1,1] as const){assert.equal(commandArrowIndex(0,0,direction),0);assert.equal(commandArrowIndex(0,1,direction),0);assert.equal(commandArrowIndex(-1,0,direction),0)}});
test('a stale selection outside a changed result count uses the current neutral first result',()=>{assert.equal(commandArrowIndex(74,2,-1),1);assert.equal(commandArrowIndex(74,2,1),1);assert.equal(commandArrowIndex(-1,3,-1),2);assert.equal(commandArrowIndex(Number.NaN,3,1),1)});
