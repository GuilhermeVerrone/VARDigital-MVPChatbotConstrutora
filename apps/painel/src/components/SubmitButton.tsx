'use client';

import { useFormStatus } from 'react-dom';
import type { ComponentProps } from 'react';

export function SubmitButton({ children, pendingLabel = 'Salvando…', variant = 'primary', ...rest }: { pendingLabel?: string; variant?: 'primary' | 'ghost' | 'danger' } & ComponentProps<'button'>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant}`} disabled={pending || rest.disabled} {...rest}>
      {pending ? pendingLabel : children}
    </button>
  );
}
