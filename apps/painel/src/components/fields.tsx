import type { ReactNode } from 'react';

export function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string | undefined; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {hint ? <span className="hint" id={`${name}-hint`}>{hint}</span> : null}
      {error ? <span className="error" id={`${name}-error`} role="alert">{error}</span> : null}
    </div>
  );
}

const aria = (name: string, hint?: string, error?: string) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': [hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ') || undefined,
});

interface Common { name: string; label: string; error?: string | undefined; hint?: string | undefined; disabled?: boolean | undefined; defaultValue?: string | number | undefined }

export function TextField({ name, label, error, hint, disabled, defaultValue, type = 'text', inputMode, required }: Common & { type?: string; inputMode?: 'decimal' | 'numeric' | 'tel' | 'email'; required?: boolean }) {
  return (
    <Field label={label} name={name} error={error} hint={hint}>
      <input id={name} name={name} type={type} inputMode={inputMode} defaultValue={defaultValue} disabled={disabled} required={required} autoComplete="off" {...aria(name, hint, error)} />
    </Field>
  );
}

export function SelectField({ name, label, error, hint, disabled, defaultValue, options }: Common & { options: readonly { value: string; label: string }[] }) {
  return (
    <Field label={label} name={name} error={error} hint={hint}>
      <select id={name} name={name} defaultValue={defaultValue} disabled={disabled} {...aria(name, hint, error)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function CheckField({ name, label, hint, disabled, defaultChecked, value = 'on' }: { name: string; label: string; hint?: string | undefined; disabled?: boolean | undefined; defaultChecked?: boolean | undefined; value?: string }) {
  return (
    <div className="field check">
      <label htmlFor={`${name}-${value}`}>
        <input id={`${name}-${value}`} name={name} type="checkbox" value={value} defaultChecked={defaultChecked} disabled={disabled} />
        <span>{label}</span>
      </label>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: ReactNode }) {
  return <p className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>;
}

export function PageHeader({ title, children, back }: { title: string; children?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="page-head">
      {back ? <a className="back" href={back.href}>← {back.label}</a> : null}
      <div className="row">
        <h1>{title}</h1>
        <div className="actions">{children}</div>
      </div>
    </header>
  );
}
