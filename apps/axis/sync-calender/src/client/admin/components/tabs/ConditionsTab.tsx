import { useMemo } from 'react';
import { EmptyState } from '@vibe/core';
import { Section } from '../layout/Section';
import { ConditionalList } from '../conditionals/ConditionalList';
import { useBoardColumns } from '../../hooks/useBoardColumns';
import { useToast } from '../feedback/ToastProvider';
import type { Conditional, Policy, SyncConfig } from '../../types';

interface Props {
  policy: Policy | null;
  myConfig: SyncConfig | null;
  userName: string | null;
  onSaveConditionals: (configId: string, conditionals: Conditional[]) => Promise<SyncConfig>;
}

export function ConditionsTab({ policy, myConfig, userName, onSaveConditionals }: Props) {
  const toast = useToast();
  const boardId = policy?.boardId ?? null;
  const { columns, loading: colsLoading } = useBoardColumns(boardId);

  const eligibleColumns = useMemo(() => {
    const ids = new Set(policy?.conditionalEligibleColumns ?? []);
    return columns.filter((c) => ids.has(c.id));
  }, [columns, policy?.conditionalEligibleColumns]);

  if (!policy) {
    return (
      <Section title="Conditions">
        <p style={{ color: '#676879', fontSize: 13 }}>
          Policy not provisioned yet.
        </p>
      </Section>
    );
  }

  if (!myConfig) {
    return (
      <Section title="Conditions">
        <EmptyState
          title="Connect first"
          description="Connect Google and monday on the Users tab before setting up conditions."
        />
      </Section>
    );
  }

  return (
    <Section title="Conditions">
      {colsLoading ? (
        <p style={{ color: '#676879', fontSize: 13 }}>Loading columns…</p>
      ) : (
        <ConditionalList
          conditionals={myConfig.conditionals ?? []}
          eligibleColumns={eligibleColumns}
          policyBoardId={policy?.boardId ?? null}
          userName={userName}
          disabled={false}
          onSave={async (next) => {
            try {
              await onSaveConditionals(myConfig.configId, next);
              toast.success('Saved');
            } catch (err) {
              toast.error(`Save failed: ${(err as Error).message}`);
              throw err;
            }
          }}
        />
      )}
    </Section>
  );
}
