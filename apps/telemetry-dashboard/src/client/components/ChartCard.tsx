// Panel shell: a titled surface card every chart sits in. Keeps the grid
// consistent and gives each panel a heading, optional subtitle, and a slot for
// a legend or note.

import type { ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  wide?: boolean;
  right?: ReactNode;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, wide, right, children }: ChartCardProps) {
  return (
    <section className={`card${wide ? ' card--wide' : ''}`}>
      <header className="card__head">
        <div>
          <h2 className="card__title">{title}</h2>
          {subtitle && <p className="card__subtitle">{subtitle}</p>}
        </div>
        {right && <div className="card__right">{right}</div>}
      </header>
      <div className="card__body">{children}</div>
    </section>
  );
}
