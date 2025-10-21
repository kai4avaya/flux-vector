/**
 * Mock for uuid to avoid ES module issues in Jest
 */

let counter = 0;

export function v4() {
  counter++;
  return `mock-uuid-${counter}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function v1() {
  counter++;
  return `mock-uuid-v1-${counter}`;
}

export function v3() {
  counter++;
  return `mock-uuid-v3-${counter}`;
}

export function v5() {
  counter++;
  return `mock-uuid-v5-${counter}`;
}

export default {
  v1,
  v3,
  v4,
  v5
};
