import Image from 'next/image';
import Link from 'next/link';
import { listPublishedDevelopments } from '@mvp/db/site';
import { SimulateSection } from '@/components/SimulateSection';
import { areaLabel, brl, deliveryLabel } from '@/lib/format';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const developments = await listPublishedDevelopments(getDb());
  const hero = developments.find((d) => d.slug === 'altomare') ?? developments[0];

  return (
    <>
      <section className="hero on-dark">
        <div className="wrap">
          <div className="copy">
            <span className="mark-bar" />
            <h1>Cada andar, um passo acima.</h1>
            <p className="lead">A Elevare projeta e constrói residenciais em três linhas: o Lumen para morar perto de tudo, o Parc para viver com espaço e o Altomare para olhar o mar de frente.</p>
            <div className="actions">
              <a className="btn" href="#simule">Simule sua condição</a>
              <a className="btn ghost" href="#empreendimentos">Conhecer os empreendimentos</a>
            </div>
          </div>
          {hero?.heroImage ? (
            <figure>
              <Image src={hero.heroImage} alt={`Ilustração da fachada do ${hero.name}`} width={1600} height={1000} priority sizes="(max-width: 960px) 100vw, 45vw" />
              <figcaption>{hero.name} · {hero.city} · imagem ilustrativa</figcaption>
            </figure>
          ) : null}
        </div>
      </section>

      <section id="empreendimentos">
        <div className="wrap">
          <div className="section-head">
            <h2>Três empreendimentos,<br />nove plantas</h2>
            <p className="muted">Entre em cada um para ver plantas, metragens, diferenciais e o preço a partir de.</p>
          </div>
          {developments.map((d) => (
            <article className="dev" key={d.slug}>
              <Link className="dev-img" href={`/empreendimentos/${d.slug}`} aria-label={`Ver ${d.name}`}>
                {d.heroImage ? <Image src={d.heroImage} alt={`Ilustração da fachada do ${d.name}`} width={1600} height={1000} sizes="(max-width: 960px) 100vw, 58vw" /> : null}
              </Link>
              <div className="dev-info">
                <h3>{d.name}</h3>
                <p className="muted" style={{ margin: 0 }}>{d.city}</p>
                <p style={{ marginTop: 16 }}>{d.description.split('. ')[0]}.</p>
                <dl className="facts">
                  {d.typologies.length ? (<><dt>Plantas</dt><dd>{areaLabel(Math.min(...d.typologies.map((t) => t.minArea)), Math.max(...d.typologies.map((t) => t.maxArea)))}</dd></>) : null}
                  <dt>Entrega</dt><dd>{deliveryLabel(d.deliveryDate)}</dd>
                  {d.fromPrice !== null ? (<><dt>A partir de</dt><dd className="price">{brl(d.fromPrice)}</dd></>) : null}
                </dl>
                <Link className="btn" href={`/empreendimentos/${d.slug}`}>Ver {d.name}</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="sobre" className="on-lime">
        <div className="wrap about">
          <div>
            <h2>Obra com método, entrega no prazo.</h2>
            <p className="lead" style={{ marginTop: 24 }}>Somos uma construtora de Curitiba que faz poucos prédios por vez, para acompanhar cada um de perto.</p>
            <p>Cada projeto começa pela planta: medimos a circulação, o caminho da luz e o lugar de cada móvel antes de desenhar a fachada. Só depois vem o prédio.</p>
          </div>
          <ol className="timeline">
            <li><strong>1998</strong><span>Fundação em Curitiba, com a primeira obra de 24 apartamentos.</span></li>
            <li><strong>2009</strong><span>Início da linha Parc, com áreas verdes dentro do condomínio.</span></li>
            <li><strong>2018</strong><span>Lançamento do Lumen, a linha de apartamentos compactos urbanos.</span></li>
            <li><strong>2024</strong><span>Primeira torre de frente para o mar, o Altomare.</span></li>
          </ol>
        </div>
      </section>

      <SimulateSection developments={developments.map((d) => ({ slug: d.slug, name: d.name, typologies: d.typologies.map((t) => t.typology) }))} />
    </>
  );
}
