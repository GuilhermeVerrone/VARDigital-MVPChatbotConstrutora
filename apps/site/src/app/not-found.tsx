import Link from 'next/link';

export default function NotFound() {
  return (
    <section>
      <div className="wrap">
        <h1 style={{ fontSize: 'clamp(2.2rem, 5vw, 3.6rem)' }}>Página não encontrada</h1>
        <p className="lead" style={{ marginTop: 20 }}>Esse endereço não existe ou o empreendimento não está mais no ar.</p>
        <div className="actions"><Link className="btn" href="/">Voltar ao início</Link></div>
      </div>
    </section>
  );
}
