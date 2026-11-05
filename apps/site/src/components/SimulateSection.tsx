import { SimulateForm, type FormDevelopment } from './SimulateForm';
import { issueFormToken } from '@/lib/form-token';
import { formSecret } from '@/lib/server';

/** Bloco "Simule sua condição": texto à esquerda, formulário à direita. Emite o token do tempo de preenchimento. */
export function SimulateSection({ developments, fixed, id = 'simule' }: { developments: FormDevelopment[]; fixed?: string; id?: string }) {
  return (
    <section id={id} className="simulate on-dark">
      <div className="wrap">
        <div>
          <span className="mark-bar" />
          <h2>Simule sua condição</h2>
          <p className="lead" style={{ marginTop: 20 }}>
            Conte um pouco sobre você e a gente continua a conversa pelo WhatsApp: à vista, entrada de uma vez com financiamento do saldo ou entrada parcelada com a construtora.
          </p>
          <p className="muted">Leva uns 5 minutos. Sem compromisso.</p>
        </div>
        <SimulateForm developments={developments} {...(fixed ? { fixed } : {})} token={issueFormToken(formSecret())} />
      </div>
    </section>
  );
}
