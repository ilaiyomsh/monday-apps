interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <header style={{ marginBottom: 20 }}>
      <h1
        style={{
          margin: '0 0 4px 0',
          fontSize: 'var(--font-size-h1, 24px)',
          fontFamily: 'var(--font-display, inherit)',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--primary-text-color, #323338)',
        }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          style={{
            margin: 0,
            color: 'var(--secondary-text-color, #676879)',
            fontSize: 'var(--font-size-text2, 13px)',
          }}
        >
          {subtitle}
        </p>
      )}
    </header>
  );
}
