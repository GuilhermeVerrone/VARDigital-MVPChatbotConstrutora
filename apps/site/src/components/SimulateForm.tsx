'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { simulate, type FormState } from '@/app/actions';
// Textos exibidos ao lado das caixas: os mesmos gravados como snapshot do consentimento.
import { OPTIN_TEXT as OPTIN, PRIVACY_TEXT as PRIVACY } from '@/lib/legal';

export interface FormDevelopment {
  slug: string;
  name: string;
  typologies: string[];
}

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

/** UTM da URL atual; sem elas, as da primeira visita nesta sessão (a pessoa pode ter navegado até aqui). */
function readUtm(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = params.get(`utm_${k}`);
      if (v) fromUrl[k] = v.slice(0, 100);
    }
    if (Object.keys(fromUrl).length) {
      sessionStorage.setItem('elv_utm', JSON.stringify(fromUrl));
      return JSON.stringify(fromUrl);
    }
    return sessionStorage.getItem('elv_utm') ?? '';
  } catch {
    return '';
  }
}

const idle: FormState = { status: 'idle' };

export function SimulateForm({ developments, fixed, token }: { developments: FormDevelopment[]; fixed?: string; token: string }) {
  const [state, action, pending] = useActionState(simulate, idle);
  const [slug, setSlug] = useState(fixed ?? developments[0]?.slug ?? '');
  const [utm, setUtm] = useState('');
  useEffect(() => setUtm(readUtm()), []);

  const typologies = useMemo(() => developments.find((d) => d.slug === slug)?.typologies ?? [], [developments, slug]);
  const errors = state.status === 'invalid' ? state.errors : {};
  const message = 'message' in state ? state.message : null;

  return (
    <form action={action} noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="utm" value={utm} />
      {/* Honeypot: invisível para pessoas, tentador para robôs. */}
      <div className="hp" aria-hidden="true">
        <label>Não preencha este campo<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      {message ? <p className="form-error" role="alert">{message}</p> : null}

      <div className="field">
        <label htmlFor="f-name">Nome</label>
        <input id="f-name" name="name" type="text" autoComplete="name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'e-name' : undefined} />
        {errors.name ? <span className="error" id="e-name">{errors.name}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="f-phone">WhatsApp</label>
        <input id="f-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(41) 98888-7777" required aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'e-phone' : 'h-phone'} />
        {errors.phone ? <span className="error" id="e-phone">{errors.phone}</span> : <span className="hint" id="h-phone">Com DDD. É por aqui que vamos conversar.</span>}
      </div>
      <div className="field">
        <label htmlFor="f-email">E-mail <span className="hint">(opcional)</span></label>
        <input id="f-email" name="email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'e-email' : undefined} />
        {errors.email ? <span className="error" id="e-email">{errors.email}</span> : null}
      </div>
      {fixed ? (
        <input type="hidden" name="development" value={fixed} />
      ) : (
        <div className="field">
          <label htmlFor="f-dev">Empreendimento</label>
          <select id="f-dev" name="development" value={slug} onChange={(e) => setSlug(e.target.value)} aria-invalid={Boolean(errors.development)}>
            {developments.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
          </select>
          {errors.development ? <span className="error">{errors.development}</span> : null}
        </div>
      )}
      <div className="field">
        <label htmlFor="f-typ">Tipologia de interesse</label>
        <select id="f-typ" name="typology" defaultValue="">
          <option value="">Ainda não sei</option>
          {typologies.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <label className={`check${errors.consent ? ' has-error' : ''}`}>
        <input type="checkbox" name="consent" aria-invalid={Boolean(errors.consent)} />
        <span>{PRIVACY}</span>
      </label>
      {errors.consent ? <span className="error" role="alert" style={{ display: 'block', marginBottom: 12 }}>{errors.consent}</span> : null}
      <label className={`check${errors.optin ? ' has-error' : ''}`}>
        <input type="checkbox" name="optin" aria-invalid={Boolean(errors.optin)} />
        <span>{OPTIN}</span>
      </label>
      {errors.optin ? <span className="error" role="alert" style={{ display: 'block', marginBottom: 12 }}>{errors.optin}</span> : null}

      <button className="btn" type="submit" disabled={pending}>{pending ? 'Enviando…' : 'Simular minha condição'}</button>
      <p className="form-note">Valores ilustrativos. A simulação é uma estimativa e depende de confirmação da construtora. Você pode pedir a exclusão dos seus dados a qualquer momento.</p>
    </form>
  );
}
