import { useId, type ReactNode } from 'react';

interface InsightSectionProps {
  readonly title: string;
  /** Shown instead of the content when the document has no data for this section. */
  readonly emptyMessage: string;
  readonly isEmpty: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/** A dashboard card with a heading and a message for missing data. */
export function InsightSection({
  title,
  emptyMessage,
  isEmpty,
  className,
  children,
}: InsightSectionProps) {
  const headingId = useId();

  return (
    <section
      className={className === undefined ? 'card insight' : `card insight ${className}`}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className="insight__title">
        {title}
      </h3>
      {isEmpty ? <p className="insight__empty">{emptyMessage}</p> : children}
    </section>
  );
}
