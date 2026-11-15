'use client';

import { useEffect, useRef, useState } from 'react';
import type { Mensagem } from '@/conteudo/conversas';
import { trechos } from '@/conteudo/texto-whatsapp';
import { Icone } from './Icone';

function Texto({ texto }: { texto: string }) {
  return (
    <>
      {texto.split('\n').map((linha, i) => (
        <span key={i}>
          {i > 0 ? '\n' : null}
          {trechos(linha).map((t, j) => (t.b ? <strong key={j}>{t.t}</strong> : t.i ? <em key={j}>{t.t}</em> : <span key={j}>{t.t}</span>))}
        </span>
      ))}
    </>
  );
}

/** Tempo até a próxima mensagem: o lead responde rápido; o bot "digita" conforme o tamanho do texto. */
const pausa = (m: Mensagem) => (m.de === 'lead' ? 700 : 550 + Math.min(m.texto.length * 6, 1500));

/**
 * Conversa real do atendimento. Com `tocar`, as mensagens chegam uma a uma quando o visor entra na tela
 * (sem animação para quem pediu menos movimento); sem `tocar`, aparece inteira.
 */
export function Conversa({ mensagens, titulo, subtitulo, tocar = false, inicio = 1, rotulo }: {
  mensagens: Mensagem[];
  titulo: string;
  subtitulo: string;
  tocar?: boolean;
  /** Quantas mensagens já aparecem antes de tocar. */
  inicio?: number;
  rotulo: string;
}) {
  const [vistas, setVistas] = useState(tocar ? Math.min(inicio, mensagens.length) : mensagens.length);
  const [digitando, setDigitando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const terminou = vistas >= mensagens.length;

  // Começa a tocar quando o visor aparece na tela.
  useEffect(() => {
    if (!tocar) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVistas(mensagens.length);
      return;
    }
    const el = caixa.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setRodando(true);
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [tocar, mensagens.length]);

  useEffect(() => {
    if (!rodando || terminou) return;
    const proxima = mensagens[vistas]!;
    const t1 = setTimeout(() => setDigitando(proxima.de === 'bot'), 250);
    const t2 = setTimeout(() => {
      setDigitando(false);
      setVistas((v) => v + 1);
    }, pausa(proxima));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [rodando, vistas, terminou, mensagens]);

  // Mantém a última mensagem à vista, rolando só dentro do visor.
  useEffect(() => {
    const el = caixa.current;
    if (el && rodando) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [vistas, digitando, rodando]);

  return (
    <>
      <div className="conversa-topo">
        <span className="avatar" aria-hidden="true">E</span>
        <span>{titulo}<small>{subtitulo}</small></span>
        {tocar && terminou && rodando ? (
          <button type="button" className="marca-botao" style={{ marginLeft: 'auto', minHeight: 34 }} onClick={() => { setVistas(Math.min(inicio, mensagens.length)); caixa.current?.scrollTo({ top: 0 }); }}>
            Ver de novo
          </button>
        ) : null}
      </div>
      <div ref={caixa} className="conversa" role="log" aria-label={rotulo} tabIndex={0} data-tocando={rodando ? '' : undefined}>
        {mensagens.map((m, i) => (
          <div key={i} className={`msg ${m.de}${m.arquivo ? ' arquivo' : ''}`} data-oculta={i >= vistas ? '' : undefined}>
            {m.arquivo ? (
              <><Icone nome="documento" /><span>{m.arquivo}</span></>
            ) : (
              <Texto texto={m.texto} />
            )}
          </div>
        ))}
        {digitando ? <div className="digitando" aria-hidden="true"><i /><i /><i /></div> : null}
      </div>
    </>
  );
}
