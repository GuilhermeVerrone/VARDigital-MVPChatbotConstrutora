import type { Metadata } from 'next';
import { LEGAL_STATUS, OPTIN_TEXT, PRIVACY_TEXT } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacidade' };

export default function PrivacyPage() {
  return (
    <section>
      <div className="wrap prose">
        <h1 style={{ fontSize: 'clamp(2.2rem, 5vw, 3.6rem)' }}>Privacidade</h1>
        <p className="muted small">{LEGAL_STATUS}</p>
        <h2>O que guardamos</h2>
        <p>Nome, WhatsApp, e-mail (se você informar), o empreendimento de interesse e as respostas da simulação. Não pedimos CPF, RG, senha nem dados de cartão.</p>
        <h2>Consentimento</h2>
        <p>{PRIVACY_TEXT}</p>
        <h2>Contato por WhatsApp</h2>
        <p>{OPTIN_TEXT} A primeira mensagem só pergunta se foi você quem pediu a simulação. Se a resposta for “não”, não escrevemos mais.</p>
        <h2>Seus direitos</h2>
        <p>Você pode pedir a exclusão dos seus dados a qualquer momento, pelo próprio WhatsApp (“apagar meus dados”) ou pelo contato no rodapé.</p>
      </div>
    </section>
  );
}
