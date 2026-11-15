import Link from 'next/link';
import { Icone } from '@/componentes/Icone';

export default function NaoEncontrada() {
  return (
    <section className="tapume cabeca-leitura" aria-labelledby="titulo" style={{ minHeight: '60vh' }}>
      <div className="faixa">
        <h1 id="titulo">Esta página não está nesta obra.</h1>
        <p>O endereço pode ter mudado. Volte para o início ou vá direto ao teste.</p>
        <div className="acoes">
          <Link className="botao sinal" href="/">Voltar ao início<Icone nome="seta" /></Link>
          <Link className="botao contorno" href="/testar/">Testar a demonstração</Link>
        </div>
      </div>
    </section>
  );
}
