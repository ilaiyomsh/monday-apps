import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { TopicPointRow } from '../TopicPointRow.jsx';

const POINT = { id: '7', name: 'נקודה לבדיקה', discussed: false, notForDiscussion: false, creatorId: null };

// useSortable needs the DnD wrappers TopicsTab normally provides.
function renderRow(props) {
  return render(
    <DndContext>
      <SortableContext items={['7']} strategy={verticalListSortingStrategy}>
        <TopicPointRow point={POINT} usersById={{}} rowStyle={{}} {...props} />
      </SortableContext>
    </DndContext>
  );
}

describe('TopicPointRow — column order (smoke)', () => {
  it('renders cells in the given columns order (check before name when reordered)', () => {
    renderRow({ columns: ['lead', 'name', 'avatar', 'check'] });
    const row = document.querySelector('.row');
    const classes = [...row.children].map((el) => el.className);
    expect(classes.findIndex((c) => c.includes('avatarCell'))).toBeLessThan(
      classes.findIndex((c) => c.includes('checkCell'))
    );
  });

  it('defaults to the original order (lead, name, check, avatar)', () => {
    renderRow({});
    const row = document.querySelector('.row');
    const classes = [...row.children].map((el) => el.className);
    expect(classes.findIndex((c) => c.includes('nameCell'))).toBeLessThan(
      classes.findIndex((c) => c.includes('checkCell'))
    );
    expect(classes.findIndex((c) => c.includes('checkCell'))).toBeLessThan(
      classes.findIndex((c) => c.includes('avatarCell'))
    );
  });
});
