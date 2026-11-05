import type { ExperienceMotionPort,ExperiencePose } from '../../application-contract/motion.ts';
/** Synthetic samples only, never the actual host engine or native animation. */
export function pickerMotion(reduced=false){
 const poses=new Map<string,ExperiencePose>(),targets=new Map<string,ExperiencePose>(),causes:string[]=[];let wakes=0;
 const motion:ExperienceMotionPort={reduced,add(key,value){if(poses.has(key))throw Error('duplicate_motion_key');poses.set(key,{...value});},target(key,value,cause){if(!poses.has(key))throw Error('unowned_motion_key');targets.set(key,{...value});causes.push(cause);if(reduced)poses.set(key,{...value});},pose(key){const value=poses.get(key);if(!value)throw Error('missing_motion_key');return {...value};},remove(key){poses.delete(key);targets.delete(key);},wake(){wakes++;}};
 return {motion,poses,targets,causes,get wakes(){return wakes;},step(progress=1){for(const[key,target]of targets){const before=poses.get(key)!;poses.set(key,Object.fromEntries(Object.entries(target).map(([field,value])=>[field,before[field as keyof ExperiencePose]+(value-before[field as keyof ExperiencePose])*progress])) as ExperiencePose);}}};
}
