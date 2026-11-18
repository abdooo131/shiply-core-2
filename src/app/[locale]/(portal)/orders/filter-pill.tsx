'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/ui/button';
import { Icon, type IconName } from '@/ui/icon';
import { PopoverMenu } from './popover-menu';

export type FilterOption = { value: string; label: string };

type BaseDef = { key: string; label: string; icon: IconName; options: FilterOption[] };
export type SingleFilterDef = BaseDef & { kind: 'single'; defaultValue: string };
export type MultiFilterDef = BaseDef & { kind: 'multi'; searchable?: boolean };
export type FilterDef = SingleFilterDef | MultiFilterDef;

// The short text a pill shows for its value; empty when the filter is off (the mockup's fpText).
export function filterValueText(def: FilterDef, value: string | string[]): string {
  if (def.kind === 'multi') {
    const chosen = Array.isArray(value) ? value : [];
    const [firstValue] = chosen;
    if (firstValue === undefined) return '';
    const first = def.options.find((option) => option.value === firstValue)?.label ?? firstValue;
    return chosen.length > 1 ? `${first} +${chosen.length - 1}` : first;
  }
  if (value === def.defaultValue) return '';
  return def.options.find((option) => option.value === value)?.label ?? '';
}

function SingleChoice({ def, value, onPick }: { def: SingleFilterDef; value: string; onPick: (value: string) => void }) {
  return (
    <div className="fp-pop" role="listbox" aria-label={def.label}>
      <div className="fp-title">{def.label}</div>
      {def.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={option.value === value ? 'fp-opt on' : 'fp-opt'}
          onClick={() => onPick(option.value)}
        >
          <span className="fp-radio" />
          <span style={{ flex: 1 }}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function MultiChoice({ def, value, onApply }: { def: MultiFilterDef; value: string[]; onApply: (value: string[]) => void }) {
  const t = useTranslations('ordersList');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onApply(form.getAll('choice').filter((entry): entry is string => typeof entry === 'string'));
  };

  return (
    <form className="fp-pop" onSubmit={submit}>
      <div className="fp-title">{def.label}</div>
      {def.searchable ? (
        <div className="search">
          <Icon name="search" size={15} />
          <input
            type="search"
            className="input"
            placeholder={t('search')}
            aria-label={t('searchIn', { label: def.label })}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      ) : null}
      <div className="fp-list">
        {def.options.map((option) => (
          <label key={option.value} className="fp-opt" hidden={needle !== '' && !option.label.toLowerCase().includes(needle)}>
            <input type="checkbox" className="cb" name="choice" value={option.value} defaultChecked={value.includes(option.value)} />
            <span style={{ flex: 1 }}>{option.label}</span>
          </label>
        ))}
      </div>
      <div className="fp-foot">
        <Button variant="ghost" small onClick={() => onApply([])}>{t('clear')}</Button>
        <Button variant="primary" small type="submit">{t('apply')}</Button>
      </div>
    </form>
  );
}

// One filter pill and its popover: a single choice applies on click, a multi choice on "Apply".
export function FilterPill({
  def,
  value,
  onApply,
}: {
  def: FilterDef;
  value: string | string[];
  onApply: (key: string, value: string | string[]) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const text = filterValueText(def, value);

  const apply = (next: string | string[]) => {
    setIsOpen(false);
    buttonRef.current?.focus();
    onApply(def.key, next);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={text ? 'fpill on' : 'fpill'}
        aria-haspopup="true"
        aria-expanded={isOpen}
        data-testid={`filter-${def.key}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon name={def.icon} size={15} />
        <span>
          {def.label}
          {text ? <>: <b>{text}</b></> : null}
        </span>
        <Icon name="chev" size={14} strokeWidth={2.2} />
      </button>
      {isOpen && buttonRef.current ? (
        <PopoverMenu anchor={buttonRef.current} onClose={close} label={def.label}>
          {def.kind === 'single' ? (
            <SingleChoice def={def} value={typeof value === 'string' ? value : def.defaultValue} onPick={apply} />
          ) : (
            <MultiChoice def={def} value={Array.isArray(value) ? value : []} onApply={apply} />
          )}
        </PopoverMenu>
      ) : null}
    </>
  );
}
