import { describe, expect, it } from 'vitest';
import {
  applyInterpretation, correctionOptions, firstContactText, formSnapshot, initialSnapshot, interpretStep, replyPreview, resultOptions, tx,
  type Collected, type Effect, type FlowEnv, type PaymentModeId, type Reply, type Snapshot,
} from '../src';

const sales = (over: Partial<{ modes: PaymentModeId[]; bankEstimate: boolean; balloonIntervalMonths: number | null }> = {}) => ({
  modes: ['A_VISTA', 'ENTRADA_A_VISTA', 'ENTRADA_PARCELADA'] as PaymentModeId[],
  bankEstimate: false,
  balloonIntervalMonths: 6,
  ...over,
});
const LUMEN = { id: 'dev-lumen', name: 'Lumen Urban', typologies: [{ id: 'STUDIO', label: 'Studio' }, { id: 'DOIS_Q', label: '2 quartos' }] };
const PARC = { id: 'dev-parc', name: 'Parc Verde', typologies: [{ id: 'TRES_Q', label: '3 quartos' }] };

const mkEnv = (over: Partial<FlowEnv> = {}, s = sales()): FlowEnv => ({
  today: '2026-11-06',
  developmentName: 'Lumen Urban',
  typologies: LUMEN.typologies,
  channelPhone: '5511912345678',
  developments: [{ ...LUMEN, sales: s }, { ...PARC, sales: s }],
  ...over,
});

class Chat {
  snap: Snapshot;
  effects: Effect[] = [];
  last: Reply[] = [];
  private n = 0;
  constructor(public env: FlowEnv, snap: Snapshot = initialSnapshot()) {
    this.snap = snap;
  }
  async say(input: string) {
    const it = await interpretStep(input, this.snap, this.env, {});
    const r = applyInterpretation(this.snap, it, this.env, { messageId: `m${++this.n}`, input, at: '2026-11-06T12:00:00Z' });
    this.snap = r.snapshot;
    this.effects.push(...r.effects);
    this.last = r.replies;
    return this;
  }
  get text() {
    return this.last.map((r) => ('list' in r ? `${r.list.title} ${r.list.options.join('|')}` : replyPreview(r))).join('\n');
  }
}

/** WhatsApp: nome, telefone do chat, e-mail pulado, empreendimento e tipologia. */
async function untilMode(c: Chat) {
  await c.say('Maria da Silva');
  await c.say('sim');
  await c.say('pular');
  await c.say('1'); // empreendimento
  await c.say('1'); // tipologia
}

describe('início pelo WhatsApp: empreendimento e forma de pagamento', () => {
  it('pergunta o empreendimento só havendo mais de um e usa as tipologias dele', async () => {
    const c = new Chat(mkEnv());
    await c.say('Maria da Silva');
    await c.say('sim');
    await c.say('pular');
    expect(c.snap.state).toBe('DEVELOPMENT');
    expect(c.text).toContain('Lumen Urban|Parc Verde');
    await c.say('parc verde');
    expect(c.snap.data.developmentId).toBe('dev-parc');
    expect(c.snap.state).toBe('INTEREST');
    expect(c.text).toContain('Parc Verde');
    expect(c.text).toContain('3 quartos');
    expect(c.text).not.toContain('Studio');
    await c.say('1');
    expect(c.snap.state).toBe('PAYMENT_MODE');
    expect(c.effects).toContainEqual({ type: 'set_lead', fields: { developmentId: 'dev-parc' } });
  });

  it('com um só empreendimento não pergunta qual e vai direto à tipologia', async () => {
    const c = new Chat(mkEnv({ developments: [{ ...LUMEN, sales: sales() }] }));
    await c.say('Maria da Silva');
    await c.say('sim');
    await c.say('pular');
    expect(c.snap.state).toBe('INTEREST');
  });

  it('oferece só as formas da condição vigente', async () => {
    const c = new Chat(mkEnv({}, sales({ modes: ['A_VISTA', 'ENTRADA_PARCELADA'] })));
    await untilMode(c);
    expect(c.snap.state).toBe('PAYMENT_MODE');
    expect(c.text).toContain('Pagar à vista|Parcelar a entrada com a construtora');
    expect(c.text).not.toContain('financiar o saldo');
  });

  it('desligar o e-mail no painel pula a pergunta', async () => {
    const c = new Chat(mkEnv({ flow: { optionalSteps: { EMAIL: false } } }));
    await c.say('Maria da Silva');
    await c.say('sim');
    expect(c.snap.state).toBe('DEVELOPMENT');
  });
});

describe('modo 1: à vista', () => {
  it('forma de pagamento → confirmação → cálculo, sem perguntar renda', async () => {
    const c = new Chat(mkEnv());
    await untilMode(c);
    await c.say('quero pagar à vista');
    expect(c.snap.data.paymentMode).toBe('A_VISTA');
    expect(c.snap.state).toBe('CONFIRM');
    expect(c.text).toContain('Forma de pagamento: à vista');
    expect(c.text).not.toContain('Renda');
    await c.say('sim');
    expect(c.snap.state).toBe('SIMULATING');
    expect(c.effects).toContainEqual({ type: 'collected' });
    expect(c.effects).toContainEqual({ type: 'set_lead', fields: { paymentMode: 'A_VISTA' } });
  });
});

describe('modo 2: entrada de uma vez e financiamento do saldo', () => {
  it('sem estimativa do banco: só pergunta quanto tem para a entrada', async () => {
    const c = new Chat(mkEnv());
    await untilMode(c);
    await c.say('2');
    expect(c.snap.state).toBe('DOWN_CASH');
    await c.say('80 mil');
    expect(c.snap.data.cashNow).toBe(80000);
    expect(c.snap.state).toBe('CONFIRM');
    expect(c.text).toContain('Entrada de uma vez: R$ 80.000');
  });

  it('com estimativa do banco: pergunta o perfil e o FGTS depois da entrada', async () => {
    const c = new Chat(mkEnv({}, sales({ bankEstimate: true })));
    await untilMode(c);
    await c.say('2');
    await c.say('80 mil');
    expect(c.snap.state).toBe('INCOME');
    await c.say('8 mil');
    await c.say('clt');
    expect(c.snap.state).toBe('BIRTH');
    await c.say('05/03/1990');
    await c.say('não'); // dívidas
    await c.say('não'); // co-proponente
    expect(c.snap.state).toBe('FGTS_ASK');
    await c.say('não');
    await c.say('não'); // imóvel
    await c.say('sim'); // primeiro financiamento
    expect(c.snap.state).toBe('CONFIRM');
  });

  it('com a data de nascimento desligada no painel, a estimativa do banco não é pedida', async () => {
    const c = new Chat(mkEnv({ flow: { optionalSteps: { BIRTH: false } } }, sales({ bankEstimate: true })));
    await untilMode(c);
    await c.say('2');
    await c.say('80 mil');
    expect(c.snap.state).toBe('CONFIRM');
  });
});

describe('modo 3: entrada parcelada', () => {
  async function toCash(c: Chat) {
    await untilMode(c);
    await c.say('3');
    await c.say('9 mil'); // renda
    await c.say('clt');
    await c.say('não'); // dívidas
    await c.say('não'); // co-proponente
  }

  it('renda → ato → parcela desejada → reforços → confirmação', async () => {
    const c = new Chat(mkEnv());
    await toCash(c);
    expect(c.snap.state).toBe('CASH_NOW');
    await c.say('30 mil');
    expect(c.snap.state).toBe('DESIRED_INSTALLMENT');
    await c.say('2 mil');
    expect(c.snap.data.desiredInstallment).toBe(2000);
    expect(c.snap.state).toBe('BALLOONS');
    expect(c.text).toContain('a cada 6 meses');
    await c.say('sim');
    expect(c.snap.data.acceptsBalloons).toBe(true);
    expect(c.snap.state).toBe('CONFIRM');
    expect(c.text).toContain('Disponível hoje para o ato: R$ 30.000');
    expect(c.text).toContain('Parcela mensal desejada: até R$ 2.000/mês');
    expect(c.text).toContain('Reforços: aceita');
    expect(c.text).not.toContain('Nascimento');
  });

  it('"não sei" na parcela desejada vale sem preferência', async () => {
    const c = new Chat(mkEnv());
    await toCash(c);
    await c.say('0');
    await c.say('não sei');
    expect(c.snap.data.desiredInstallment).toBe(0);
  });

  it('condição sem reforços não pergunta sobre reforços', async () => {
    const c = new Chat(mkEnv({}, sales({ balloonIntervalMonths: null })));
    await toCash(c);
    await c.say('30 mil');
    await c.say('2 mil');
    expect(c.snap.state).toBe('CONFIRM');
  });

  it('parcela desejada e reforços podem ser desligados no painel', async () => {
    const c = new Chat(mkEnv({ flow: { optionalSteps: { DESIRED_INSTALLMENT: false, BALLOONS: false } } }));
    await toCash(c);
    await c.say('30 mil');
    expect(c.snap.state).toBe('CONFIRM');
  });

  it('com estimativa do banco, o nascimento entra no ramo', async () => {
    const c = new Chat(mkEnv({}, sales({ bankEstimate: true })));
    await untilMode(c);
    await c.say('3');
    await c.say('9 mil');
    await c.say('clt');
    expect(c.snap.state).toBe('BIRTH');
  });
});

describe('texto do FlowConfig com fallback', () => {
  it('usa o texto publicado da chave e o padrão do código nas demais', async () => {
    const env = mkEnv({ flow: { texts: { ASK_NAME: 'Como posso te chamar, de verdade?' } } });
    const c = new Chat(env);
    expect(tx(env, 'ASK_NAME')).toBe('Como posso te chamar, de verdade?');
    expect(tx(env, 'ASK_EMAIL')).toContain('e-mail');
    await c.say('Maria da Silva');
    await c.say('sim');
    expect(c.text).toContain('e-mail');
  });

  it('preenche variáveis e deixa as desconhecidas como estão', () => {
    expect(tx({ flow: { texts: { ASK_INTEREST: 'Olá {empreendimento} {x}' } } }, 'ASK_INTEREST', { empreendimento: 'Lumen' })).toBe('Olá Lumen {x}');
    expect(firstContactText({}, { nome: 'Ana', empreendimento: 'Lumen Urban' })).toContain('Oi, Ana! Aqui é a Elevare');
    expect(firstContactText({ flow: { firstContact: 'Oi {nome}, é do {empreendimento}?' } }, { nome: 'Ana', empreendimento: 'Lumen' })).toBe('Oi Ana, é do Lumen?');
  });
});

describe('início pelo formulário: double opt-in', () => {
  const prefill: Collected = { name: 'Ana Souza', phone: '5511912345678', email: null, developmentId: 'dev-lumen' };

  it('"sim" confirma e pula nome, telefone, e-mail e empreendimento', async () => {
    const c = new Chat(mkEnv(), formSnapshot(prefill));
    await c.say('sim');
    expect(c.effects).toContainEqual({ type: 'contact_confirmed' });
    expect(c.snap.state).toBe('INTEREST');
    expect(c.text).toContain('Perfeito, Ana');
    expect(c.text).not.toMatch(/nome completo|telefone|concorda/i);
    await c.say('1');
    expect(c.snap.state).toBe('PAYMENT_MODE');
  });

  it('com a tipologia já vinda do formulário, vai direto à forma de pagamento', async () => {
    const c = new Chat(mkEnv(), formSnapshot({ ...prefill, typology: 'STUDIO' }));
    await c.say('sim');
    expect(c.snap.state).toBe('PAYMENT_MODE');
  });

  it('"não" encerra, marca o lead e não escreve mais nada', async () => {
    const c = new Chat(mkEnv(), formSnapshot(prefill));
    await c.say('não, não pedi nada');
    expect(c.snap.state).toBe('OPTED_OUT');
    expect(c.effects).toContainEqual({ type: 'lead_status', status: 'CLOSED' });
    expect(c.effects).toContainEqual({ type: 'audit', action: 'contact_declined' });
    expect(c.text).toContain('desculpe');
    await c.say('oi?');
    expect(c.last).toEqual([]);
    await c.say('quero simular');
    expect(c.last).toEqual([]);
  });

  it('respostas que não são sim nem não repetem a pergunta e, ao fim, encerram sem chamar corretor', async () => {
    const c = new Chat(mkEnv(), formSnapshot(prefill));
    await c.say('talvez');
    expect(c.snap.state).toBe('CONTACT_CONFIRM');
    expect(c.text).toContain('foi você que pediu');
    await c.say('hmm');
    await c.say('sei lá');
    expect(c.snap.state).toBe('OPTED_OUT');
    expect(c.effects.some((e) => e.type === 'handoff')).toBe(false);
  });

  it('"parar" encerra e "corretor" chama a equipe, mesmo antes de confirmar', async () => {
    const stop = new Chat(mkEnv(), formSnapshot(prefill));
    await stop.say('parar de me mandar mensagem');
    expect(stop.snap.state).toBe('OPTED_OUT');
    const human = new Chat(mkEnv(), formSnapshot(prefill));
    await human.say('quero falar com um corretor');
    expect(human.snap.state).toBe('HANDOFF');
  });
});

describe('resultado e ajustes por forma de pagamento', () => {
  const data = (mode: PaymentModeId): Collected => ({ paymentMode: mode, developmentId: 'dev-lumen', typology: 'STUDIO' });

  it('o menu muda com a forma de pagamento', () => {
    const env = mkEnv();
    const ids = (m: PaymentModeId) => resultOptions(data(m), env).map((o) => o.id);
    expect(ids('A_VISTA')).toEqual(['mode', 'unit', 'pdf', 'human', 'finish']);
    expect(ids('ENTRADA_A_VISTA')).toEqual(['act', 'unit', 'mode', 'pdf', 'human', 'finish']);
    expect(ids('ENTRADA_PARCELADA')).toEqual(['act', 'balloons', 'unit', 'mode', 'pdf', 'human', 'finish']);
    expect(resultOptions(data('ENTRADA_PARCELADA'), mkEnv({}, sales({ balloonIntervalMonths: null }))).map((o) => o.id)).not.toContain('balloons');
    expect(resultOptions({}, { ...mkEnv(), developments: undefined }).map((o) => o.id)).toEqual(['down', 'term', 'pdf', 'finish']);
  });

  function atResult(mode: PaymentModeId, state: 'RESULT' | 'CASH_OFFER' = 'RESULT') {
    return new Chat(mkEnv(), { ...initialSnapshot(), state, data: { ...data(mode), name: 'Ana', cashNow: 30000, acceptsBalloons: true }, simulationId: 'sim-1' });
  }

  it('"mudar o ato" pede o valor e recalcula com o ajuste, sem mexer no perfil', async () => {
    const c = atResult('ENTRADA_PARCELADA');
    await c.say('1');
    expect(c.snap.state).toBe('ADJUST_ACT');
    expect(c.text).toContain('Hoje considerei R$ 30.000');
    await c.say('50 mil');
    expect(c.snap.state).toBe('SIMULATING');
    expect(c.snap.adjust.cashNow).toBe(50000);
    expect(c.snap.data.cashNow).toBe(30000);
  });

  it('"mudar a entrada" digitado no resultado também abre o ajuste', async () => {
    const c = atResult('ENTRADA_A_VISTA');
    await c.say('quero mudar a entrada');
    expect(c.snap.state).toBe('ADJUST_ACT');
  });

  it('reforços: aceitar ou recusar recalcula', async () => {
    const c = atResult('ENTRADA_PARCELADA');
    await c.say('reforços');
    expect(c.snap.state).toBe('ADJUST_BALLOONS');
    await c.say('não');
    expect(c.snap.adjust.acceptsBalloons).toBe(false);
    expect(c.snap.state).toBe('SIMULATING');
  });

  it('outra unidade troca a tipologia e recalcula', async () => {
    const c = atResult('ENTRADA_PARCELADA');
    await c.say('outra unidade');
    expect(c.snap.state).toBe('ADJUST_UNIT');
    expect(c.text).toContain('Studio|2 quartos');
    await c.say('2 quartos');
    expect(c.snap.data.typology).toBe('DOIS_Q');
    expect(c.snap.state).toBe('SIMULATING');
  });

  it('outra forma de pagamento volta à escolha e depois à confirmação', async () => {
    const c = atResult('ENTRADA_A_VISTA');
    await c.say('outra forma de pagamento');
    expect(c.snap.state).toBe('PAYMENT_MODE');
    await c.say('3');
    expect(c.snap.state).toBe('INCOME');
    // O ato e os reforços já tinham resposta e não são perguntados de novo; falta só a parcela desejada.
    for (const a of ['9 mil', 'clt', 'não', 'não']) await c.say(a);
    expect(c.snap.state).toBe('DESIRED_INSTALLMENT');
    await c.say('2 mil');
    expect(c.snap.state).toBe('CONFIRM');
    await c.say('sim');
    expect(c.snap.state).toBe('SIMULATING');
    expect(c.snap.data.paymentMode).toBe('ENTRADA_PARCELADA');
  });

  it('"falar com corretor" no menu passa para o corretor e devolve ao resultado depois', async () => {
    const c = atResult('ENTRADA_PARCELADA');
    await c.say('falar com um corretor');
    expect(c.snap.state).toBe('HANDOFF');
    expect(c.snap.handoffFrom).toBe('RESULT');
  });

  it('à vista: "sim" na oferta chama o corretor; "não" mostra o menu', async () => {
    const yes = atResult('A_VISTA', 'CASH_OFFER');
    await yes.say('sim');
    expect(yes.snap.state).toBe('HANDOFF');
    const no = atResult('A_VISTA', 'CASH_OFFER');
    await no.say('não');
    expect(no.snap.state).toBe('RESULT');
    expect(no.text).toContain('Ver outra forma de pagamento');
  });

  it('exclusão, parada e corretor valem nos estados novos', async () => {
    const states = ['CONTACT_CONFIRM', 'DEVELOPMENT', 'PAYMENT_MODE', 'DOWN_CASH', 'CASH_NOW', 'DESIRED_INSTALLMENT', 'BALLOONS', 'CASH_OFFER', 'ADJUST_ACT', 'ADJUST_BALLOONS', 'ADJUST_UNIT'] as const;
    for (const state of states) {
      const base: Snapshot = { ...initialSnapshot(), state, data: data('ENTRADA_PARCELADA') };
      const lgpd = new Chat(mkEnv(), base);
      await lgpd.say('quero que apaguem meus dados');
      expect(lgpd.snap.state, state).toBe('LGPD_CONFIRM');
      await lgpd.say('sim');
      expect(lgpd.effects.some((e) => e.type === 'erase'), state).toBe(true);

      const stop = new Chat(mkEnv(), base);
      await stop.say('parar de me mandar mensagem');
      expect(stop.snap.state, state).toBe('OPTED_OUT');

      const human = new Chat(mkEnv(), base);
      await human.say('quero falar com um atendente');
      expect(human.snap.state, state).toBe('HANDOFF');
      expect(human.effects.some((e) => e.type === 'handoff'), state).toBe(true);
    }
  });
});

describe('correção no fluxo das formas de pagamento', () => {
  it('o menu de correção só lista o que o lead respondeu no caminho dele', () => {
    const env = mkEnv();
    const labels = (d: Collected) => correctionOptions(d, env).map((o) => o.label);
    const cash = labels({ paymentMode: 'A_VISTA', developmentId: 'dev-lumen' });
    expect(cash).toContain('Forma de pagamento');
    expect(cash).not.toContain('Renda');
    const parcelada = labels({ paymentMode: 'ENTRADA_PARCELADA', developmentId: 'dev-lumen' });
    expect(parcelada).toEqual(expect.arrayContaining(['Renda', 'Dinheiro para o ato', 'Parcela mensal desejada', 'Reforços']));
    expect(parcelada).not.toContain('Data de nascimento');
    expect(parcelada).not.toContain('Entrada');
  });

  it('corrigir o ato leva só a essa pergunta e volta à confirmação', async () => {
    const c = new Chat(mkEnv());
    await untilMode(c);
    await c.say('3');
    for (const a of ['9 mil', 'clt', 'não', 'não', '30 mil', '2 mil', 'sim']) await c.say(a);
    expect(c.snap.state).toBe('CONFIRM');
    await c.say('não');
    await c.say('ato');
    expect(c.snap.state).toBe('CASH_NOW');
    await c.say('45 mil');
    expect(c.snap.state).toBe('CONFIRM');
    expect(c.text).toContain('R$ 45.000');
  });

  it('trocar de empreendimento limpa tipologia e forma de pagamento', async () => {
    const c = new Chat(mkEnv());
    await untilMode(c);
    await c.say('1');
    expect(c.snap.state).toBe('CONFIRM');
    await c.say('não');
    await c.say('empreendimento');
    await c.say('parc verde');
    expect(c.snap.data.developmentId).toBe('dev-parc');
    expect(c.snap.data.typology).toBeUndefined();
    expect(c.snap.state).toBe('INTEREST');
  });
});
