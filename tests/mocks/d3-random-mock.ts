/**
 * Mock for d3-random to avoid ES module issues in Jest
 */

// Simple mock implementations of d3-random functions
export function randomLcg(seed?: number) {
  let s = seed ?? Math.random();
  return function() {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export function randomUniform(min: number = 0, max: number = 1) {
  const random = randomLcg();
  return function() {
    return min + (max - min) * random();
  };
}

export default {
  randomLcg,
  randomUniform
};
