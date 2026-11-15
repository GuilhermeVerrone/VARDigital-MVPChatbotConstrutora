import Link from 'next/link';
import { Conversa } from '@/componentes/Conversa';
import { FormasDePagamento } from '@/componentes/FormasDePagamento';
import { Icone } from '@/componentes/Icone';
import { Placa } from '@/componentes/Placa';
import { QuadroPainel } from '@/componentes/QuadroPainel';
import { Print, Visor } from '@/componentes/Visor';
import { demoSiteHref, demoWhatsappHref, PRODUTO, vendasHref } from '@/conteudo/config';
import { conversa } from '@/conteudo/conversas';
import { TELAS_PAINEL } from '@/conteudo/painel';

const carla = conversa('carla');
const formas = [conversa('ana'), conversa('bruno'), carla];
const resultadoCarla = carla.mensagens.find((m) => m.de === 'bot' && m.texto.includes('fiz a simulação'))!;
const inicioCarla = carla.mensagens.slice(0, 6);
const cardCorretor = carla.corretor ?? [];

const DUVIDAS: [string, string][] = [
  ['A simulação aprova o crédito do cliente?', 'Não. A simulação é indicativa, e isso aparece na conversa e no PDF. Ela mostra se o plano cabe no que o cliente contou, nas regras da sua construtora, e a estimativa do financiamento. A aprovação continua sendo do banco, e a proposta, do corretor.'],
  ['E se o cliente quiser falar com uma pessoa?', 'Ele pode pedir um corretor a qualquer momento da conversa. O pedido chega para o corretor com o resumo do que já foi conversado, e ele assume dali.'],
  ['Quem muda preços, condições e textos?', 'A sua equipe, pelo painel. Uma condição nova vale a partir da próxima simulação, e toda alteração fica no histórico com o nome de quem fez.'],
  ['Funciona com mais de um empreendimento?', 'Sim. Cada empreendimento tem as próprias unidades, preços e condições comerciais. A demonstração tem três empreendimentos de exemplo.'],
  ['O cliente precisa instalar alguma coisa?', 'Não. Ele conversa pelo WhatsApp que já usa. Quem veio do site recebe a mensagem e só confirma com um "sim".'],
  ['O corretor vê os leads dos colegas?', 'Não. Cada corretor vê só os próprios leads. Gerente e administrador veem todos.'],
  ['E os dados dos compradores?', 'O aceite de privacidade e o de contato vêm desmarcados no formulário e são confirmados de novo no WhatsApp. O comprador pode pedir a exclusão dos dados, e o pedido também pode ser feito pelo painel.'],
  ['Quanto custa?', 'O valor é sob consulta. Fale com a gente para receber uma proposta para a sua construtora.'],
];

export default function Inicio() {
  return (
    <>
      {/* Abertura: o tapume com a promessa, a placa da obra e o visor com a conversa real */}
      <section className="tapume abertura" aria-labelledby="promessa">
        <div className="faixa">
          <div className="abertura-texto">
            <h1 id="promessa" className="promessa">O lead chega ao corretor <em>com a conta feita.</em></h1>
            <p className="apoio">
              O {PRODUTO} atende no WhatsApp quem se interessou pelo seu lançamento, a qualquer hora, faz a simulação nas formas de
              pagamento que a sua construtora vende e passa tudo pronto para o corretor ligar.
            </p>
            <div className="acoes">
              <Link className="botao sinal" href="/testar/">Testar a demonstração<Icone nome="seta" /></Link>
              <Link className="botao contorno" href="#como-funciona">Ver como funciona</Link>
            </div>
          </div>
          <Visor origem="Conversa real do ConstruBot" detalhe="Construtora e valores de exemplo">
            <Conversa mensagens={carla.mensagens} titulo="Elevare Construtora" subtitulo="Carla Dias · Lumen Urban" tocar inicio={1} rotulo="Conversa de exemplo com a compradora Carla" />
          </Visor>
          <div className="abertura-placa">
            <Placa
              titulo={PRODUTO}
              comoTitulo={false}
              campos={[
                ['Atende', 'No WhatsApp, inclusive à noite e no fim de semana, quando o cliente chama'],
                ['Faz a conta', 'À vista · entrada + financiamento · entrada parcelada com a construtora'],
                ['Entrega', 'Lead com resumo, parecer e PDF da simulação, direto no WhatsApp do corretor'],
              ]}
              rodape="Simulação indicativa, nas condições que a sua construtora publica. A aprovação do crédito é do banco."
            />
          </div>
        </div>
      </section>

      {/* O problema, pintado direto no tapume */}
      <section className="tapume secao" aria-labelledby="problema">
        <div className="faixa">
          <div className="problema">
          <h2 id="problema" className="secao-titulo">Todo plantão conhece estas cenas.</h2>
          <ul className="avisos">
            <li><Icone nome="aviso" tamanho={34} />O corretor liga e refaz as mesmas perguntas: renda, entrada, FGTS, dívidas.</li>
            <li><Icone nome="aviso" tamanho={34} />Muita conversa termina descobrindo que a conta não fecha.</li>
            <li><Icone nome="aviso" tamanho={34} />O interessado manda mensagem à noite e a resposta só sai no dia seguinte.</li>
          </ul>
          </div>
          <p className="virada">O {PRODUTO} faz essa primeira parte. O corretor entra para vender.</p>
        </div>
      </section>

      {/* Como funciona: quatro painéis */}
      <section id="como-funciona" className="tapume secao" aria-labelledby="como">
        <div className="faixa">
          <div className="secao-cabeca">
            <h2 id="como" className="secao-titulo">Do anúncio ao corretor, em quatro passos.</h2>
            <p className="secao-apoio">Tudo o que aparece aqui saiu do produto funcionando: telas e mensagens reais, com uma construtora de exemplo.</p>
          </div>
          <div className="trilha">
          <span className="trilha-marco" aria-hidden="true">lead</span>
          <ol className="passos" aria-label="O caminho do lead, do interesse ao corretor">
            <li className="passo">
              <div className="passo-texto">
                <span className="passo-numero" aria-hidden="true">1</span>
                <span className="estacao">Interessado</span>
                <h3>O interessado pede a simulação.</h3>
                <p>No site do empreendimento, ele escolhe a planta e deixa nome e WhatsApp em &quot;Simule sua condição&quot;. Os aceites de privacidade e de contato vêm desmarcados, como manda a lei.</p>
              </div>
              <Visor origem="Print real do site de exemplo" detalhe="Formulário do Lumen Urban">
                <Print arquivo="site-formulario" alt="Formulário Simule sua condição com a planta escolhida, nome e WhatsApp preenchidos." />
              </Visor>
            </li>
            <li className="passo">
              <div className="passo-texto">
                <span className="passo-numero" aria-hidden="true">2</span>
                <span className="estacao">Na conversa</span>
                <h3>O {PRODUTO} chama no WhatsApp.</h3>
                <p>O interessado recebe uma mensagem com o nome dele e o empreendimento, no horário que você definir. Responde &quot;sim&quot; e segue com perguntas curtas, uma de cada vez. Quem chama direto pelo WhatsApp é atendido na hora, de dia ou de noite.</p>
              </div>
              <Visor origem="Conversa real do ConstruBot" detalhe="Primeiras mensagens">
                <Conversa mensagens={inicioCarla} titulo="Elevare Construtora" subtitulo="Carla Dias" rotulo="Início da conversa com Carla" />
              </Visor>
            </li>
            <li className="passo">
              <div className="passo-texto">
                <span className="passo-numero" aria-hidden="true">3</span>
                <span className="estacao">Simulado</span>
                <h3>A conta sai na hora, nas suas regras.</h3>
                <p>Com renda, entrada e forma de pagamento, ele monta o plano com as condições que a sua construtora publicou: ato, mensais, reforços, parcela das chaves e a estimativa do banco. E explica o resultado em português claro.</p>
              </div>
              <Visor origem="Conversa real do ConstruBot" detalhe="Resultado da simulação">
                <Conversa mensagens={[resultadoCarla]} titulo="Elevare Construtora" subtitulo="Carla Dias" rotulo="Resultado da simulação de Carla" />
              </Visor>
            </li>
            <li className="passo">
              <div className="passo-texto">
                <span className="passo-numero" aria-hidden="true">4</span>
                <span className="estacao">Pronto para o corretor</span>
                <h3>O corretor recebe o lead pronto.</h3>
                <p>No WhatsApp do corretor chegam o resumo do cliente, o plano, o parecer, um próximo passo sugerido e o PDF. Ele liga sabendo o que oferecer.</p>
              </div>
              <Visor origem="Mensagem real recebida pelo corretor" detalhe="Com o PDF anexo">
                <Conversa mensagens={cardCorretor} titulo="ConstruBot" subtitulo="Para: Corretora Elevare Um" rotulo="Resumo do lead recebido pelo corretor" />
              </Visor>
            </li>
          </ol>
          </div>
        </div>
      </section>

      {/* As três formas de pagamento */}
      <section id="formas" className="tapume secao" aria-labelledby="formas-titulo">
        <div className="faixa">
          <div className="secao-cabeca">
            <h2 id="formas-titulo" className="secao-titulo">As três formas que a sua construtora vende.</h2>
            <p className="secao-apoio">Cada compradora de exemplo escolheu uma forma de pagamento. Escolha uma e leia a conversa inteira, do primeiro &quot;sim&quot; ao resultado.</p>
          </div>
          <FormasDePagamento personas={formas} />
        </div>
      </section>

      {/* O que o corretor recebe */}
      <section className="sobre-chapa secao" aria-labelledby="corretor-titulo">
        <div className="faixa corretor">
          <div>
            <h2 id="corretor-titulo" className="secao-titulo">O corretor liga sabendo o que oferecer.</h2>
            <p className="secao-apoio">O {PRODUTO} prepara. Quem fecha continua sendo o corretor.</p>
            <ul className="lista-pintada">
              <li><Icone nome="check" />Resumo do cliente: renda, compradores, parcelas que já paga, empreendimento e unidade.</li>
              <li><Icone nome="check" />O plano completo da forma de pagamento escolhida e o parecer: viável, viável com ajustes ou inviável.</li>
              <li><Icone nome="check" />Os pontos de atenção e um próximo passo sugerido.</li>
              <li><Icone nome="check" />O PDF da simulação, o mesmo que o cliente pode receber.</li>
              <li><Icone nome="check" />No painel, o corretor vê só os próprios leads e pode assumir a conversa.</li>
            </ul>
          </div>
          <Visor origem="PDF real da simulação" detalhe="Gerado pelo ConstruBot para a Carla">
            <Print arquivo="pdf-simulacao" alt="Primeira página do PDF da simulação da Carla: imóvel, forma de pagamento, plano da entrada, capacidade de pagamento, estimativa do financiamento e aviso legal." />
          </Visor>
        </div>
      </section>

      {/* O painel */}
      <section id="painel" className="tapume secao" aria-labelledby="painel-titulo">
        <div className="faixa">
          <div className="secao-cabeca">
            <h2 id="painel-titulo" className="secao-titulo">As regras do jogo ficam com a sua equipe.</h2>
            <p className="secao-apoio">Preços, condições comerciais, textos do atendimento e equipe: tudo num painel, sem depender de programador.</p>
          </div>
          <QuadroPainel telas={TELAS_PAINEL} />
          <p style={{ marginTop: 32 }}><Link className="botao contorno" href="/funcionalidades/">Ver todas as funcionalidades<Icone nome="seta" /></Link></p>
        </div>
      </section>

      {/* Cuidado com os dados e implantação */}
      <section className="tapume secao" aria-labelledby="cuidado-titulo">
        <div className="faixa">
          <div className="secao-cabeca">
            <h2 id="cuidado-titulo" className="secao-titulo">Pronto para ir para a rua.</h2>
            <p className="secao-apoio">Cuidado com os dados do comprador desde a primeira mensagem, e uma implantação que pede pouco da sua equipe.</p>
          </div>
          <div className="placas-duplas">
            <Placa
              titulo="Privacidade do comprador"
              campos={[
                ['Aceite', 'Desmarcado no formulário e confirmado de novo no WhatsApp'],
                ['Só o necessário', 'Perguntas curtas, apenas o que a simulação usa'],
                ['Exclusão', 'O comprador pede pelo WhatsApp; a equipe também pode pedir pelo painel'],
                ['Histórico', 'Cada alteração no painel com nome, data e o que mudou'],
              ]}
            />
            <Placa titulo="Como colocamos no ar">
              <div className="placa-corpo">
                <ol className="etapas">
                  <li><span><strong>Você nos passa as regras.</strong>Tabela de vendas, condições comerciais, os corretores e o número de WhatsApp do atendimento.</span></li>
                  <li><span><strong>Configuramos e testamos juntos.</strong>A sua equipe conversa com o {PRODUTO} e confere cada forma de pagamento antes de abrir.</span></li>
                  <li><span><strong>Liga no site e nos anúncios.</strong>O formulário e o link do WhatsApp passam a cair no {PRODUTO}, e os leads chegam aos corretores.</span></li>
                </ol>
              </div>
            </Placa>
          </div>
        </div>
      </section>

      {/* Teste você mesmo */}
      <section id="teste" className="tapume secao" aria-labelledby="teste-titulo">
        <div className="faixa">
          <div className="secao-cabeca">
            <h2 id="teste-titulo" className="secao-titulo">Teste com o seu celular.</h2>
            <p className="secao-apoio">A demonstração está aberta. Em cinco minutos você vive o que o seu comprador vai viver.</p>
          </div>
          <ol className="teste">
            <li>
              <span className="passo-numero" aria-hidden="true">1</span>
              <h3>Abra o site de exemplo.</h3>
              <p>Escolha um empreendimento da Elevare, uma construtora fictícia, e uma planta.</p>
            </li>
            <li>
              <span className="passo-numero" aria-hidden="true">2</span>
              <h3>Peça a simulação.</h3>
              <p>Use o seu nome e o seu WhatsApp. A primeira mensagem chega no seu celular.</p>
            </li>
            <li>
              <span className="passo-numero" aria-hidden="true">3</span>
              <h3>Converse e veja o resultado.</h3>
              <p>Responda como um comprador. No fim, peça o PDF ou um corretor.</p>
            </li>
          </ol>
          <div className="acoes">
            <a className="botao sinal" href={demoSiteHref()}>Abrir o site de exemplo<Icone nome="seta" /></a>
            <a className="botao contorno" href={demoWhatsappHref()}>Começar pelo WhatsApp<Icone nome="balao" /></a>
            <Link href="/testar/" style={{ fontWeight: 600 }}>Roteiro completo de teste</Link>
          </div>
        </div>
      </section>

      {/* Dúvidas */}
      <section id="duvidas" className="tapume secao" aria-labelledby="duvidas-titulo">
        <div className="faixa">
          <h2 id="duvidas-titulo" className="secao-titulo">Perguntas de quem decide.</h2>
          <div className="placa duvidas">
            {DUVIDAS.map(([p, r]) => (
              <details key={p}>
                <summary>{p}<Icone nome="mais" /></summary>
                <p>{r}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Fecho */}
      <section className="tapume fecho" aria-labelledby="fecho-titulo">
        <div className="faixa">
          <h2 id="fecho-titulo">Seu plantão de vendas, <em>aberto no WhatsApp.</em></h2>
          <div className="acoes">
            <Link className="botao sinal" href="/testar/">Testar a demonstração<Icone nome="seta" /></Link>
            <a className="botao contorno" href={vendasHref()}>Falar com a gente</a>
          </div>
        </div>
      </section>
    </>
  );
}
