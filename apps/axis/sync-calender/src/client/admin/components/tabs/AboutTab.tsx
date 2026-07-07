import type { FC, ReactNode, SVGAttributes } from 'react';
import { ExpandCollapse, Flex, IconButton, Link, Text, Tooltip } from '@vibe/core';
import { Person, Work, Security, TextCopy } from '@vibe/icons';
import { Section } from '../layout/Section';
import type { MondayContext, Me, Policy } from '../../types';

type VibeSvgIcon = FC<SVGAttributes<SVGElement> & { size?: string | number }>;

// Keep in sync with package.json "version".
const APP_VERSION = '1.0.0';
const DOCS_URL = 'https://developer.monday.com/apps/docs';

interface Props {
  context: MondayContext | null;
  me: Me | null;
  isOwner: boolean;
  objectId: string;
  policy: Policy | null;
}

function copy(value: string) {
  if (!value || value === '—') return;
  if (!navigator.clipboard) return;
  navigator.clipboard.writeText(value).catch(() => {
    // best-effort — swallow; iframe clipboard policies vary
  });
}

interface RowProps {
  icon: VibeSvgIcon;
  label: string;
  value: ReactNode;
}

function Row({ icon: Icon, label, value }: RowProps) {
  return (
    <Flex gap="small" align="center" style={{ minHeight: 22 }}>
      <Icon style={{ width: 16, height: 16, color: 'var(--secondary-text-color, #676879)', flexShrink: 0 }} />
      <Text type="text2" color="secondary" style={{ marginRight: 4 }}>{label}</Text>
      <span>{value}</span>
    </Flex>
  );
}

interface DiagRowProps {
  label: string;
  value: string;
}

function DiagRow({ label, value }: DiagRowProps) {
  const display = value || '—';
  const canCopy = display !== '—';
  return (
    <Flex
      justify="space-between"
      align="center"
      style={{ padding: '4px 0', borderBottom: '1px solid var(--layout-border-color, #e6e9ef)' }}
    >
      <Text type="text2" color="secondary">{label}</Text>
      <Flex gap="xs" align="center">
        <Text type="text2"><code style={{ fontFamily: 'monospace' }}>{display}</code></Text>
        <Tooltip content="Copy">
          <IconButton
            icon={TextCopy}
            size="xs"
            kind="tertiary"
            ariaLabel={`Copy ${label}`}
            disabled={!canCopy}
            hideTooltip
            onClick={() => copy(display)}
          />
        </Tooltip>
      </Flex>
    </Flex>
  );
}

export function AboutTab({ context, me, isOwner, objectId, policy }: Props) {
  const name = me?.name || context?.user?.name || '—';
  const email = me?.email || '';
  const accountName = me?.account?.name || me?.account?.slug || '—';

  const userId = String(me?.id || context?.user?.id || '');
  const accountId = String(me?.account?.id || context?.account?.id || '');
  const policyUpdated = policy?.updatedAt
    ? new Date(policy.updatedAt).toISOString()
    : '—';

  return (
    <Section title="About Calendar Sync" hint="One-way sync from Google Calendar to a monday.com board, per user.">
      <Flex direction="column" gap="small" style={{ marginBottom: 16 }}>
        <Row
          icon={Person}
          label="Signed in as"
          value={
            <span>
              <strong>{name}</strong>
              {email && <span style={{ color: '#676879' }}> · {email}</span>}
            </span>
          }
        />
        <Row
          icon={Work}
          label="Account"
          value={<strong>{accountName}</strong>}
        />
        <Row
          icon={Security}
          label="Role"
          value={<strong>{isOwner ? 'Owner (can edit policy)' : 'Member'}</strong>}
        />
      </Flex>

      <Text type="text2" color="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Only the owner of the Custom Object instance can edit the shared policy (board &amp; mapping).
        Every user manages their own Google connection.
      </Text>

      <Link
        text="Developer docs"
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
      />

      <div style={{ marginTop: 16 }}>
        <ExpandCollapse title="Diagnostics" defaultOpenState={false} hideBorder>
          <div style={{ paddingTop: 4 }}>
            <DiagRow label="Object ID" value={objectId} />
            <DiagRow label="User ID" value={userId} />
            <DiagRow label="Account ID" value={accountId} />
            <DiagRow label="App version" value={APP_VERSION} />
            <DiagRow label="Policy updated" value={policyUpdated} />
          </div>
        </ExpandCollapse>
      </div>
    </Section>
  );
}
