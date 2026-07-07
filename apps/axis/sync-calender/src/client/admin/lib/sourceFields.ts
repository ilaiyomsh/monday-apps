import type { SourceField } from '../types';

export const SOURCE_FIELD_LABELS: Record<SourceField, string> = {
  eventName: 'Event name',
  startDate: 'Start date',
  endDate: 'End date',
  description: 'Description',
  duration: 'Duration (hours)',
  eventLink: 'Event link',
};

export const SOURCE_FIELDS_ORDERED: SourceField[] = [
  'eventName',
  'startDate',
  'endDate',
  'description',
  'duration',
  'eventLink',
];
