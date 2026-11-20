import { useReducedMotion } from 'motion/react';

const border = '#557587';
const hoverTransition = { duration: .2, ease: 'easeOut' };
const standardHover = { y: -1, borderColor: border, transition: hoverTransition };
const reducedHover = { borderColor: border, transition: { duration: 0 } };
const press = { scale: .98, transition: { duration: .12 } };

export function useCardMotion(interactive = false) {
  const reduced = useReducedMotion();
  return {
    whileHover: reduced ? reducedHover : standardHover,
    ...(interactive && !reduced ? { whileTap: press } : {}),
  };
}
