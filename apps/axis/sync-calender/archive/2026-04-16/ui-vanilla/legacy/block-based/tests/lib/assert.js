// Small assertion helper with friendly output for scenario scripts.
let failures = 0;
let passes = 0;

export function assert(cond, message) {
  if (cond) {
    passes++;
    console.log(`    ✓ ${message}`);
  } else {
    failures++;
    console.log(`    ✗ ${message}`);
  }
}

export function assertEq(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes++;
    console.log(`    ✓ ${message}`);
  } else {
    failures++;
    console.log(`    ✗ ${message}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual  : ${JSON.stringify(actual)}`);
  }
}

export function assertionSummary() {
  console.log(`\nAssertions: ${passes} passed, ${failures} failed`);
  return { passes, failures };
}
