import type {DeviceLocation} from './system-facts-host.mts';
import type {WeatherMetric,WeatherQuery} from './weather-tool.mts';

const ORIGIN='https://api.weather.gov',HOUR=3600000,DAY=24*HOUR;
const METRICS:readonly WeatherMetric[]=['temperature','humidity','conditions','precipitation','wind'];
const PERIODS=['current','today','tonight','tomorrow','tomorrow-morning','next-7-days','next-week','next-monday','next-tuesday','next-wednesday','next-thursday','next-friday','next-saturday','next-sunday'];
const ERRORS=['weather_query_invalid','weather_permission_unavailable','weather_permission_denied','weather_cancelled','weather_in_progress','weather_source_unavailable','weather_source_invalid','weather_source_capacity','weather_source_timeout','weather_output_capacity','location_native_unavailable','location_native_source_changed','location_foreground_ui_required','location_native_capacity','location_native_busy','location_native_arguments','location_permission_timeout','location_os_denied','location_permission_unspecified','location_cancelled','location_fresh_fix_unavailable','location_source_unavailable','location_stale_fix','location_native_consent_unavailable','location_native_timeout','location_native_protocol'] as const;
type ErrorCode=typeof ERRORS[number];
export interface WeatherNumericSummary {hours:number;complete:boolean;availableMin:number|null;availableMax:number|null;mean:number|null}
export interface WeatherConditionsSummary {hours:number;complete:boolean;descriptions:string[];omitted:number;truncated:boolean}
export interface WeatherWindSummary extends WeatherNumericSummary {directions:string[]}
export interface WeatherSlice {
 date:string|null;startTime:string;endTime:string;requestedHours:number;availableHours:number;complete:boolean;missingMetrics:WeatherMetric[];
 values:{temperature?:WeatherNumericSummary;humidity?:WeatherNumericSummary;conditions?:WeatherConditionsSummary;precipitation?:WeatherNumericSummary;wind?:WeatherWindSummary};
}
export interface WeatherData {
 contract:'aerynth.weather-data@1';status:'complete'|'partial'|'out-of-horizon'|'unavailable';
 source:{name:'National Weather Service';product:'hourly-forecast';fetchedAt:string|null;issuedAt:string|null;locationObservedAt:string|null};
 timezone:string|null;
 requested:WeatherQuery&{resolvedStartDate:string|null;resolvedEndDate:string|null};
 coverage:{requestedHours:number|null;availableHours:number;complete:boolean;missingMetrics:WeatherMetric[];requestedDates:string[];coveredDates:string[]};
 units:{temperature:'degF';humidity:'percent';precipitation:'hourly-probability-percent';wind:'mph'};
 current:WeatherSlice|null;days:WeatherSlice[];aggregate:WeatherSlice|null;errorCode:ErrorCode|null;
}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const round=(n:number)=>Math.round(n*1000)/1000;
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,key)??{},'value'));}
function date(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function validQuery(v:unknown):v is WeatherQuery{
 if(!exact(v,['startDate','endDate','period','metrics','aggregation'])||!Array.isArray(v.metrics)||v.metrics.length<1||v.metrics.length>5||new Set(v.metrics).size!==v.metrics.length||!Array.from(v.metrics).every(metric=>METRICS.includes(metric))||!['current','daily','mean','range'].includes(String(v.aggregation))||(v.period==='current')!==(v.aggregation==='current'))return false;
 return v.period!==null?PERIODS.includes(String(v.period))&&v.startDate===null&&v.endDate===null:date(v.startDate)&&date(v.endDate)&&Date.parse(v.endDate)>=Date.parse(v.startDate)&&Date.parse(v.endDate)-Date.parse(v.startDate)<=6*DAY;
}
const iso=(v:unknown):v is string=>typeof v==='string'&&v.length<=40&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(v)&&Number.isFinite(Date.parse(v));
const safeText=(v:unknown,max:number)=>typeof v==='string'&&!/[\x00-\x1f\x7f-\x9f]/u.test(v)&&v.length<=max?v.trim():'';
const shortText=(v:string)=>{let result='';for(const character of v){if(Buffer.byteLength(result+character)>96)break;result+=character;}return result;};
const addDays=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
const dayList=(start:string,end:string)=>{const result:string[]=[];for(let day=start;day<=end&&result.length<=7;day=addDays(day,1))result.push(day);if(result.length>7)throw Error('weather_query_invalid');return result;};
const zonedDate=(ms:number,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
/** No forecast fetch is implied by an unavailable result. Unknown timestamps stay null. */
export function unavailableWeatherData(query:WeatherQuery,reason:string,now:Date|number=new Date()):WeatherData{
 if(!validQuery(query))throw Error('weather_query_invalid');if(!finite(now instanceof Date?now.getTime():now))throw Error('weather_source_invalid');
 const aliases:Record<string,ErrorCode>={'missing-host':'location_native_unavailable','purpose-deny':'weather_permission_denied',cancel:'weather_cancelled',inprogress:'weather_in_progress'};
 const errorCode=ERRORS.includes(reason as ErrorCode)?reason as ErrorCode:Object.hasOwn(aliases,reason)?aliases[reason]:'weather_source_unavailable';
 return {contract:'aerynth.weather-data@1',status:'unavailable',source:{name:'National Weather Service',product:'hourly-forecast',fetchedAt:null,issuedAt:null,locationObservedAt:null},timezone:null,requested:{...query,metrics:[...query.metrics],resolvedStartDate:null,resolvedEndDate:null},coverage:{requestedHours:null,availableHours:0,complete:false,missingMetrics:[...query.metrics],requestedDates:[],coveredDates:[]},units:{temperature:'degF',humidity:'percent',precipitation:'hourly-probability-percent',wind:'mph'},current:null,days:[],aggregate:null,errorCode};
}
/** Converts a civil date/hour without assuming all local days contain 24 hours. */
function localTime(day:string,hour:number,zone:string){
 const wanted=Date.parse(day+'T00:00:00Z')+hour*HOUR,format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});let candidate=wanted;
 for(let i=0;i<6;i++){const p=Object.fromEntries(format.formatToParts(candidate).map(item=>[item.type,item.value])),actual=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second)),delta=wanted-actual;if(delta===0)return candidate;candidate+=delta;}
 throw Error('weather_source_invalid');
}
function requestedWindow(query:WeatherQuery,now:number,zone:string){
 const today=zonedDate(now,zone);let first=query.startDate??today,last=query.endDate??first,startHour=0,endHour=24;
 if(query.period==='tomorrow'||query.period==='tomorrow-morning'){first=last=addDays(today,1);if(query.period==='tomorrow-morning'){startHour=6;endHour=12;}}
 else if(query.period==='tonight'){first=today;last=addDays(today,1);startHour=18;endHour=6;}
 else if(query.period==='next-7-days')last=addDays(today,6);
 else if(query.period?.startsWith('next-')){const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],target=query.period==='next-week'?1:names.indexOf(query.period.slice(5)),current=new Date(today+'T12:00:00Z').getUTCDay(),offset=(target-current+7)%7||7;first=addDays(today,offset);last=query.period==='next-week'?addDays(first,6):first;}
 const dates=dayList(first,last);return {first,last,dates,start:localTime(first,startHour,zone),end:endHour===24?localTime(addDays(last,1),0,zone):localTime(last,endHour,zone)};
}
type Slot={start:number;end:number;temperature:number|null;humidity:number|null;precipitation:number|null;conditions:string|null;wind:{min:number;max:number;direction:string|null}|null};
const percentage=(v:unknown)=>{if(!v||typeof v!=='object')return null;const q=v as Record<string,unknown>;return q.unitCode==='wmoUnit:percent'&&finite(q.value)&&q.value>=0&&q.value<=100?q.value:null;};
function wind(speed:unknown,direction:unknown):Slot['wind']{
 if(typeof speed!=='string'||speed.length>40)return null;const match=/^(\d+(?:\.\d+)?)(?: to (\d+(?:\.\d+)?))? (mph|km\/h)$/u.exec(speed);if(!match)return null;const factor=match[3]==='mph'?1:1/1.609344,min=Number(match[1])*factor,max=Number(match[2]??match[1])*factor;if(min<0||max<min||max>500)return null;
 return {min:round(min),max:round(max),direction:typeof direction==='string'&&/^(?:N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW|VRB)$/u.test(direction)?direction:null};
}
function parseSlots(value:unknown,now:number):Slot[]{
 if(!Array.isArray(value)||value.length>200)throw Error('weather_source_invalid');const slots:Slot[]=[];
 for(const item of value){if(!item||typeof item!=='object')continue;const p=item as Record<string,unknown>;if(!iso(p.startTime)||!iso(p.endTime))continue;const start=Date.parse(p.startTime),end=Date.parse(p.endTime);if(end-start!==HOUR||end<=now||start>now+8*DAY)continue;
  const temperature=finite(p.temperature)&&Math.abs(p.temperature)<=250&&(p.temperatureUnit==='F'||p.temperatureUnit==='C')?round(p.temperatureUnit==='C'?p.temperature*9/5+32:p.temperature):null;
  slots.push({start,end,temperature,humidity:percentage(p.relativeHumidity),precipitation:percentage(p.probabilityOfPrecipitation),conditions:safeText(p.shortForecast,120)||null,wind:wind(p.windSpeed,p.windDirection)});
 }
 slots.sort((a,b)=>a.start-b.start);if(slots.some((slot,i)=>i>0&&slot.start<slots[i-1].end))throw Error('weather_source_invalid');return slots;
}
function slice(slots:Slot[],start:number,end:number,day:string|null,metrics:WeatherMetric[]):WeatherSlice{
 const selected=slots.filter(slot=>slot.start<end&&slot.end>start),hours=(slot:Slot)=>(Math.min(end,slot.end)-Math.max(start,slot.start))/HOUR,requestedHours=(end-start)/HOUR,availableHours=selected.reduce((sum,slot)=>sum+hours(slot),0),values:WeatherSlice['values']={},missingMetrics:WeatherMetric[]=[];
 for(const metric of metrics){const present=selected.filter(slot=>slot[metric]!==null),presentHours=present.reduce((sum,slot)=>sum+hours(slot),0),complete=Math.abs(presentHours-requestedHours)<1e-7;if(!complete)missingMetrics.push(metric);
  if(metric==='conditions'){const all=[...new Set(present.map(slot=>slot.conditions!))],descriptions=[...new Set(all.slice(0,2).map(shortText))];values.conditions={hours:round(presentHours),complete,descriptions,omitted:Math.max(0,all.length-descriptions.length),truncated:all.length>descriptions.length||all.slice(0,2).some(value=>shortText(value)!==value)};continue;}
  if(metric==='wind'){const exact=present.every(slot=>slot.wind!.min===slot.wind!.max);values.wind={hours:round(presentHours),complete,availableMin:present.length?Math.min(...present.map(slot=>slot.wind!.min)):null,availableMax:present.length?Math.max(...present.map(slot=>slot.wind!.max)):null,mean:complete&&exact?round(present.reduce((sum,slot)=>sum+slot.wind!.min*hours(slot),0)/requestedHours):null,directions:[...new Set(present.flatMap(slot=>slot.wind!.direction?[slot.wind!.direction]:[]))]};continue;}
  const numeric=present.map(slot=>slot[metric] as number);values[metric]={hours:round(presentHours),complete,availableMin:numeric.length?Math.min(...numeric):null,availableMax:numeric.length?Math.max(...numeric):null,mean:complete&&metric!=='precipitation'?round(present.reduce((sum,slot)=>sum+(slot[metric] as number)*hours(slot),0)/requestedHours):null};
 }
 return {date:day,startTime:new Date(start).toISOString(),endTime:new Date(end).toISOString(),requestedHours:round(requestedHours),availableHours:round(availableHours),complete:Math.abs(availableHours-requestedHours)<1e-7&&missingMetrics.length===0,missingMetrics,values};
}
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{signal.throwIfAborted();let rejectAbort:()=>void=()=>{};const stopped=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(signal.reason);signal.addEventListener('abort',rejectAbort,{once:true});});try{return await Promise.race([promise,stopped]);}finally{signal.removeEventListener('abort',rejectAbort);}}
async function json(url:string,signal:AbortSignal,request:typeof fetch){
 const response=await abortable(request(url,{signal,redirect:'error',headers:{Accept:'application/geo+json','User-Agent':'Aerynth desktop (github.com/Kgray44/Aetherwake)'}}),signal);if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw Error('weather_source_unavailable');}
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
 try{for(;;){const part=await abortable(reader.read(),signal);if(part.done)return JSON.parse(text+decoder.decode());bytes+=part.value.byteLength;if(bytes>1024*1024)throw Error('weather_source_capacity');text+=decoder.decode(part.value,{stream:true});}}
 finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Fresh device location is shared only with the fixed NWS origin; never returned or stored. */
export async function readWeatherData(query:WeatherQuery,cancel:AbortSignal,options:{locate(input:{requestedAtMs:number},signal:AbortSignal):Promise<DeviceLocation>;authorize():void|Promise<void>;fetch:typeof fetch;now?:()=>Date;requestedAtMs?:number}):Promise<WeatherData>{
 if(!validQuery(query))throw Error('weather_query_invalid');const clock=options.now??(()=>new Date()),now=clock().getTime();if(!finite(now))throw Error('weather_source_invalid');
 const signal=AbortSignal.any([cancel,AbortSignal.timeout(45000)]),requestedAtMs=Math.max(options.requestedAtMs??now,now);
 const result=unavailableWeatherData(query,'weather_source_unavailable',now);result.errorCode=null;
 const authorize=async()=>{signal.throwIfAborted();try{await abortable(Promise.resolve().then(()=>options.authorize()),signal);}catch(error){signal.throwIfAborted();throw Error('weather_permission_unavailable');}};
 try{
  await authorize();const location=await abortable(options.locate({requestedAtMs},signal),signal);await authorize();
  if(!finite(location.latitude)||Math.abs(location.latitude)>90||!finite(location.longitude)||Math.abs(location.longitude)>180||!finite(location.observedAtMs)||location.observedAtMs<requestedAtMs||location.observedAtMs>clock().getTime()+2000||!['satellite','cellular','wifi'].includes(location.source))throw Error('location_stale_fix');
  result.source.locationObservedAt=new Date(location.observedAtMs).toISOString();
  const point=await json(ORIGIN+'/points/'+location.latitude.toFixed(2)+','+location.longitude.toFixed(2),signal,options.fetch);await authorize();const properties=point?.properties;
  if(!properties||typeof properties.timeZone!=='string'||properties.timeZone.length>80)throw Error('weather_source_invalid');new Intl.DateTimeFormat('en-CA',{timeZone:properties.timeZone}).format(now);result.timezone=properties.timeZone;
  const forecast=new URL(properties.forecastHourly);if(forecast.origin!==ORIGIN||forecast.username||forecast.password||forecast.search||forecast.hash||!/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/u.test(forecast.pathname))throw Error('weather_source_invalid');
  const window=requestedWindow(query,now,result.timezone!);result.requested.resolvedStartDate=window.first;result.requested.resolvedEndDate=window.last;result.coverage.requestedDates=window.dates;result.coverage.requestedHours=query.period==='current'?1:(window.end-window.start)/HOUR;
  await authorize();const payload=await json(forecast.href,signal,options.fetch);await authorize();result.source.fetchedAt=clock().toISOString();const issued=payload?.properties?.updateTime??payload?.properties?.generatedAt;result.source.issuedAt=iso(issued)?new Date(issued).toISOString():null;const slots=parseSlots(payload?.properties?.periods,now);
  let combined:WeatherSlice;
  if(query.period==='current'){const current=slots.find(slot=>slot.start<=now&&slot.end>now);result.coverage.requestedHours=1;if(current){result.current=slice([current],current.start,current.end,zonedDate(now,result.timezone!),query.metrics);combined=result.current;}else{result.status='out-of-horizon';return validateWeatherData(result);}}
  else{
   for(const day of window.dates){const start=Math.max(window.start,localTime(day,0,result.timezone!)),end=Math.min(window.end,localTime(addDays(day,1),0,result.timezone!));if(end>start)result.days.push(slice(slots,start,end,day,query.metrics));}
   combined=slice(slots,window.start,window.end,null,query.metrics);if(query.aggregation==='mean'||query.aggregation==='range')result.aggregate=combined;
  }
  result.coverage={requestedHours:combined.requestedHours,availableHours:combined.availableHours,complete:combined.complete,missingMetrics:combined.missingMetrics,requestedDates:window.dates,coveredDates:(result.current?[result.current]:result.days).filter(day=>day.availableHours>0).map(day=>day.date!)};
  result.status=combined.availableHours===0?'out-of-horizon':combined.complete?'complete':'partial';await authorize();
  if(Buffer.byteLength(JSON.stringify(result))>8192){result.status='unavailable';result.errorCode='weather_output_capacity';result.current=null;result.days=[];result.aggregate=null;result.coverage.complete=false;result.coverage.availableHours=0;result.coverage.coveredDates=[];result.coverage.missingMetrics=[...query.metrics];}
  return validateWeatherData(result);
 }catch(error){cancel.throwIfAborted();result.status='unavailable';const code=error instanceof Error?error.message:'';result.errorCode=signal.aborted?'weather_source_timeout':ERRORS.includes(code as ErrorCode)?code as ErrorCode:'weather_source_unavailable';result.current=null;result.days=[];result.aggregate=null;result.coverage.complete=false;result.coverage.availableHours=0;result.coverage.coveredDates=[];result.coverage.missingMetrics=[...query.metrics];return validateWeatherData(result);}
}

/** A deliberately closed egress DTO. Rejects extra fields such as coordinates, URLs or paths. */
export function validateWeatherData(value:unknown):WeatherData{assertWeatherData(value);return value;}
export function validWeatherData(value:unknown):value is WeatherData{try{assertWeatherData(value);return true;}catch{return false;}}
export function assertWeatherData(value:unknown):asserts value is WeatherData{
 function fail():never{throw Error('invalid_weather_data');}
 let nodes=0;const inspect=(v:unknown,depth:number):void=>{if(++nodes>2048||depth>16)fail();if(v===null||typeof v==='boolean'||typeof v==='string'||finite(v))return;if(!v||typeof v!=='object')fail();if(Array.isArray(v)){if(Object.getPrototypeOf(v)!==Array.prototype||v.length>200||Reflect.ownKeys(v).length!==v.length+1)fail();for(let i=0;i<v.length;i++){const field=Object.getOwnPropertyDescriptor(v,String(i));if(!field||!Object.hasOwn(field,'value'))fail();inspect(field.value,depth+1);}return;}if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();for(const key of Reflect.ownKeys(v)){const field=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!field||!Object.hasOwn(field,'value'))fail();inspect(field.value,depth+1);}};inspect(value,0);
 if(!exact(value,['contract','status','source','timezone','requested','coverage','units','current','days','aggregate','errorCode'])||value.contract!=='aerynth.weather-data@1'||!['complete','partial','out-of-horizon','unavailable'].includes(String(value.status))||Buffer.byteLength(JSON.stringify(value))>8192)fail();
 const v=value as unknown as WeatherData;
 if(!exact(v.source,['name','product','fetchedAt','issuedAt','locationObservedAt'])||v.source.name!=='National Weather Service'||v.source.product!=='hourly-forecast'||v.source.fetchedAt!==null&&!iso(v.source.fetchedAt)||v.source.issuedAt!==null&&!iso(v.source.issuedAt)||v.source.locationObservedAt!==null&&!iso(v.source.locationObservedAt))fail();
 if(v.timezone!==null){try{if(typeof v.timezone!=='string'||v.timezone.length>80)fail();new Intl.DateTimeFormat('en-CA',{timeZone:v.timezone}).format(0);}catch{fail();}}
 if(!exact(v.requested,['startDate','endDate','period','metrics','aggregation','resolvedStartDate','resolvedEndDate'])||!validQuery({startDate:v.requested.startDate,endDate:v.requested.endDate,period:v.requested.period,metrics:v.requested.metrics,aggregation:v.requested.aggregation})||v.requested.resolvedStartDate!==null&&!date(v.requested.resolvedStartDate)||v.requested.resolvedEndDate!==null&&!date(v.requested.resolvedEndDate))fail();
 const metrics=v.requested.metrics,metricList=(list:unknown)=>Array.isArray(list)&&list.length<=5&&new Set(list).size===list.length&&list.every(metric=>metrics.includes(metric));
 if(!exact(v.coverage,['requestedHours','availableHours','complete','missingMetrics','requestedDates','coveredDates'])||v.coverage.requestedHours!==null&&(!finite(v.coverage.requestedHours)||v.coverage.requestedHours<=0||v.coverage.requestedHours>169)||!finite(v.coverage.availableHours)||v.coverage.availableHours<0||v.coverage.availableHours>169||typeof v.coverage.complete!=='boolean'||!metricList(v.coverage.missingMetrics)||![v.coverage.requestedDates,v.coverage.coveredDates].every(days=>Array.isArray(days)&&days.length<=7&&days.every(date)))fail();
 if(!exact(v.units,['temperature','humidity','precipitation','wind'])||v.units.temperature!=='degF'||v.units.humidity!=='percent'||v.units.precipitation!=='hourly-probability-percent'||v.units.wind!=='mph'||v.errorCode!==null&&!ERRORS.includes(v.errorCode))fail();
 if(!Array.isArray(v.days)||v.days.length>7)fail();
 for(const row of [...v.days,...(v.current!==null?[v.current]:[]),...(v.aggregate!==null?[v.aggregate]:[])]){
  if(!exact(row,['date','startTime','endTime','requestedHours','availableHours','complete','missingMetrics','values'])||row.date!==null&&!date(row.date)||!iso(row.startTime)||!iso(row.endTime)||Date.parse(row.endTime)<=Date.parse(row.startTime)||!finite(row.requestedHours)||row.requestedHours<=0||row.requestedHours>169||!finite(row.availableHours)||row.availableHours<0||row.availableHours>row.requestedHours+1e-6||typeof row.complete!=='boolean'||!metricList(row.missingMetrics)||!exact(row.values,metrics))fail();
  for(const metric of metrics){const stats=row.values[metric] as unknown as Record<string,unknown>;if(!stats||!finite(stats.hours)||stats.hours<0||stats.hours>row.availableHours+1e-6||typeof stats.complete!=='boolean'||stats.complete!==(Math.abs(Number(stats.hours)-row.requestedHours)<1e-6))fail();
   if(metric==='conditions'){if(!exact(stats,['hours','complete','descriptions','omitted','truncated'])||!Array.isArray(stats.descriptions)||stats.descriptions.length>2||!stats.descriptions.every(text=>typeof text==='string'&&safeText(text,120)===text&&Buffer.byteLength(text)<=96)||new Set(stats.descriptions).size!==stats.descriptions.length||!Number.isInteger(stats.omitted)||Number(stats.omitted)<0||typeof stats.truncated!=='boolean')fail();}
   else{if(!exact(stats,['hours','complete','availableMin','availableMax','mean',...(metric==='wind'?['directions']:[])])||![stats.availableMin,stats.availableMax,stats.mean].every(n=>n===null||finite(n))||stats.mean!==null&&(!stats.complete||metric==='precipitation')||Number(stats.hours)===0&&(stats.availableMin!==null||stats.availableMax!==null||stats.mean!==null)||Number(stats.hours)>0&&(!finite(stats.availableMin)||!finite(stats.availableMax)||stats.availableMin>stats.availableMax)||finite(stats.mean)&&finite(stats.availableMin)&&finite(stats.availableMax)&&(stats.mean<stats.availableMin-1e-6||stats.mean>stats.availableMax+1e-6))fail();if((metric==='humidity'||metric==='precipitation')&&[stats.availableMin,stats.availableMax,stats.mean].some(n=>n!==null&&(!finite(n)||n<0||n>100)))fail();if(metric==='wind'&&(!Array.isArray(stats.directions)||stats.directions.length>17||!stats.directions.every(direction=>typeof direction==='string'&&/^(?:N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW|VRB)$/u.test(direction))))fail();}
  }
  const missing=metrics.filter(metric=>!row.values[metric]!.complete);
  if(JSON.stringify(missing)!==JSON.stringify(row.missingMetrics)||row.complete!==(Math.abs(row.requestedHours-row.availableHours)<1e-6&&missing.length===0)||Math.abs((Date.parse(row.endTime)-Date.parse(row.startTime))/HOUR-row.requestedHours)>1e-6)fail();
 }
 if(v.coverage.complete&&(v.coverage.missingMetrics.length||v.coverage.requestedHours===null||Math.abs(v.coverage.requestedHours-v.coverage.availableHours)>1e-6)||v.status==='complete'&&!v.coverage.complete||v.status==='unavailable'&&(!v.errorCode||v.current!==null||v.days.length||v.aggregate!==null))fail();
 const first=v.requested.resolvedStartDate,last=v.requested.resolvedEndDate;
 if((first===null)!==(last===null)||v.coverage.coveredDates.some(day=>!v.coverage.requestedDates.includes(day))||new Set(v.coverage.coveredDates).size!==v.coverage.coveredDates.length)fail();
 if(first!==null&&last!==null){
  if(!v.timezone||last<first||JSON.stringify(dayList(first,last))!==JSON.stringify(v.coverage.requestedDates))fail();
  if(v.requested.period===null&&(first!==v.requested.startDate||last!==v.requested.endDate))fail();
  const p=v.requested.period;
  if((p==='current'||p==='today'||p==='tomorrow'||p==='tomorrow-morning'||p?.startsWith('next-')&&p!=='next-week'&&p!=='next-7-days')&&first!==last)fail();
  if((p==='next-week'||p==='next-7-days')&&last!==addDays(first,6)||p==='tonight'&&last!==addDays(first,1))fail();
  const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  if(p==='next-week'&&new Date(first+'T12:00:00Z').getUTCDay()!==1||p?.startsWith('next-')&&names.includes(p.slice(5))&&new Date(first+'T12:00:00Z').getUTCDay()!==names.indexOf(p.slice(5)))fail();
  const start=p==='current'?null:localTime(first,p==='tonight'?18:p==='tomorrow-morning'?6:0,v.timezone!),end=p==='current'?null:p==='tonight'?localTime(last,6,v.timezone!):p==='tomorrow-morning'?localTime(last,12,v.timezone!):localTime(addDays(last,1),0,v.timezone!),expected=p==='current'?1:(end!-start!)/HOUR;
  if(v.coverage.requestedHours===null||Math.abs(v.coverage.requestedHours-expected)>1e-6)fail();
  if(v.status!=='unavailable'){
   if(p==='current'){if(v.days.length||v.aggregate!==null||v.current!==null&&(v.current.date!==first||v.current.requestedHours!==1))fail();}
   else{if(v.current!==null||JSON.stringify(v.days.map(day=>day.date))!==JSON.stringify(v.coverage.requestedDates)||Math.abs(v.days.reduce((sum,day)=>sum+day.requestedHours,0)-expected)>1e-6||Math.abs(v.days.reduce((sum,day)=>sum+day.availableHours,0)-v.coverage.availableHours)>1e-6)fail();
    for(const row of v.days){const actualStart=Math.max(start!,localTime(row.date!,0,v.timezone!)),actualEnd=Math.min(end!,localTime(addDays(row.date!,1),0,v.timezone!));if(Date.parse(row.startTime)!==actualStart||Date.parse(row.endTime)!==actualEnd)fail();}
    if((v.requested.aggregation==='mean'||v.requested.aggregation==='range')!==(v.aggregate!==null))fail();if(v.aggregate&&(v.aggregate.date!==null||Date.parse(v.aggregate.startTime)!==start||Date.parse(v.aggregate.endTime)!==end||v.aggregate.availableHours!==v.coverage.availableHours||v.aggregate.complete!==v.coverage.complete))fail();
   }
   const rows=v.current?[v.current]:v.days,missing=metrics.filter(metric=>rows.some(row=>!row.values[metric]!.complete)||rows.length===0);
   if(JSON.stringify(missing)!==JSON.stringify(v.coverage.missingMetrics)||JSON.stringify(rows.filter(row=>row.availableHours>0).map(row=>row.date))!==JSON.stringify(v.coverage.coveredDates))fail();
  }
 }
 if(v.status==='complete'&&(!v.source.fetchedAt||!v.timezone||first===null||v.coverage.availableHours<=0)||v.status==='partial'&&(v.coverage.complete||v.coverage.availableHours<=0)||v.status==='out-of-horizon'&&(v.coverage.complete||v.coverage.availableHours!==0)||v.status!=='unavailable'&&v.errorCode!==null)fail();
}
