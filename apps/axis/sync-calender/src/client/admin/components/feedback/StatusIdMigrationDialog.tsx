import { useEffect, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { useStatusIdMigration } from '../../hooks/useStatusIdMigration';
import { useToast } from './ToastProvider';

interface Props {
  objectId: string;
  tokenReady: boolean;
  isOwner: boolean;
  onMigrated: () => void;
}

// Owner-only prompt that surfaces when the active policy or any user's
// conditionals have legacy status entries (saved id was actually the label
// position). One click runs the translation server-side and refreshes.
// Dismissing for the session keeps the dialog suppressed until reload.
export function StatusIdMigrationDialog({ objectId, tokenReady, isOwner, onMigrated }: Props) {
  const toast = useToast();
  const { plan, loading, running, run } = useStatusIdMigration(objectId, tokenReady);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setDismissed(false); }, [objectId]);

  if (!isOwner) return null;
  if (loading || !plan || dismissed) return null;
  if (!plan.needed) return null;

  const policyCount = plan.items.filter((i) => i.kind === 'policy').length;
  const conditionalCount = plan.items.filter((i) => i.kind === 'conditional').length;
  const unresolvedCount = plan.unresolved.length;

  const summary = [
    policyCount > 0 ? `${policyCount} board mapping${policyCount === 1 ? '' : 's'}` : null,
    conditionalCount > 0 ? `${conditionalCount} conditional${conditionalCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' and ');

  const body = `Some saved status values are stored in an old format and are causing sync errors. ${summary ? `We can migrate ${summary} now to use stable label IDs.` : ''}${unresolvedCount > 0 ? ` ${unresolvedCount} entr${unresolvedCount === 1 ? 'y' : 'ies'} cannot be auto-translated and will need manual re-mapping.` : ''}`;

  return (
    <ConfirmDialog
      open
      title="Status mapping update needed"
      body={body}
      confirmLabel={running ? 'Migrating…' : 'Migrate now'}
      onConfirm={async () => {
        try {
          const result = await run();
          toast.success(`Migrated ${result.migrated} status ${result.migrated === 1 ? 'mapping' : 'mappings'}`);
          onMigrated();
        } catch (err) {
          toast.error(`Migration failed: ${(err as Error).message}`);
        }
      }}
      onCancel={() => setDismissed(true)}
    />
  );
}
