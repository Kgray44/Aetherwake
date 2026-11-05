export interface SystemBatteryMeasurement {
 contract:'aerynth.system-battery@1';measuredAt:string;source:'windows:GetSystemPowerStatus';
 batteryPresent:boolean|null;percent:number|null;acConnected:boolean|null;charging:boolean|null;remainingSeconds:number|null;
}
export function systemBattery(raw:{acLineStatus:number;batteryFlag:number;batteryLifePercent:number;batteryLifeSeconds:number},measuredAt=new Date().toISOString()):SystemBatteryMeasurement {
 if(!raw||![0,1,255].includes(raw.acLineStatus)||!Number.isInteger(raw.batteryFlag)||raw.batteryFlag<0||raw.batteryFlag>255||!Number.isInteger(raw.batteryLifePercent)||(raw.batteryLifePercent>100&&raw.batteryLifePercent!==255)||raw.batteryLifePercent<0||!Number.isInteger(raw.batteryLifeSeconds)||raw.batteryLifeSeconds<0||raw.batteryLifeSeconds>0xffffffff)throw Error('invalid_system_battery');
 const present=raw.batteryFlag===255?null:(raw.batteryFlag&128)===0;
 const value:SystemBatteryMeasurement={contract:'aerynth.system-battery@1',measuredAt,source:'windows:GetSystemPowerStatus',batteryPresent:present,
  percent:present===false||raw.batteryLifePercent===255?null:raw.batteryLifePercent,acConnected:raw.acLineStatus===255?null:raw.acLineStatus===1,
  charging:present!==true||raw.batteryFlag===255?null:(raw.batteryFlag&8)!==0,
  remainingSeconds:present!==true||raw.batteryLifeSeconds===0xffffffff?null:raw.batteryLifeSeconds};validateSystemBattery(value);return value;
}
export function validateSystemBattery(v:unknown):asserts v is SystemBatteryMeasurement {
 if(!v||typeof v!=='object')throw Error('invalid_system_battery');const r=v as SystemBatteryMeasurement;
 if(Object.keys(r).sort().join('|')!=='acConnected|batteryPresent|charging|contract|measuredAt|percent|remainingSeconds|source'||r.contract!=='aerynth.system-battery@1'||r.source!=='windows:GetSystemPowerStatus'||typeof r.measuredAt!=='string'||!Number.isFinite(Date.parse(r.measuredAt))||new Date(r.measuredAt).toISOString()!==r.measuredAt||![true,false,null].includes(r.batteryPresent)||![true,false,null].includes(r.acConnected)||![true,false,null].includes(r.charging)||(r.percent!==null&&(!Number.isInteger(r.percent)||r.percent<0||r.percent>100))||(r.remainingSeconds!==null&&(!Number.isInteger(r.remainingSeconds)||r.remainingSeconds<0||r.remainingSeconds>=0xffffffff))||(r.batteryPresent===false&&(r.percent!==null||r.charging!==null||r.remainingSeconds!==null)))throw Error('invalid_system_battery');
}
export function summarizeSystemBattery(v:SystemBatteryMeasurement):string {
 validateSystemBattery(v);if(v.batteryPresent===false)return 'Windows reports no system battery.'+(v.acConnected===true?' AC power is connected.':'');
 const charge=v.percent===null?'Battery charge is unavailable':`Battery is at ${v.percent}%`;
 const power=v.acConnected===null?'AC power status is unknown':v.acConnected?'AC power is connected':'Running on battery power';
 const charging=v.charging===true?' and charging':v.charging===false&&v.acConnected?' and not charging':'';
 const remaining=v.remainingSeconds===null?'':` Windows estimates ${Math.ceil(v.remainingSeconds/60)} minutes remaining`;
 return `${charge}. ${power}${charging}.${remaining?remaining+'.':''}`;
}
