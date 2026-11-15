import type { Metadata } from 'next';
import { Icone } from '@/componentes/Icone';
import { Roteiro } from '@/componentes/Roteiro';
import { demoSiteHref, demoWhatsappHref, PRODUTO, vendasHref } from '@/conteudo/config';
import { ROTEIRO } from '@/conteudo/roteiro';

export const metadata: Metadata = {
  title: 'Teste com o seu celular',
  description: `Roteiro para testar o ${PRODUTO} sozinho: o site de exemplo, a conversa no WhatsApp, as formas de pagamento, o PDF e o pedido de corretor.`,
};

export default function Testar() {
  return (
    <>
      <section className="tapume cabeca-leitura" aria-labelledby="titulo">
        <div className="faixa">
          <h1 id="titulo">Teste com o seu celular.</h1>
          <p>
            Faça o caminho do seu comprador, do formulário ao resultado. A construtora, os preços e o corretor são de exemplo; a conversa e
            as contas são as do {PRODUTO} de verdade. Dá para parar e voltar depois: a página lembra onde você estava.
          </p>
          {demoSiteHref() || demoWhatsappHref() ? (
            <div className="acoes">
              {demoSiteHref() ? <a className="botao sinal" href={demoSiteHref()!}>Abrir o site de exemplo<Icone nome="seta" /></a> : null}
              {demoWhatsappHref() ? <a className="botao contorno" href={demoWhatsappHref()!}>Começar pelo WhatsApp<Icone nome="balao" /></a> : null}
            </div>
          ) : null}
        </div>
      </section>
      <div className="tapume leitura">
        <div className="faixa" style={{ display: 'block', maxWidth: 860 }}>
          <Roteiro etapas={ROTEIRO} />
          {vendasHref() ? (
            <p className="roteiro-fim">
              Ficou alguma dúvida ou quer ver com as regras da sua construtora? <a href={vendasHref()!}>Fale com a gente</a>.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
