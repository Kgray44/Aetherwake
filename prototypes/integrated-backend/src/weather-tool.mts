import {createHash} from 'node:crypto';
import type {ReviewedApiFunction} from '../../openai-provider/contracts.mts';

export const WEATHER_METRICS=['temperature','humidity','conditions','precipitation','wind'] as const;
export type WeatherMetric=typeof WEATHER_METRICS[number];
export const WEATHER_PERIODS=['current','today','tonight','tomorrow','tomorrow-morning','next-7-days','next-week',
  'next-monday','next-tuesday','next-wednesday','next-thursday','next-friday','next-saturday','next-sunday'] as const;
export interface WeatherQuery {
  startDate:string|null;endDate:string|null;period:typeof WEATHER_PERIODS[number]|null;
  metrics:WeatherMetric[];aggregation:'current'|'daily'|'mean'|'range';
}
export const WEATHER_TOOL_NAME='get_weather_forecast';
const definition:ReviewedApiFunction['definition']={type:'function',name:WEATHER_TOOL_NAME,strict:true,
  description:'Get actual forecast data for the user’s current location, including outside temperature, humidity and averages. General weather explanations need no location lookup; do not use this for a different named place. Windows owns location permission; coordinates never enter this tool’s arguments or output. Use relative periods for weekdays and next week; explicit dates only for requested dates. Next week means next Monday–Sunday. A next-weekday period means its next occurrence, seven days later if today. Use current aggregation only with current period. Read coverage: forecasts may not cover the requested dates; never invent missing data or a complete average from partial coverage. Precipitation percentages are hourly probabilities, not rainfall amounts. Current data is an hourly forecast, not a thermometer observation.',
  parameters:{type:'object',additionalProperties:false,required:['startDate','endDate','period','metrics','aggregation'],properties:{
    startDate:{type:['string','null'],description:'YYYY-MM-DD; both dates required with null period, otherwise null.'},
    endDate:{type:['string','null'],description:'Inclusive YYYY-MM-DD; at most seven calendar days.'},
    period:{type:['string','null'],enum:[...WEATHER_PERIODS,null]},
    metrics:{type:'array',minItems:1,maxItems:5,items:{type:'string',enum:[...WEATHER_METRICS]}},
    aggregation:{type:'string',enum:['current','daily','mean','range']},
  }}};
function freeze(value:unknown){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export const WEATHER_TOOL=freeze({definition,schemaDigest:createHash('sha256').update(JSON.stringify(definition)).digest('hex'),authorizationRef:'aerynth-native:current-location-weather@1'}) as ReviewedApiFunction;
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function validWeatherQuery(value:unknown):value is WeatherQuery {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const v=value as Record<string,unknown>,keys=['startDate','endDate','period','metrics','aggregation'];
  if(Reflect.ownKeys(v).length!==keys.length||!keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,key)??{},'value'))||
    !Array.isArray(v.metrics)||v.metrics.length<1||v.metrics.length>5||new Set(v.metrics).size!==v.metrics.length||
    !Array.from(v.metrics).every(metric=>WEATHER_METRICS.includes(metric as WeatherMetric))||
    !['current','daily','mean','range'].includes(v.aggregation as string)||(v.period==='current')!==(v.aggregation==='current'))return false;
  if(v.period!==null)return WEATHER_PERIODS.includes(v.period as typeof WEATHER_PERIODS[number])&&v.startDate===null&&v.endDate===null;
  return date(v.startDate)&&date(v.endDate)&&Date.parse(v.endDate)>=Date.parse(v.startDate)&&Date.parse(v.endDate)-Date.parse(v.startDate)<=6*86400000;
}
