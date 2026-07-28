/**
 * FieldIcon — the column's coloured icon beside a required field's title, the way
 * monday labels the rows of its own item form.
 *
 * The icon NAME and tone come from the columnFields registry (one record per type);
 * this file only maps the name to a @vibe/icons component, so adding a column type
 * still touches one place. monday exposes neither its column icons nor their colours
 * through the API — the palette is our approximation of its look.
 */
import React from 'react';
import {
  Calendar,
  Checkbox,
  Dropdown,
  Email,
  Favorite,
  Link,
  LongText,
  Mobile,
  Numbers,
  Person,
  Status,
  Text,
  Timeline,
} from '@vibe/icons';
import { getFieldSpec } from '../../domain/columnFields';

const ICONS = {
  Calendar,
  Checkbox,
  Dropdown,
  Email,
  Favorite,
  Link,
  LongText,
  Mobile,
  Numbers,
  Person,
  Status,
  Text,
  Timeline,
};

function FieldIcon({ columnType }) {
  const spec = getFieldSpec(columnType);
  const Glyph = spec ? ICONS[spec.icon] : null;
  if (!Glyph) {
    // Unregistered or unmapped type — render the tile with no glyph rather than
    // crashing the whole form on one bad column.
    return <span className="twyst-field-icon" aria-hidden="true" />;
  }
  return (
    <span
      className="twyst-field-icon"
      style={{ background: spec.iconTone }}
      aria-hidden="true"
    >
      <Glyph />
    </span>
  );
}

export default FieldIcon;
