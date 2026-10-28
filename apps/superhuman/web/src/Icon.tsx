import type { CSSProperties } from 'react';
const paths:Record<string,string[]>={
 video:['M3 5h9v10H3z','m12 8 5-3v10l-5-3'],pin:['M10 18s6-6 6-10a6 6 0 0 0-12 0c0 4 6 10 6 10Z','M12 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],notes:['M3 4h14M3 8h14M3 12h7M3 16h7','M15 12v6M12 15h6'],
 mail:['M3 5h14v11H3z','m3 6 7 5 7-5'],menu:['M4 6h12M4 10h12M4 14h12'],search:['M14 14l4 4','M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0'],
 compose:['M12 3H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9','m9 11 1-4 6-6 3 3-6 6-4 1'],calendar:['M3 5h14v12H3z','M3 9h14M6 3v4M14 3v4'],
 check:['m3 10 4 4L17 4'],clock:['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0','M10 5v5h4'],star:['m10 2 2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8Z'],
 trash:['M3 5h14M7 5V3h6v2M5 5l1 13h8l1-13M8 8v6M12 8v6'],archive:['M3 4h14v4H3z','M4 8v9h12V8M8 11h4'],x:['m5 5 10 10M5 15 15 5'],arrow:['M17 10H3m5-5-5 5 5 5'],
 down:['m5 8 5 5 5-5'],up:['m5 12 5-5 5 5'],chevron:['m8 5 5 5-5 5'],spark:['m10 2 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z','m16 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z'],
 bolt:['m12 1-9 10h7l-2 8 9-11h-7z'],tag:['M3 3h7l8 8-7 7-8-8Z','M6 6h.01'],paperclip:['m7 12 6-6a2 2 0 0 1 3 3l-8 8a4 4 0 0 1-6-6l9-9a3 3 0 0 1 5 5l-8 8'],
 send:['m2 3 16 7-16 7 3-7-3-7ZM5 10h13'],settings:['M8 2h4l1 3 3 1 2 3-2 3-1 3-3 1-4 2-1-3-3-1-2-3 2-3 1-3Z','M13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
 users:['M8 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6','M2 18v-3a6 6 0 0 1 12 0v3M14 3a3 3 0 0 1 0 6M16 12a5 5 0 0 1 2 4v2'],gift:['M3 8h14v10H3zM2 5h16v4H2zM10 5v13','M10 5C3 6 4-2 8 2l2 3c7 1 6-7 2-3z'],
 help:['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0','M8 7c0-3 5-3 5 0 0 2-3 1-3 4M10 14h.01'],more:['M4 10h.01M10 10h.01M16 10h.01'],reply:['m8 4-6 5 6 5V9c6 0 9 3 10 7 0-8-4-12-10-12'],flag:['M4 18V2h12l-2 4 2 4H4'],folder:['M2 5h6l2 2h8v10H2z'],logout:['M9 3H3v14h6M8 10h10m-4-4 4 4-4 4'],copy:['M7 7h10v11H7z','M4 13H2V2h10v2'],snippet:['M7 2H5v5l-3 3 3 3v5h2M13 2h2v5l3 3-3 3v5h-2'],
};
export default function Icon({name,size=18,style}:{name:string;size?:number;style?:CSSProperties}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={style}>{(paths[name]||paths.more).map((d,i)=><path d={d} key={i}/>)}</svg>}
