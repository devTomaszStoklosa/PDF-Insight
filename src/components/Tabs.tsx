import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

interface TabsProps {
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly tabs: readonly TabDefinition[];
}

/** WAI-ARIA tabs: arrow keys, Home and End move between tabs; Tab moves into the panel. */
export function Tabs({ label, tabs }: TabsProps) {
  const baseId = useId();
  const [selectedId, setSelectedId] = useState(tabs[0]?.id);

  const tabElementId = (id: string): string => `${baseId}-tab-${id}`;
  const panelElementId = (id: string): string => `${baseId}-panel-${id}`;

  function select(index: number): void {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (tab === undefined) {
      return;
    }
    setSelectedId(tab.id);
    document.getElementById(tabElementId(tab.id))?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const targets: Partial<Record<string, number>> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = targets[event.key];
    if (target !== undefined) {
      event.preventDefault();
      select(target);
    }
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selectedId;
          return (
            <button
              key={tab.id}
              id={tabElementId(tab.id)}
              className="tabs__tab"
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={panelElementId(tab.id)}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                setSelectedId(tab.id);
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, index);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={panelElementId(tab.id)}
          className="tabs__panel"
          role="tabpanel"
          aria-labelledby={tabElementId(tab.id)}
          hidden={tab.id !== selectedId}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA tabs pattern: Tab moves into the panel
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
