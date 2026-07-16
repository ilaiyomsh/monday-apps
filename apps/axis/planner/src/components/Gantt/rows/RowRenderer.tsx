import React, { memo } from 'react';
import type { FlatRow, GroupHeaderRow as GroupHeaderRowType, TrackRow as TrackRowType, LoadRow as LoadRowType, SectionHeaderRow as SectionHeaderRowType, EmployeeLoadRowData } from '../../../types/gantt.types';
import { GroupHeaderRow } from './GroupHeaderRow';
import { TrackRow } from './TrackRow';
import { CompanyLoadRow } from './CompanyLoadRow';
import { EmployeeLoadRow } from './EmployeeLoadRow';
import { SectionHeaderRow } from './SectionHeaderRow';
import { SeparatorRow } from './SeparatorRow';

interface RowRendererProps {
  row: FlatRow;
}

/**
 * RowRenderer - renders the appropriate component based on row type
 * Supports GROUP headers, TRACK rows (multiple tasks), LOAD rows, sections.
 */
export const RowRenderer: React.FC<RowRendererProps> = memo(({ row }) => {
  switch (row.type) {
    case 'GROUP': {
      const groupRow = row as GroupHeaderRowType;
      return (
        <GroupHeaderRow
          group={groupRow.data}
          isExpanded={groupRow.isExpanded}
          dimmed={groupRow.dimmed}
        />
      );
    }
    
    case 'LOAD': {
      const loadRow = row as LoadRowType;
      return <CompanyLoadRow loadData={loadRow} />;
    }
    
    case 'TRACK': {
      const trackRow = row as TrackRowType;
      return (
        <TrackRow
          items={trackRow.items}
          groupId={trackRow.groupId}
          trackIndex={trackRow.trackIndex}
          isInactiveProject={trackRow.isInactiveProject}
        />
      );
    }
    
    case 'SECTION': {
      const section = row as SectionHeaderRowType;
      return (
        <SectionHeaderRow
          classification={section.classification}
          label={section.label}
          isExpanded={section.isExpanded}
          count={section.count}
          accentColor={section.accentColor}
          dimmed={section.dimmed}
        />
      );
    }

    case 'EMPLOYEE_LOAD': {
      return <EmployeeLoadRow row={row as EmployeeLoadRowData} />;
    }

    case 'SEPARATOR': {
      return <SeparatorRow />;
    }

    default:
      return null;
  }
});

RowRenderer.displayName = 'RowRenderer';
