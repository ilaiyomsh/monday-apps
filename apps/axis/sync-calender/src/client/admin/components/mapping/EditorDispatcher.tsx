import { bucketFor, defaultEntryFor, entryMatchesColumn } from '../../lib/mappingEntry';
import type { Column, ColumnMappingEntry } from '../../types';
import { CheckboxEditor } from './editors/CheckboxEditor';
import { DateSourceEditor } from './editors/DateSourceEditor';
import { DropdownLabelEditor } from './editors/DropdownLabelEditor';
import { NotMappableEditor } from './editors/NotMappableEditor';
import { NumberEditor } from './editors/NumberEditor';
import { StaleMappingRow } from './editors/StaleMappingRow';
import { StatusLabelEditor } from './editors/StatusLabelEditor';
import { TemplateEditor } from './editors/TemplateEditor';

interface Props {
  column: Column;
  entry: ColumnMappingEntry | null;
  disabled?: boolean;
  onChange: (next: ColumnMappingEntry | null) => void;
}

export function EditorDispatcher({ column, entry, disabled, onChange }: Props) {
  const bucket = bucketFor(column.type);

  if (bucket === null) {
    return <NotMappableEditor />;
  }

  if (entry !== null && !entryMatchesColumn(entry, column.type)) {
    return (
      <StaleMappingRow
        onReset={() => onChange(defaultEntryFor(column.type))}
      />
    );
  }

  const sharedProps = { entry, column, disabled, onChange };

  switch (bucket) {
    case 'text':
    case 'long_text':
    case 'email_simple':
    case 'phone_simple':
      return <TemplateEditor {...sharedProps} />;
    case 'status':
      return <StatusLabelEditor {...sharedProps} />;
    case 'dropdown':
      return <DropdownLabelEditor {...sharedProps} />;
    case 'numbers':
      return <NumberEditor {...sharedProps} />;
    case 'date':
      return <DateSourceEditor {...sharedProps} />;
    case 'checkbox':
      return <CheckboxEditor {...sharedProps} />;
  }
}
