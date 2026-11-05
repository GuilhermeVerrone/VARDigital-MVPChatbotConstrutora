'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { Notice } from '@/components/fields';
import { sendSimulatorAction, startSimulatorAction } from './actions';

// O estado da conversa (snapshot) vive aqui e vai ao servidor a cada mensagem; o servidor não guarda nada.

interface Msg { from: 'bot' | 'lead' | 'system'; text: string; options?: string[]; locked?: boolean }
interface Turn { snapshot: unknown; messages: Msg[]; state: string; collected: Record<string, unknown>; effects: string[]; ended: boolean; flowLabel: string }

const LABEL: Record<string, string> = {
  name: 'Nome', phone: 'Telefone', email: 'E-mail', typology: 'Tipologia', income: 'Renda', incomeType: 'Tipo de renda', birthDate: 'Nascimento', debts: 'Parcelas',
  hasCoApplicant: 'Compra junto', coIncome: 'Renda 2º comprador', downPayment: 'Entrada', desiredInstallment: 'Parcela desejada', hasFgts: 'FGTS', fgtsBalance: 'Saldo FGTS',
  fgtsMonths: 'Meses FGTS', ownsProperty: 'Tem imóvel', firstFinancing: '1º financiamento', paymentMode: 'Forma de pagamento', cashNow: 'Dinheiro hoje', acceptsBalloons: 'Aceita reforços',
  developmentId: 'Empreendimento (id)',
};
const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'sim' : 'não') : v === null ? '—' : String(v));

export function Simulator({ developments, hasDraft, hasPublished }: { developments: { id: string; name: string }[]; hasDraft: boolean; hasPublished: boolean }) {
  const [source, setSource] = useState<'draft' | 'published'>(hasDraft || !hasPublished ? 'draft' : 'published');
  const [entry, setEntry] = useState<'WHATSAPP' | 'FORM'>('WHATSAPP');
  const [dev, setDev] = useState(developments[0]?.id ?? '');
  const [log, setLog] = useState<Msg[]>([]);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [log]);

  function begin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await startSimulatorAction({ source, entry, developmentId: (dev === 'ask' ? '' : dev) || (entry === 'FORM' ? (developments[0]?.id ?? '') : '') });
      if (r.error) return setError(r.error);
      setTurn(r.turn as unknown as Turn);
      setLog(r.turn!.messages as Msg[]);
    });
  }

  function send(e: FormEvent) {
    e.preventDefault();
    if (!turn || !text.trim() || pending) return;
    const sent = text;
    setText('');
    setError(null);
    start(async () => {
      const r = await sendSimulatorAction({ source, snapshot: turn.snapshot, text: sent });
      if (r.error) return setError(r.error);
      setTurn(r.turn as unknown as Turn);
      setLog((l) => [...l, ...(r.turn!.messages as Msg[])]);
    });
  }

  return (
    <div className="sim">
      <div className="sim-main">
        <form onSubmit={begin} className="filters" aria-label="Iniciar conversa">
          <label>Fluxo
            <select value={source} onChange={(e) => setSource(e.target.value as 'draft' | 'published')}>
              <option value="draft">Rascunho{hasDraft ? '' : ' (não há; usa a publicada)'}</option>
              <option value="published">Versão publicada</option>
            </select>
          </label>
          <label>Começar por
            <select value={entry} onChange={(e) => setEntry(e.target.value as 'WHATSAPP' | 'FORM')}>
              <option value="WHATSAPP">WhatsApp (lead escreve primeiro)</option>
              <option value="FORM">Formulário do site (1ª mensagem do bot)</option>
            </select>
          </label>
          <label>Empreendimento
            <select value={dev} onChange={(e) => setDev(e.target.value)}>
              {entry === 'WHATSAPP' ? <option value="ask">O bot pergunta</option> : null}
              {developments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <button className="btn" type="submit" disabled={pending}>{turn ? 'Reiniciar' : 'Iniciar conversa'}</button>
        </form>
        {error ? <Notice kind="error">{error}</Notice> : null}

        <div className="chat sim-chat" role="log" aria-label="Conversa simulada" aria-live="polite" tabIndex={0}>
          {log.length === 0 ? <p className="muted">Inicie uma conversa para ver o bot responder. Nada é gravado e nenhuma mensagem sai pelo WhatsApp.</p> : null}
          {log.map((m, i) => (
            <div key={i} className={m.from === 'system' ? 'sys' : m.from === 'lead' ? 'msg lead' : 'msg bot'}>
              {m.from === 'system' ? <span className="small muted">{m.text}</span> : (
                <>
                  <span className="bubble">{m.locked ? <span className="badge muted">Bloco legal travado</span> : null}{m.locked ? ' ' : ''}{m.text}
                    {m.options ? <ol className="opts">{m.options.map((o) => <li key={o}>{o}</li>)}</ol> : null}
                  </span>
                </>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="inline-form" aria-label="Enviar mensagem">
          <label className="grow"><span className="sr">Mensagem do lead</span>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={turn ? (turn.ended ? 'Conversa encerrada: reinicie para testar de novo' : 'Responda como o lead…') : 'Inicie a conversa primeiro'} disabled={!turn || turn.ended || pending} maxLength={1000} autoComplete="off" />
          </label>
          <button className="btn" type="submit" disabled={!turn || turn.ended || pending || !text.trim()}>{pending ? 'Enviando…' : 'Enviar'}</button>
        </form>
        <p className="muted small">Sem inteligência artificial: o simulador entende só o que os leitores de respostas entendem (números, valores, sim/não, opções). Use respostas objetivas.</p>
      </div>

      <aside className="sim-side" aria-label="Estado da conversa">
        <h2>Estado</h2>
        {turn ? (
          <>
            <dl>
              <div className="kv"><dt>Etapa atual</dt><dd>{turn.state}</dd></div>
              <div className="kv"><dt>Fluxo</dt><dd>{turn.flowLabel}</dd></div>
            </dl>
            <h3>Dados coletados</h3>
            {Object.keys(turn.collected).length === 0 ? <p className="muted small">Nada ainda.</p> : (
              <dl>{Object.entries(turn.collected).map(([k, v]) => <div className="kv" key={k}><dt>{LABEL[k] ?? k}</dt><dd>{show(v)}</dd></div>)}</dl>
            )}
            {turn.effects.length > 0 ? (
              <><h3>No bot real, este turno…</h3><ul className="small">{turn.effects.map((e) => <li key={e}>{e}</li>)}</ul></>
            ) : null}
            {turn.ended ? <p className="notice info">Conversa encerrada ({turn.state}).</p> : null}
          </>
        ) : <p className="muted small">Aparece aqui depois de iniciar.</p>}
      </aside>
    </div>
  );
}
