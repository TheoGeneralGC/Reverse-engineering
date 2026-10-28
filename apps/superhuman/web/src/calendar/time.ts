import { Temporal } from '@js-temporal/polyfill';
import type { CalendarDraft,CalendarEvent,CalendarEventInput } from './types.ts';
const pad=(value:number)=>String(value).padStart(2,'0');
export function validTimeZone(value:string){try{if(!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value))throw new Error();return new Intl.DateTimeFormat('en-US',{timeZone:value}).resolvedOptions().timeZone}catch{throw new Error('Choose a valid time zone.')}}
export function zonedNow(now:Date,timeZone:string){return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(validTimeZone(timeZone))}
export function weekStart(date:string){const day=Temporal.PlainDate.from(date);return day.subtract({days:day.dayOfWeek%7}).toString()}
export function shiftDate(date:string,days:number){return Temporal.PlainDate.from(date).add({days}).toString()}
export function weekDates(date:string){const start=weekStart(date);return Array.from({length:7},(_,index)=>shiftDate(start,index))}
export function monthDays(date:string){const first=Temporal.PlainDate.from(date).with({day:1}),start=weekStart(first.toString());return Array.from({length:42},(_,index)=>shiftDate(start,index))}
export function shiftMonth(date:string,months:number){return Temporal.PlainDate.from(date).add({months}).toString()}
export function dateLabel(date:string,options:Intl.DateTimeFormatOptions={month:'long',year:'numeric'}){return Temporal.PlainDate.from(date).toLocaleString('en-US',options)}
export function weekRange(date:string,timeZone:string){const start=Temporal.PlainDate.from(weekStart(date));return{timeMin:start.toZonedDateTime(timeZone).toInstant().toString(),timeMax:start.add({days:7}).toZonedDateTime(timeZone).toInstant().toString(),timeZone:validTimeZone(timeZone)}}
export function clockLabel(minutes:number){const hour=Math.floor(minutes/60)%24,minute=Math.floor(minutes%60);return `${hour%12||12}${minute?':'+pad(minute):''} ${hour<12?'am':'pm'}`}
export function resolveLocal(date:string,time:string,timeZone:string,offset=''){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)||offset&&!/^[+-]\d{2}:\d{2}$/.test(offset))throw new Error('Enter a valid date and time.');
 try{return Temporal.ZonedDateTime.from(`${date}T${time}${offset}[${validTimeZone(timeZone)}]`,{overflow:'reject',disambiguation:'reject',offset:'reject'})}
 catch{throw new Error('This time is missing or occurs twice in its time zone. Choose another time or supply its UTC offset.')}
}
export function newCalendarDraft(calendarId:string,timeZone:string,now:Date,date?:string,minute?:number):CalendarDraft{
 const current=zonedNow(now,timeZone);let start=current.with({second:0,millisecond:0,microsecond:0,nanosecond:0});
 if(date!==undefined&&minute!==undefined)start=resolveLocal(date,`${pad(Math.floor(minute/60))}:${pad(minute%60)}`,timeZone);
 const end=start.add({minutes:30});return{key:crypto.randomUUID(),kind:'create',calendarId,summary:'',description:'',location:'',attendees:'',allDay:false,startDate:start.toPlainDate().toString(),startTime:`${pad(start.hour)}:${pad(start.minute)}`,endDate:end.toPlainDate().toString(),endTime:`${pad(end.hour)}:${pad(end.minute)}`,timeZone,startOffset:start.offset,endOffset:end.offset,recurrence:[]};
}
export function eventToDraft(event:CalendarEvent,timeZone:string):CalendarDraft{
 const zone=event.start?.dateTime?validTimeZone(event.start.timeZone||timeZone):validTimeZone(timeZone),allDay=!!event.start?.date;
 if(!event.start||!event.end)throw new Error('This event has no usable start and end.');
 const base={key:crypto.randomUUID(),kind:'update' as const,eventId:event.id,etag:event.etag,calendarId:event.calendarId,summary:event.summary||'',description:event.description||'',location:event.location||'',attendees:(event.attendees||[]).map(attendee=>attendee.email).join(', '),allDay,timeZone:zone,recurrence:event.recurrence?[...event.recurrence]:[],recurringInstance:!!event.recurringEventId};
 if(allDay&&event.start.date&&event.end.date)return{...base,startDate:event.start.date,startTime:'09:00',endDate:shiftDate(event.end.date,-1),endTime:'09:30',startOffset:'',endOffset:''};
 if(!event.start.dateTime||!event.end.dateTime)throw new Error('This event mixes timed and all-day dates.');
 const start=Temporal.Instant.from(event.start.dateTime).toZonedDateTimeISO(zone),end=Temporal.Instant.from(event.end.dateTime).toZonedDateTimeISO(zone);
 return{...base,startDate:start.toPlainDate().toString(),startTime:`${pad(start.hour)}:${pad(start.minute)}`,endDate:end.toPlainDate().toString(),endTime:`${pad(end.hour)}:${pad(end.minute)}`,startOffset:start.offset,endOffset:end.offset};
}
export function parseAttendees(value:string){
 const attendees=value.trim()?value.split(/[,;\n]/).map(email=>email.trim()).filter(Boolean).map(email=>({email})):[];
 if(attendees.length>200||attendees.some(attendee=>!/^\S+@[^@\s]+\.[^@\s]+$/.test(attendee.email))||new Set(attendees.map(attendee=>attendee.email.toLowerCase())).size!==attendees.length)throw new Error('Enter valid, unique attendee email addresses.');return attendees;
}
export function draftInput(draft:CalendarDraft):CalendarEventInput{
 const attendees=parseAttendees(draft.attendees);
 let start:CalendarEventInput['start'],end:CalendarEventInput['end'];
 if(draft.allDay){const first=Temporal.PlainDate.from(draft.startDate),last=Temporal.PlainDate.from(draft.endDate).add({days:1});if(Temporal.PlainDate.compare(first,last)>=0)throw new Error('The end date must be on or after the start date.');start={date:first.toString()};end={date:last.toString()}}
 else{const first=resolveLocal(draft.startDate,draft.startTime,draft.timeZone,draft.startOffset),last=resolveLocal(draft.endDate,draft.endTime,draft.timeZone,draft.endOffset);if(Temporal.ZonedDateTime.compare(first,last)>=0)throw new Error('The event must end after it starts.');start={dateTime:first.toString({timeZoneName:'never',calendarName:'never'}),timeZone:draft.timeZone};end={dateTime:last.toString({timeZoneName:'never',calendarName:'never'}),timeZone:draft.timeZone}}
 return{summary:draft.summary,description:draft.description,location:draft.location,start,end,attendees,...(draft.recurringInstance?{}:{recurrence:[...draft.recurrence]}),...(draft.conference?{conference:{provider:'googleMeet' as const}}:{})};
}
export type TimedSegment={event:CalendarEvent;key:string;day:number;startMinute:number;endMinute:number;column:number;columns:number;offsetChanged:boolean};
export type AllDaySegment={event:CalendarEvent;key:string;day:number;span:number;lane:number};
export function layoutWeek(events:CalendarEvent[],date:string,timeZone:string){
 const dates=weekDates(date),weekEnd=shiftDate(dates[0],7),timed:TimedSegment[]=[],allDay:AllDaySegment[]=[],invalid:string[]=[];
 for(const event of events){if(event.status==='cancelled')continue;try{
  if(event.start?.date&&event.end?.date){if(Temporal.PlainDate.compare(event.start.date,event.end.date)>=0)throw new Error();const start=event.start.date>dates[0]?event.start.date:dates[0],end=event.end.date<weekEnd?event.end.date:weekEnd;if(start<end)allDay.push({event,key:event.calendarId+':'+event.id,day:Temporal.PlainDate.from(dates[0]).until(start).days,span:Temporal.PlainDate.from(start).until(end).days,lane:0});continue}
  if(!event.start?.dateTime||!event.end?.dateTime)throw new Error();const first=Temporal.Instant.from(event.start.dateTime),last=Temporal.Instant.from(event.end.dateTime);if(Temporal.Instant.compare(first,last)>=0)throw new Error();
  for(let day=0;day<7;day++){const dayStart=Temporal.PlainDate.from(dates[day]).toZonedDateTime(timeZone),dayEnd=dayStart.add({days:1}),begin=Temporal.Instant.compare(first,dayStart.toInstant())>0?first:dayStart.toInstant(),finish=Temporal.Instant.compare(last,dayEnd.toInstant())<0?last:dayEnd.toInstant();if(Temporal.Instant.compare(begin,finish)>=0)continue;
   const start=begin.toZonedDateTimeISO(timeZone),end=finish.toZonedDateTimeISO(timeZone),startMinute=start.hour*60+start.minute+start.second/60,wallEnd=end.toPlainDate().toString()!==dates[day]?1440:end.hour*60+end.minute+end.second/60,elapsed=begin.until(finish).total('minutes');
   timed.push({event,key:event.calendarId+':'+event.id+':'+day,day,startMinute,endMinute:Math.min(1440,wallEnd>startMinute?wallEnd:startMinute+elapsed),column:0,columns:1,offsetChanged:start.offset!==end.offset});
  }
 }catch{invalid.push(event.calendarId+':'+event.id)}}
 for(let day=0;day<7;day++){const items=timed.filter(item=>item.day===day).sort((a,b)=>a.startMinute-b.startMinute||b.endMinute-a.endMinute||a.key.localeCompare(b.key));let group:TimedSegment[]=[],boundary=-1;
  const finish=()=>{const ends:number[]=[];for(const item of group){let column=ends.findIndex(end=>end<=item.startMinute);if(column<0)column=ends.length;ends[column]=item.endMinute;item.column=column}for(const item of group)item.columns=ends.length;group=[]};
  for(const item of items){if(item.startMinute>=boundary){finish();boundary=-1}group.push(item);boundary=Math.max(boundary,item.endMinute)}finish();
 }
 const laneEnds:number[]=[];allDay.sort((a,b)=>a.day-b.day||b.span-a.span);for(const item of allDay){let lane=laneEnds.findIndex(end=>end<=item.day);if(lane<0)lane=laneEnds.length;laneEnds[lane]=item.day+item.span;item.lane=lane}
 return{dates,timed,allDay,allDayLanes:Math.max(1,laneEnds.length),invalid};
}

export function parseWhen(text:string,draft:CalendarDraft,now:Date):CalendarDraft{
 let value=text.trim().toLowerCase();if(!value)throw new Error('Enter a date and time.');let timeZone=draft.timeZone;
 const aliases:Record<string,string>={'new york':'America/New_York','los angeles':'America/Los_Angeles','san francisco':'America/Los_Angeles',london:'Europe/London',tokyo:'Asia/Tokyo',utc:'UTC'};
 const named=Object.keys(aliases).sort((a,b)=>b.length-a.length).find(name=>value.endsWith(name));
 if(named){timeZone=aliases[named];value=value.slice(0,-named.length).trim()}else{const explicit=value.match(/\b([a-z_]+\/[a-z_+\-/]+)$/i);if(explicit){const original=text.trim().slice(-explicit[1].length);timeZone=validTimeZone(original);value=value.slice(0,-explicit[1].length).trim()}}
 const durationMatch=value.match(/\b(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?)\b/),duration=durationMatch?Number(durationMatch[1])*(durationMatch[2].startsWith('h')?60:1):30;if(duration<1||duration>7*24*60)throw new Error('Choose a duration from one minute to seven days.');if(durationMatch)value=value.replace(durationMatch[0],'').trim();
 const allDay=/\ball day\b/.test(value);value=value.replace(/\ball day\b/,'').trim();let date=draft.startDate;
 const today=zonedNow(now,timeZone).toPlainDate(),dateMatch=value.match(/\b\d{4}-\d{2}-\d{2}\b/);
 if(dateMatch){date=Temporal.PlainDate.from(dateMatch[0],{overflow:'reject'}).toString();value=value.replace(dateMatch[0],'').trim()}
 else if(/\btomorrow\b/.test(value)){date=today.add({days:1}).toString();value=value.replace(/\btomorrow\b/,'').trim()}
 else if(/\btoday\b/.test(value)){date=today.toString();value=value.replace(/\btoday\b/,'').trim()}
 else{const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],match=value.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);if(match){let delta=(weekdays.indexOf(match[2])-today.dayOfWeek%7+7)%7;if(delta===0||match[1])delta=delta||7;date=today.add({days:delta}).toString();value=value.replace(match[0],'').trim()}}
 if(allDay){if(value)throw new Error('Try a date followed by “all day”.');return{...draft,allDay:true,startDate:date,endDate:date,timeZone,startOffset:'',endOffset:''}}
 const clock=value.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*([+-]\d{2}:\d{2})?$/);if(!clock)throw new Error('Try “tomorrow 2 pm 30 min new york” or an ISO date and time.');let hour=Number(clock[1]),minute=Number(clock[2]||0);if(clock[3]){if(hour<1||hour>12)throw new Error('Enter a valid clock time.');hour=hour%12+(clock[3]==='pm'?12:0)}if(hour>23||minute>59)throw new Error('Enter a valid clock time.');
 const start=resolveLocal(date,`${pad(hour)}:${pad(minute)}`,timeZone,clock[4]||''),end=start.add({minutes:duration});return{...draft,allDay:false,startDate:date,startTime:`${pad(start.hour)}:${pad(start.minute)}`,endDate:end.toPlainDate().toString(),endTime:`${pad(end.hour)}:${pad(end.minute)}`,timeZone,startOffset:start.offset,endOffset:end.offset};
}
export function whenLabel(draft:CalendarDraft){const date=dateLabel(draft.startDate,{weekday:'short',month:'short',day:'numeric'});if(draft.allDay)return `${date} · All day${draft.endDate!==draft.startDate?' – '+dateLabel(draft.endDate,{month:'short',day:'numeric'}):''}`;const first=clockLabel(Number(draft.startTime.slice(0,2))*60+Number(draft.startTime.slice(3))),last=clockLabel(Number(draft.endTime.slice(0,2))*60+Number(draft.endTime.slice(3)));return `${date} ${first} – ${last}`}
export function repeatChoices(date:string){const day=Temporal.PlainDate.from(date),names=['SU','MO','TU','WE','TH','FR','SA'],weekday=names[day.dayOfWeek%7],ordinal=Math.floor((day.day-1)/7)+1,word=['first','second','third','fourth','fifth'][ordinal-1],weekdayName=dateLabel(date,{weekday:'long'});return[
 {label:'Does not repeat',rule:''},{label:'Daily',rule:'RRULE:FREQ=DAILY'},{label:'Weekly on '+weekdayName,rule:`RRULE:FREQ=WEEKLY;BYDAY=${weekday}`},{label:`Monthly on ${word} ${weekdayName}`,rule:`RRULE:FREQ=MONTHLY;BYDAY=${ordinal}${weekday}`},{label:`Monthly on last ${weekdayName}`,rule:`RRULE:FREQ=MONTHLY;BYDAY=-1${weekday}`},{label:'Annually on '+dateLabel(date,{month:'short',day:'numeric'}),rule:`RRULE:FREQ=YEARLY;BYMONTH=${day.month};BYMONTHDAY=${day.day}`},{label:'Every weekday (Mon to Fri)',rule:'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'}];}

const ordinal=(day:number)=>day%100>=11&&day%100<=13?'th':day%10===1?'st':day%10===2?'nd':day%10===3?'rd':'th';
export function detailedWhenLabel(draft:CalendarDraft,displayZone=draft.timeZone):{primary:string;secondary?:string}{
 const day=Temporal.PlainDate.from(draft.startDate),date=`${dateLabel(draft.startDate,{weekday:'short'})}, ${dateLabel(draft.startDate,{month:'short'})} ${day.day}${ordinal(day.day)}`;
 if(draft.allDay)return{primary:`${date} (all day)${draft.endDate!==draft.startDate?' – '+dateLabel(draft.endDate,{month:'short',day:'numeric'}):''}`};
 const first=resolveLocal(draft.startDate,draft.startTime,draft.timeZone,draft.startOffset),last=resolveLocal(draft.endDate,draft.endTime,draft.timeZone,draft.endOffset);
 const time=(value:Temporal.ZonedDateTime,period=true)=>`${value.hour%12||12}:${pad(value.minute)}${period?(value.hour<12?' AM':' PM'):''}`;
 const zone=(value:Temporal.ZonedDateTime)=>new Intl.DateTimeFormat('en-US',{timeZone:value.timeZoneId,timeZoneName:'short'}).formatToParts(new Date(Number(value.epochMilliseconds))).find(part=>part.type==='timeZoneName')?.value||value.offset;
 const label=(start:Temporal.ZonedDateTime,end:Temporal.ZonedDateTime,zoneSuffix:boolean)=>`${dateLabel(start.toPlainDate().toString(),{weekday:'short'})}, ${dateLabel(start.toPlainDate().toString(),{month:'short'})} ${start.day}${ordinal(start.day)} ${time(start,(start.hour<12)!==(end.hour<12)||start.offset!==end.offset)}${start.offset!==end.offset?' '+zone(start):''} – ${time(end)}${zoneSuffix||start.offset!==end.offset?' '+zone(end):''}`;
 const primary=label(first,last,draft.timeZone!==displayZone);if(draft.timeZone===displayZone)return{primary};const localFirst=first.withTimeZone(displayZone),localLast=last.withTimeZone(displayZone);return{primary,secondary:label(localFirst,localLast,true)};
}

export function changedDraftFields(draft:CalendarDraft,original:CalendarEvent){
 const baseline=eventToDraft(original,draft.timeZone),changed:Partial<CalendarDraft>={};
 for(const key of ['summary','description','location','attendees','allDay','startDate','startTime','endDate','endTime','timeZone','startOffset','endOffset','recurrence','conference'] as const)if(JSON.stringify(draft[key])!==JSON.stringify(baseline[key]))Object.assign(changed,{[key]:draft[key]});return changed;
}
export function updateEventInput(draft:CalendarDraft,original:CalendarEvent):CalendarEventInput{
 const changed=changedDraftFields(draft,original),input:CalendarEventInput={};
 for(const key of ['summary','description','location'] as const)if(key in changed)input[key]=draft[key];
 if('attendees' in changed)input.attendees=parseAttendees(draft.attendees);
 if('recurrence' in changed&&!draft.recurringInstance)input.recurrence=[...draft.recurrence];
 if(draft.conference)input.conference={provider:'googleMeet'};
 const startChanged=['allDay','startDate','startTime','timeZone','startOffset'].some(key=>key in changed),endChanged=['allDay','endDate','endTime','timeZone','endOffset'].some(key=>key in changed);
 if(startChanged||endChanged){const normalized=draftInput({...draft,attendees:''});input.start=startChanged?normalized.start:original.start;input.end=endChanged?normalized.end:original.end;if(!input.start||!input.end)throw new Error('Reload the event time before saving.');if(input.start.date&&input.end.date){if(Temporal.PlainDate.compare(input.start.date,input.end.date)>=0)throw new Error('The event must end after it starts.')}else if(input.start.dateTime&&input.end.dateTime){if(Temporal.Instant.compare(input.start.dateTime,input.end.dateTime)>=0)throw new Error('The event must end after it starts.')}else throw new Error('Start and end must both be all-day or timed.');}
 if(!Object.keys(input).length)throw new Error('No changes to save.');return input;
}
