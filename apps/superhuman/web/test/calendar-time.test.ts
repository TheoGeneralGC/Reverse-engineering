import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailedWhenLabel,draftInput,eventToDraft,layoutWeek,newCalendarDraft,parseWhen,repeatChoices,resolveLocal,weekDates,weekRange,updateEventInput } from '../src/calendar/time.ts';
import type { CalendarEvent } from '../src/calendar/types.ts';
const zone='America/Los_Angeles',now=new Date('2026-10-28T02:08:49.123Z');
const event=(id:string,start:string,end:string):CalendarEvent=>({id,accountId:'synthetic',calendarId:'owned',status:'confirmed',summary:id,start:{dateTime:start,timeZone:zone},end:{dateTime:end,timeZone:zone},etag:'"v1"'});

test('week range follows local Sunday boundaries through spring and fall daylight changes',()=>{
 const spring=weekRange('2026-03-08',zone),fall=weekRange('2026-11-01',zone);assert.equal((Date.parse(spring.timeMax)-Date.parse(spring.timeMin))/3600000,167);assert.equal((Date.parse(fall.timeMax)-Date.parse(fall.timeMin))/3600000,169);assert.deepEqual(weekDates('2026-10-27'),['2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']);
});

test('new drafts start at the current local minute and preserve a real thirty-minute duration',()=>{
 const draft=newCalendarDraft('owned',zone,now);assert.equal(draft.startDate,'2026-10-27');assert.equal(draft.startTime,'19:08');assert.equal(draft.endTime,'19:38');assert.equal(draftInput(draft).start?.dateTime,'2026-10-27T19:08:00-07:00');
});

test('observed tomorrow New York phrase normalizes local times and displays the reference-zone secondary label',()=>{
 const parsed=parseWhen('tomorrow 2 pm 30 min new york',newCalendarDraft('owned',zone,now),now),label=detailedWhenLabel(parsed,zone);assert.equal(parsed.startDate,'2026-10-28');assert.equal(parsed.startTime,'14:00');assert.equal(parsed.endTime,'14:30');assert.equal(parsed.timeZone,'America/New_York');assert.equal(label.primary,'Wed, Oct 28th 2:00 – 2:30 PM EDT');assert.equal(label.secondary,'Wed, Oct 28th 11:00 – 11:30 AM PDT');
});

test('observed Friday and all-day phrases preserve duration and date-only exclusive end',()=>{
 const draft=newCalendarDraft('owned',zone,now),friday=parseWhen('Friday 10am 1 hour',draft,now),allDay=parseWhen('tomorrow all day',draft,now);assert.equal(detailedWhenLabel(friday,zone).primary,'Fri, Oct 30th 10:00 – 11:00 AM');assert.equal(detailedWhenLabel(allDay,zone).primary,'Wed, Oct 28th (all day)');assert.deepEqual(draftInput(allDay).start,{date:'2026-10-28'});assert.deepEqual(draftInput(allDay).end,{date:'2026-10-29'});
});

test('gaps and folds reject silent interpretation; explicit matching offsets resolve the fold',()=>{
 assert.throws(()=>resolveLocal('2026-03-08','02:30',zone),/missing or occurs twice/);assert.throws(()=>resolveLocal('2026-11-01','01:30',zone),/missing or occurs twice/);const early=resolveLocal('2026-11-01','01:30',zone,'-07:00'),late=resolveLocal('2026-11-01','01:30',zone,'-08:00');assert.equal(Number(late.epochMilliseconds-early.epochMilliseconds),3600000);assert.throws(()=>resolveLocal('2026-11-01','01:30',zone,'-05:00'));
});

test('unrecognized When text fails without mutating its draft',()=>{
 const draft=newCalendarDraft('owned',zone,now),before=structuredClone(draft);assert.throws(()=>parseWhen('whenever everyone is free',draft,now));assert.deepEqual(draft,before);
});

test('overlap clusters use separate columns while adjacent events can reuse a full-width column',()=>{
 const items=[event('a','2026-10-27T09:00:00-07:00','2026-10-27T10:00:00-07:00'),event('b','2026-10-27T09:30:00-07:00','2026-10-27T10:30:00-07:00'),event('c','2026-10-27T11:00:00-07:00','2026-10-27T12:00:00-07:00')];const laid=layoutWeek(items,'2026-10-27',zone).timed;assert.equal(laid.find(item=>item.event.id==='a')?.columns,2);assert.equal(laid.find(item=>item.event.id==='b')?.column,1);assert.equal(laid.find(item=>item.event.id==='c')?.columns,1);
});

test('timed overnight events split at local midnight and exclusive all-day ends do not add an extra day',()=>{
 const overnight=event('night','2026-10-27T23:30:00-07:00','2026-10-28T00:30:00-07:00'),holiday:CalendarEvent={id:'holiday',accountId:'synthetic',calendarId:'holiday',status:'confirmed',start:{date:'2026-10-31'},end:{date:'2026-11-01'}};const layout=layoutWeek([overnight,holiday],'2026-10-27',zone);assert.deepEqual(layout.timed.map(item=>[item.day,item.startMinute,item.endMinute]),[[2,1410,1440],[3,0,30]]);assert.equal(layout.allDay[0].day,6);assert.equal(layout.allDay[0].span,1);
});

test('fold rendering retains a positive block and marks the offset change; cancelled and invalid intervals cannot look complete',()=>{
 const fold=event('fold','2026-11-01T01:30:00-07:00','2026-11-01T01:30:00-08:00'),invalid=event('bad','2026-11-01T10:00:00-08:00','2026-11-01T09:00:00-08:00');const laid=layoutWeek([fold,invalid,{...fold,id:'cancelled',status:'cancelled'}],'2026-11-01',zone);assert.equal(laid.timed.length,1);assert.equal(laid.timed[0].endMinute-laid.timed[0].startMinute,60);assert.equal(laid.timed[0].offsetChanged,true);assert.deepEqual(laid.invalid,['owned:bad']);
});

test('title-only changes omit sub-minute endpoints and attendee fields from updates',()=>{
 const source={...event('precision','2026-10-27T09:00:30.123-07:00','2026-10-27T09:00:50.456-07:00'),attendees:[{email:'synthetic@example.test',optional:true,displayName:'Synthetic',responseStatus:'accepted'}]};const draft=eventToDraft(source,zone);draft.summary='New title';assert.deepEqual(updateEventInput(draft,source),{summary:'New title'});
});

test('repeat choices match the observed Tuesday menu and retain explicit rules',()=>{
 const choices=repeatChoices('2026-10-27');assert.ok(choices.some(item=>item.label==='Weekly on Tuesday'&&item.rule==='RRULE:FREQ=WEEKLY;BYDAY=TU'));assert.ok(choices.some(item=>item.label==='Monthly on fourth Tuesday'));assert.ok(choices.some(item=>item.label==='Monthly on last Tuesday'));assert.ok(choices.some(item=>item.label==='Annually on Oct 27'));
});
