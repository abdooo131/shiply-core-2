import { useId, type InputHTMLAttributes } from 'react';

export function Field({
  label,
  hint,
  error,
  className,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const inputClass = ['input', error && 'err', className].filter(Boolean).join(' ');
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {hint ? <span className="hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="err-msg" id={errorId}>{error}</span> : null}
    </div>
  );
}
