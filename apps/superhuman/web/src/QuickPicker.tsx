import { useEffect,useRef,useState } from 'react';
import Icon from './Icon.tsx';
export type QuickOption={label:string;detail?:string;icon?:string;onSelect:()=>void};
export default function QuickPicker({title,icon,placeholder,options,onDate}:{title:string;icon:string;placeholder:string;options:QuickOption[];onDate?:(date:string)=>void}){
 const [query,setQuery]=useState(''),[selected,setSelected]=useState(0),[date,setDate]=useState('');const input=useRef<HTMLInputElement>(null);
 const results=options.filter(o=>o.label.toLowerCase().includes(query.toLowerCase()));
 useEffect(()=>{input.current?.focus()},[]);
 useEffect(()=>setSelected(0),[query]);
 const choose=()=>{if(results[selected])results[selected].onSelect();else if(onDate){const parsed=parseReminder(query);if(parsed)onDate(parsed.toISOString())}};
 return <><div className="quick-title"><Icon name={icon}/>{title}</div><div className="quick-query"><input ref={input} aria-label={title} placeholder={placeholder} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setSelected(i=>Math.min(results.length-1,i+1))}if(e.key==='ArrowUp'){e.preventDefault();setSelected(i=>Math.max(0,i-1))}if(e.key==='Enter'){e.preventDefault();choose()}}}/></div><div className="quick-results">{results.map((o,i)=><button key={o.label} className={selected===i?'active':''} onMouseEnter={()=>setSelected(i)} onClick={o.onSelect}>{o.icon&&<Icon name={o.icon}/>}<span>{o.label}</span><small>{o.detail}</small></button>)}{!results.length&&onDate&&parseReminder(query)&&<button className="active" onClick={choose}><span>{parseReminder(query)!.toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span><small>↵</small></button>}{!results.length&&(!onDate||!parseReminder(query))&&<p>{onDate?'Try “tomorrow”, “3 days”, or “8 am”':'No matches'}</p>}{onDate&&<div className="quick-custom"><input aria-label="Custom reminder time" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/><button disabled={!date||Date.parse(date)<=Date.now()} onClick={()=>onDate(new Date(date).toISOString())}>Set time</button></div>}</div></>
}
export function parseReminder(value:string,now=new Date()):Date|null{
 const text=value.trim().toLowerCase();if(!text)return null;const date=new Date(now);date.setHours(8,0,0,0);
 if(text==='tomorrow')date.setDate(date.getDate()+1);
 else if(text==='next week'){const days=(8-date.getDay())%7||7;date.setDate(date.getDate()+days)}
 else if(text==='this weekend'){const days=(6-date.getDay()+7)%7||7;date.setDate(date.getDate()+days)}
 else if(text==='someday')date.setDate(date.getDate()+60);
 else if(/^\d+\s+(minute|hour|day|week)s?$/.test(text)){const [,count,unit]=text.match(/^(\d+)\s+(minute|hour|day|week)s?$/)!;const amount=Number(count);if(amount<1||amount>365)return null;return new Date(now.getTime()+amount*({minute:60000,hour:3600000,day:86400000,week:604800000}[unit]||0))}
 else if(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.test(text)){const [,h,m,period]=text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)!;if(Number(h)<1||Number(h)>12||Number(m||0)>59)return null;date.setHours(Number(h)%12+(period==='pm'?12:0),Number(m||0),0,0);if(date<=now)date.setDate(date.getDate()+1)}
 else return null;
 return date>now?date:null;
}
