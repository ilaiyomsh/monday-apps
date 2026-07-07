// Pure evaluator for per-user conditional override rules. No I/O, no logger.
// Given an ordered list of Conditionals + an eventContext, returns the first
// matching conditional or null. Caller decides what to do with the .values.
//
// Shape contract matches src/helpers/conditionals-validator.js.

function normalize(s) {
  return (s == null ? '' : String(s)).toLowerCase();
}

function emailDomain(email) {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

function matchAttendeeEmail(attendees, op, value) {
  if (!Array.isArray(attendees) || attendees.length === 0) return false;
  const needle = normalize(value);
  for (const a of attendees) {
    const email = normalize(a?.email);
    if (!email) continue;
    if (op === 'equals' && email === needle) return true;
    if (op === 'contains' && email.includes(needle)) return true;
    if (op === 'domain' && emailDomain(email) === needle) return true;
  }
  return false;
}

function matchText(haystack, op, value) {
  const hay = normalize(haystack);
  const needle = normalize(value);
  if (op === 'equals') return hay === needle;
  if (op === 'contains') return hay.includes(needle);
  if (op === 'regex') {
    try {
      return new RegExp(value, 'i').test(haystack == null ? '' : String(haystack));
    } catch {
      return false;
    }
  }
  return false;
}

function evaluatePredicate(p, ctx) {
  switch (p.field) {
    case 'attendee_email':
      return matchAttendeeEmail(ctx.attendees, p.op, p.value);
    case 'event_title':
      return matchText(ctx.title, p.op, p.value);
    case 'description':
      return matchText(ctx.description, p.op, p.value);
    case 'location':
      return matchText(ctx.location, p.op, p.value);
    default:
      return false;
  }
}

function evaluateConditional(c, ctx) {
  if (!Array.isArray(c.predicates) || c.predicates.length === 0) return false;
  if (c.operator === 'OR') {
    return c.predicates.some((p) => evaluatePredicate(p, ctx));
  }
  // default AND
  return c.predicates.every((p) => evaluatePredicate(p, ctx));
}

// Build the predicate evaluation context from a CanonicalEvent. Canonical
// fields are provider-agnostic (title, description, location, attendees), so
// this function does not need to branch on provider.
export function buildEventContext(event) {
  return {
    title: event?.title ?? '',
    description: event?.description ?? '',
    location: event?.location ?? '',
    attendees: Array.isArray(event?.attendees)
      ? event.attendees.map((a) => ({ email: a?.email, self: !!a?.isSelf, responseStatus: a?.response }))
      : [],
  };
}

function actionOf(c) {
  return c?.action === 'skip' ? 'skip' : 'override';
}

// Override evaluation walks only override-rules and returns the first match.
// Skip-rules are handled separately via matchSkip and never contribute values.
export function evaluateConditionals(conditionals, eventContext) {
  if (!Array.isArray(conditionals) || conditionals.length === 0) return null;
  for (const c of conditionals) {
    if (actionOf(c) !== 'override') continue;
    if (evaluateConditional(c, eventContext)) {
      return { id: c.id, name: c.name, values: c.values || {} };
    }
  }
  return null;
}

// Returns the first matching skip-rule, or null. Order within skip-rules is
// semantically irrelevant (any match = skip) but we return the first one so
// logs show which rule fired.
export function matchSkip(conditionals, eventContext) {
  if (!Array.isArray(conditionals) || conditionals.length === 0) return null;
  for (const c of conditionals) {
    if (actionOf(c) !== 'skip') continue;
    if (evaluateConditional(c, eventContext)) {
      return { id: c.id, name: c.name };
    }
  }
  return null;
}
