import type { ReactNode } from 'react';

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title ? (
        <div className="card-h b">
          <h2 className="grow">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className="card-b">{children}</div>
    </section>
  );
}
