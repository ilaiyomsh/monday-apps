/**
 * ולידציה מתקדמת — כלל XOR בין שדות חובה
 * "מספיק למלא אחד משני השדות שנבחרו"
 */

// תוויות שדות לתצוגה בהודעות שגיאה
export const XOR_FIELD_LABELS = {
  task: 'משימה',
  stage: 'סיווג (פרויקטים)',
  nonBillableType: 'סיווג (שוטף)',
  notes: 'הערות'
};

/**
 * מחזיר Set של מפתחות שדות הפטורים מחובת מילוי בזכות כלל XOR.
 * אם שדה A מלא → שדה B פטור (ולהפך).
 * אם שניהם ריקים → אין פטורים (שניהם ייכשלו בוולידציה).
 *
 * @param {Object} advancedValidation - { enabled: boolean, xorFields: [string|null, string|null] }
 * @param {Object} fieldValues - { task, stage, nonBillableType, notes } — ערכים נוכחיים
 * @returns {Set<string>} מפתחות שדות פטורים
 */
export function getXorExemptFields(advancedValidation, fieldValues) {
  const exempt = new Set();

  if (!advancedValidation?.enabled) return exempt;

  const [fieldA, fieldB] = advancedValidation.xorFields || [];
  if (!fieldA || !fieldB) return exempt;

  const aFilled = !!fieldValues[fieldA];
  const bFilled = !!fieldValues[fieldB];

  // אם A מלא → B פטור
  if (aFilled) exempt.add(fieldB);
  // אם B מלא → A פטור
  if (bFilled) exempt.add(fieldA);

  return exempt;
}

/**
 * מחזיר הודעת שגיאה כש-2 שדות XOR ריקים.
 * @param {Object} advancedValidation
 * @returns {string|null}
 */
export function getXorErrorMessage(advancedValidation) {
  if (!advancedValidation?.enabled) return null;
  const [fieldA, fieldB] = advancedValidation.xorFields || [];
  if (!fieldA || !fieldB) return null;

  const labelA = XOR_FIELD_LABELS[fieldA] || fieldA;
  const labelB = XOR_FIELD_LABELS[fieldB] || fieldB;
  return `יש למלא לפחות אחד: ${labelA} או ${labelB}`;
}
