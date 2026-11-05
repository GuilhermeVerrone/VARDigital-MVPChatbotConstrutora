import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getPublishedDevelopment } from '@mvp/db/site';
import { SimulateSection } from '@/components/SimulateSection';
import { areaLabel, brl, deliveryLabel } from '@/lib/format';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getPublishedDevelopment(getDb(), (await params).slug);
  return d ? { title: d.name, description: `${d.name} em ${d.city}. ${d.description.split('. ')[0]}.` } : {};
}

export default async function DevelopmentPage({ params }: Props) {
  const d = await getPublishedDevelopment(getDb(), (await params).slug);
  if (!d) notFound();
  const plans = d.gallery.filter((g) => g.url !== d.heroImage);

  return (
    <>
      <section className="dev-hero">
        <div className="wrap">
          <div className="top">
            <div>
              <h1>{d.name}</h1>
              <p className="where">{d.address ?? d.city}</p>
            </div>
            <a className="btn" href="#simule">Simule sua condição</a>
          </div>
          {d.heroImage ? <Image className="cover" src={d.heroImage} alt={`Ilustração da fachada do ${d.name}`} width={1600} height={860} priority sizes="(max-width: 1248px) 100vw, 1200px" /> : null}
          <dl className="spec-bar">
            {d.fromPrice !== null ? <div><dt>A partir de</dt><dd>{brl(d.fromPrice)}</dd></div> : null}
            {d.typologies.length ? <div><dt>Plantas</dt><dd>{areaLabel(Math.min(...d.typologies.map((t) => t.minArea)), Math.max(...d.typologies.map((t) => t.maxArea)))}</dd></div> : null}
            <div><dt>Entrega</dt><dd>{deliveryLabel(d.deliveryDate)}</dd></div>
            <div><dt>Cidade</dt><dd>{d.city}</dd></div>
          </dl>
        </div>
      </section>

      <section>
        <div className="wrap two-col">
          <div>
            <h2>Sobre o empreendimento</h2>
            <p className="lead" style={{ marginTop: 24 }}>{d.description}</p>
          </div>
          {d.highlights.length ? (
            <ul className="amenities" aria-label="Diferenciais">
              {d.highlights.map((h) => <li key={h}>{h}</li>)}
            </ul>
          ) : null}
        </div>
      </section>

      {d.typologies.length ? (
        <section style={{ paddingTop: 0 }}>
          <div className="wrap">
            <h2 style={{ marginBottom: 32 }}>Plantas e preços</h2>
            <div className="table-wrap">
              <table>
                <caption className="sr-only" style={{ position: 'absolute', left: -9999 }}>Plantas disponíveis e preço a partir de</caption>
                <thead><tr><th scope="col">Planta</th><th scope="col">Metragem</th><th scope="col">Unidades</th><th scope="col">A partir de</th></tr></thead>
                <tbody>
                  {d.typologies.map((t) => (
                    <tr key={t.typology}>
                      <td>{t.typology}</td>
                      <td>{areaLabel(t.minArea, t.maxArea)}</td>
                      <td>{t.available}</td>
                      <td>{brl(t.fromPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: 16 }}>Valores {d.dataStatus === 'ILUSTRATIVO' ? 'ilustrativos, ' : ''}sujeitos a confirmação e disponibilidade.</p>
          </div>
        </section>
      ) : null}

      {plans.length ? (
        <section style={{ paddingTop: 0 }}>
          <div className="wrap">
            <h2 style={{ marginBottom: 32 }}>Plantas e galeria</h2>
            <div className="gallery">
              {plans.map((g) => (
                <figure key={g.url}>
                  <Image src={g.url} alt={g.alt} width={800} height={600} loading="lazy" sizes="(max-width: 600px) 100vw, 400px" />
                  <figcaption>{g.alt} · imagem ilustrativa</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <SimulateSection developments={[{ slug: d.slug, name: d.name, typologies: d.typologies.map((t) => t.typology) }]} fixed={d.slug} />
    </>
  );
}
