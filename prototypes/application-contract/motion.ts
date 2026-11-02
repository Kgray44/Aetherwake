/** Borrowed presentation channels from the application's existing coordinator.
 * A view registers its own keys, reads them in the host frame, and removes only
 * those keys. This port supplies no scheduler, clock, canonical state or authority. */
export type ExperiencePose = {
  x:number; y:number; w:number; h:number; lift:number; yaw:number; opacity:number;
};
export interface ExperienceMotionPort {
  readonly reduced:boolean;
  add(key:string,pose:ExperiencePose):void;
  target(key:string,pose:ExperiencePose,cause:string):void;
  pose(key:string):ExperiencePose;
  remove(key:string):void;
  wake():void;
}
