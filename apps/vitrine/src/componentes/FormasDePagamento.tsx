'use client';

import type { Conversa as ConversaDados } from '@/conteudo/conversas';
import { ListaDeAbas, useAbas } from './Abas';
import { Conversa } from './Conversa';
import { Placa } from './Placa';
import { Visor } from './Visor';

const RECEBE: Record<string, string> = {
  ana: 'Preço com desconto à vista e o total a pagar.',
  bruno: 'A entrada, o saldo e a estimativa do financiamento do banco.',
  carla: 'Ato, mensais, parcela das chaves e o saldo a financiar.',
};

/** As três formas de pagamento, cada uma com a conversa real de uma compradora de exemplo. */
export function FormasDePagamento({ personas }: { personas: ConversaDados[] }) {
  const { atual, aba, painel } = useAbas(personas.length);
  const p = personas[atual]!;
  const perguntas = p.mensagens.filter((m) => m.de === 'lead').length;
  return (
    <div className="formas">
      <div>
        <ListaDeAbas rotulo="Formas de pagamento" className="formas-abas">
          {personas.map((x, i) => (
            <button key={x.id} className="aba" {...aba(i)}>
              <span className="aba-num" aria-hidden="true">{i + 1}</span>
              <span className="aba-modo">{x.modo}</span>
              <span className="aba-quem">{x.nome}. {x.resumo}</span>
            </button>
          ))}
        </ListaDeAbas>
        <Placa
          titulo={p.nome}
          campos={[
            ['Forma', p.modo],
            ['Respondeu', `${perguntas} mensagens curtas, sem sair do WhatsApp`],
            ['Recebeu', RECEBE[p.id] ?? 'O resultado da simulação.'],
            ['Depois', 'O corretor foi avisado com o resumo e o PDF.'],
          ]}
        />
      </div>
      <div {...painel}>
        <Visor origem="Conversa real do ConstruBot" detalhe="Construtora e valores de exemplo">
          <Conversa key={p.id} mensagens={p.mensagens} titulo={`${p.nome} · Lumen Urban`} subtitulo={p.modo} rotulo={`Conversa de ${p.nome}`} />
        </Visor>
      </div>
    </div>
  );
}
