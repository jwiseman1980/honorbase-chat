// lib/friction.ts — detect user frustration / confusion signals in messages.
// Phase 1: regex pattern matching. Phase 2: upgrade to sentiment/embedding model.

const FRICTION_PATTERNS: RegExp[] = [
  /i('m| am) (confused|frustrated|stuck|lost)/i,
  /this (doesn't|does not|isn't) (work|right|correct)/i,
  /i (don't|do not) (understand|get|know)/i,
  /why (is|does|can't|won't)/i,
  /can you (just|please)/i,
  /i('ve| have) (already|been) (asked|told|said|tried)/i,
  /this is (broken|wrong|confusing)/i,
  /what('s| is) (going on|happening|wrong)/i,
];

export interface FrictionResult {
  detected: boolean;
  confidence: number; // 0–1
  patterns: string[];
}

export function detectFriction(message: string): FrictionResult {
  const matches = FRICTION_PATTERNS.filter((p) => p.test(message));
  return {
    detected: matches.length >= 1,
    confidence: Math.min(matches.length / 3, 1),
    patterns: matches.map((p) => p.source),
  };
}
