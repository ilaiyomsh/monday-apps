/**
 * Serialize form + status values for change_multiple_column_values.
 * Formats follow monday-api references/column-formats.md.
 */

import logger from '../utils/logger.js';
import { serializeStatusMutationValue } from './statusPolicy.js';

const SUPPORTED_FORM_TYPES = new Set([
  'text',
  'long_text',
  'numbers',
  'date',
  'email',
  'phone',
  'link',
  'dropdown',
]);

export function isSupportedFormColumnType(type) {
  return SUPPORTED_FORM_TYPES.has(type);
}

export function serializeFormColumnValue(columnType, rawValue) {
  if (rawValue === null || rawValue === undefined) return '';

  switch (columnType) {
    case 'text':
      return String(rawValue);
    case 'long_text':
      return { text: String(rawValue) };
    case 'numbers':
      return rawValue === '' ? '' : String(rawValue);
    case 'date':
      return rawValue === '' ? {} : { date: String(rawValue) };
    case 'email': {
      const email = String(rawValue).trim();
      return email === '' ? {} : { email, text: email };
    }
    case 'phone': {
      const phone = String(rawValue).trim();
      return phone === '' ? {} : { phone, countryShortName: 'IL' };
    }
    case 'link': {
      const url = String(rawValue).trim();
      return url === '' ? {} : { url, text: url };
    }
    case 'dropdown': {
      if (Array.isArray(rawValue)) return { ids: rawValue.map(String) };
      const asString = String(rawValue).trim();
      return asString === '' ? {} : { labels: [asString] };
    }
    default:
      logger.warn('columnValueFormats', `Unsupported form column type "${columnType}"`);
      return String(rawValue ?? '');
  }
}

/**
 * Prefill a form control from a monday column_values entry.
 */
export function prefillFormValue(columnType, columnValue) {
  if (!columnValue) return '';
  const text = typeof columnValue.text === 'string' ? columnValue.text : '';

  if (columnType === 'date') {
    try {
      const parsed = columnValue.value ? JSON.parse(columnValue.value) : null;
      return parsed?.date ?? '';
    } catch (err) {
      logger.warn('columnValueFormats', 'Failed to parse date column value for prefill', err);
      return '';
    }
  }

  if (columnType === 'email' || columnType === 'phone' || columnType === 'link') {
    try {
      const parsed = columnValue.value ? JSON.parse(columnValue.value) : null;
      if (columnType === 'email') return parsed?.email ?? text;
      if (columnType === 'phone') return parsed?.phone ?? text;
      return parsed?.url ?? text;
    } catch (err) {
      logger.warn('columnValueFormats', 'Failed to parse contact column value for prefill', err);
      return text;
    }
  }

  if (columnType === 'long_text') {
    try {
      const parsed = columnValue.value ? JSON.parse(columnValue.value) : null;
      return parsed?.text ?? text;
    } catch (err) {
      logger.warn('columnValueFormats', 'Failed to parse long_text value for prefill', err);
      return text;
    }
  }

  return text;
}

/**
 * Build the column_values object for change_multiple_column_values.
 */
export function buildMultiColumnWritePayload({
  statusColumnId,
  statusLabelId,
  formFields,
  formValues,
  columnsById,
}) {
  const payload = {
    [statusColumnId]: JSON.parse(serializeStatusMutationValue(statusLabelId)),
  };

  (formFields || []).forEach((field) => {
    const column = columnsById?.get?.(field.columnId) ?? columnsById?.[field.columnId];
    const type = column?.type ?? 'text';
    payload[field.columnId] = serializeFormColumnValue(type, formValues?.[field.columnId] ?? '');
  });

  return payload;
}
