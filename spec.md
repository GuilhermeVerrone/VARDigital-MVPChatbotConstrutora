# Especificação: Chatbot de Pré-Simulação de Financiamento Imobiliário

**Versão:** 1.1 (rascunho) — ajustado para MVP com WA-AKG, LLM local e CRM simulado (ver `docs/03-impactos.md`)
**Domínio:** Construtora / Incorporadora (lançamentos imobiliários)
**Idioma:** Português (Brasil)

---

## 1. Visão geral

### 1.1 Objetivo

Criar um chatbot que conduza o lead por uma **primeira simulação de financiamento** de uma unidade em lançamento e entregue ao corretor um **dossiê pronto** (perfil, simulação, classificação e próximo passo), eliminando o retrabalho de qualificação.

### 1.2 Problema

- O corretor gasta tempo refazendo perguntas básicas (renda, entrada, FGTS, dívidas).
- Leads chegam sem qualificação, e muitos não têm capacidade de compra para a unidade.
- O tempo de resposta ao lead é alto, o que reduz a conversão.

### 1.3 Resultado esperado

- Lead qualificado e simulado em poucos minutos, 24h por dia.
- Corretor recebe o lead com resumo, simulação, score e sugestão de abordagem.
- Aumento da taxa de conversão lead → visita → proposta.

### 1.4 Fora de escopo (v1)

- Aprovação oficial de crédito (a simulação é **indicativa**).
- Consulta a bureaus de crédito (Serasa/SPC) e análise de documentos.
- Assinatura de contrato e emissão de boletos.
- Integração direta com sistemas bancários (consulta de taxas é manual/parametrizada).
- **Fora do MVP (piloto):** templates e janela de 24h do WhatsApp, follow-up e reativação automáticos (RF-42, RF-44), painel administrativo completo (RF-45 a RF-52; parâmetros por seed/CLI), score configurável (RF-28 a RF-30), cenários alternativos (RF-25, RF-26), distribuição avançada com SLA (RF-38 a RF-40), agenda e analytics, CRM real, PDF com identidade visual final.

### 1.5 Premissas

- O canal principal é o **WhatsApp**, acessado por uma **camada de canal abstrata** (`ChannelAdapter`). No **MVP/piloto** o adaptador usa o gateway **WA-AKG** (baseado em Baileys, **não oficial**); em **produção** o adaptador deve migrar para a **WhatsApp Business Platform (API oficial)**. O site é canal secundário (pós-MVP).
- No MVP o CRM é **simulado** (`CrmAdapter` com implementação local); o LLM é **local e leve**, atrás de uma interface (`LlmClient`) que permite trocar por API em nuvem.
- A construtora fornece tabela de preços e espelho de vendas atualizados.
- As regras de crédito (taxas, faixas, cotas) são mantidas pela equipe comercial/financeira em tabelas configuráveis.

---

## 2. Personas e usuários

| Persona                          | Descrição                           | Necessidade principal                                                 |
| -------------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| **Lead (comprador)**             | Pessoa interessada em um lançamento | Saber rápido se consegue comprar, quanto paga de entrada e de parcela |
| **Corretor**                     | Recebe e atende o lead              | Lead já qualificado, com simulação e orientação do que fazer          |
| **Gerente comercial**            | Supervisiona a equipe               | Visão de funil, distribuição justa de leads, métricas                 |
| **Analista/Financeiro**          | Mantém regras e taxas               | Atualizar parâmetros sem depender de TI                               |
| **Administrador (TI/Marketing)** | Configura o bot e integrações       | Controle de conteúdo, canais, logs e LGPD                             |

---

## 3. Requisitos funcionais

### 3.1 Atendimento conversacional (RF-01 a RF-10)

- **RF-01** O bot inicia a conversa, identifica o empreendimento de interesse (via link/campanha ou pergunta) e se apresenta como assistente virtual.
- **RF-02** Coletar consentimento LGPD antes de qualquer dado pessoal, registrando data, hora, canal e texto aceito.
- **RF-03** Conduzir a coleta de dados em etapas curtas, uma pergunta por vez, com validação de formato.
- **RF-04** Aceitar respostas livres (texto) e botões/listas, interpretando valores como "uns 5 mil", "R$ 5.000" ou "5k".
- **RF-05** Permitir corrigir respostas anteriores ("voltar", "corrigir renda").
- **RF-06** Responder dúvidas frequentes sobre o empreendimento sem perder o fio da simulação (FAQ).
- **RF-07** Permitir **handoff humano** a qualquer momento ("falar com corretor"), repassando todo o histórico.
- **RF-08** Retomar conversas interrompidas, mantendo o estado da simulação por tempo configurável (padrão: 7 dias).
- **RF-09** Detectar mensagens fora de escopo, reclamações ou linguagem ofensiva e encaminhar para humano quando necessário.
- **RF-10** Reconhecer pedidos de exclusão de dados (LGPD) e abrir fluxo de atendimento ao titular.

### 3.2 Coleta de dados (RF-11 a RF-14)

| Campo                                                             | Obrigatório       | Validação                            |
| ----------------------------------------------------------------- | ----------------- | ------------------------------------ |
| Nome completo                                                     | Sim               | Mínimo de 2 palavras                 |
| Telefone/WhatsApp                                                 | Sim               | Formato BR (DDD + número)            |
| E-mail                                                            | Não (recomendado) | Formato válido                       |
| Data de nascimento (proponente)                                   | Sim               | Idade entre 18 e limite do produto   |
| Renda bruta mensal                                                | Sim               | Numérico, maior que zero             |
| Tipo de renda (CLT, autônomo, servidor, aposentado, outros)       | Sim               | Lista                                |
| Existe co-proponente? Renda e data de nascimento dele             | Condicional       | Mesmas validações                    |
| Valor disponível para entrada                                     | Sim               | Numérico, maior ou igual a zero      |
| Possui FGTS? Saldo aproximado e tempo de trabalho sob regime FGTS | Condicional       | Numérico / meses                     |
| Dívidas/parcelas mensais já comprometidas                         | Sim               | Numérico, maior ou igual a zero      |
| Possui imóvel (no município / no país)?                           | Sim               | Sim/Não                              |
| É o primeiro imóvel financiado?                                   | Sim               | Sim/Não                              |
| Unidade/tipologia de interesse                                    | Sim               | Lista do espelho de vendas           |
| Prazo desejado do financiamento                                   | Não               | Dentro do mínimo e máximo do produto |
| Cidade de residência / onde trabalha                              | Não               | Texto                                |

- **RF-11** Todo dado coletado deve ser persistido por etapa, para que a conversa possa ser retomada.
- **RF-12** Dados sensíveis (renda, dívidas, FGTS) só são coletados após o consentimento.
- **RF-13** O bot nunca solicita CPF, RG, senhas, dados de cartão ou documentos na v1 (o CPF pode ser coletado na v2, sob regras próprias).
- **RF-14** O bot informa o cliente sempre que um dado é opcional e pode ser pulado.

### 3.3 Motor de simulação (RF-15 a RF-24)

- **RF-15** **Enquadramento:** determinar a linha de crédito elegível (ex.: programa habitacional com subsídio, FGTS, SBPE) com base em renda familiar, valor do imóvel, primeiro imóvel e regras de elegibilidade.
- **RF-16** **Capacidade de pagamento:** calcular a parcela máxima como percentual da renda familiar, descontando dívidas informadas (percentual máximo parametrizável, padrão 30%).
- **RF-17** **Valor financiável:** limitado pela menor de duas restrições: (a) cota máxima de financiamento sobre o valor do imóvel e (b) valor que a parcela máxima suporta no prazo escolhido.
- **RF-18** **Entrada necessária:** valor do imóvel menos valor financiável menos subsídio e FGTS aplicáveis.
- **RF-19** **Sistemas de amortização:** suportar **SAC** e **Price**, exibindo a 1ª parcela e a última (SAC) ou a parcela fixa (Price).
- **RF-20** **Encargos:** incluir juros nominais/efetivos, seguros (MIP e DFI), taxa de administração e quaisquer tarifas parametrizadas.
- **RF-21** **Uso do FGTS:** simular uso na entrada e/ou na amortização, respeitando as regras de elegibilidade (tempo de trabalho, não possuir outro imóvel, etc.).
- **RF-22** **Subsídio:** calcular o valor estimado quando o enquadramento permitir, conforme tabela parametrizada.
- **RF-23** **Fluxo de pagamento da obra:** montar o cronograma completo com:
  - sinal/ato;
  - entrada parcelada durante a obra;
  - reforços/intermediárias (anuais/semestrais);
  - parcelas de evolução da obra (se aplicável);
  - saldo a financiar na entrega das chaves.
- **RF-24** **Parecer da simulação**, em três níveis:
  - ✅ **Viável**: renda e entrada compatíveis com a unidade.
  - ⚠️ **Viável com ajustes**: indicar o ajuste (aumentar entrada, incluir co-proponente, prazo maior, unidade menor).
  - ❌ **Inviável no momento**: sugerir alternativas (outra tipologia, planejar entrada, retornar depois).

### 3.4 Sugestões inteligentes (RF-25 a RF-27)

- **RF-25** Quando inviável ou limítrofe, o bot calcula e propõe **cenários alternativos** (ex.: "com R$ X a mais de entrada a parcela cai para R$ Y").
- **RF-26** Sugerir unidades/tipologias compatíveis com o perfil, com base no espelho de vendas.
- **RF-27** Permitir ao lead **ajustar parâmetros** (entrada, prazo, unidade) e ver a simulação atualizada em tempo real.

### 3.5 Classificação do lead (RF-28 a RF-30)

- **RF-28** Calcular um **score de 0 a 100** e uma classe (**Quente / Morno / Frio**) combinando:
  - aderência entre capacidade de compra e valor da unidade;
  - entrada disponível versus entrada necessária;
  - perfil de renda (formal/informal);
  - urgência declarada;
  - engajamento na conversa (respondeu tudo, pediu visita).
- **RF-29** Os pesos e limites do score são parametrizáveis.
- **RF-30** O score e seus fatores aparecem no dossiê do corretor, para que ele entenda o porquê da classificação.

### 3.6 Dossiê e entrega ao corretor (RF-31 a RF-37)

- **RF-31** Gerar um **resumo estruturado** (card) com: dados do cliente, empreendimento/unidade, simulação, score, alertas e próximo passo sugerido.
- **RF-32** Gerar um **PDF da simulação** com identidade visual da construtora e aviso legal de que o documento é indicativo.
- **RF-33** Enviar o resumo ao corretor por WhatsApp e/ou e-mail e registrá-lo no CRM.
- **RF-34** Incluir **alertas** relevantes, por exemplo: idade próxima ao limite, renda informal, necessidade de co-proponente, FGTS sem tempo mínimo, comprometimento de renda alto, entrada insuficiente.
- **RF-35** Incluir **sugestão de abordagem** (script curto) e **próximo passo** (agendar visita ao stand, solicitar documentos, ligar em até X minutos).
- **RF-36** Permitir ao corretor **assumir o atendimento** com um clique, com o bot passando para modo silencioso nessa conversa.
- **RF-37** Permitir ao corretor registrar o **resultado do contato** (visitou, proposta, perdido e motivo), alimentando as métricas.

### 3.7 Distribuição de leads (RF-38 a RF-41)

- **RF-38** Distribuir leads por regras configuráveis: roleta (round-robin), plantão/escala, empreendimento, faixa de score ou região.
- **RF-39** Notificar o corretor imediatamente, com SLA de primeiro contato configurável (ex.: 5 minutos).
- **RF-40** Reatribuir o lead automaticamente se o corretor não responder dentro do SLA.
- **RF-41** Evitar duplicidade: se o telefone já existe no CRM, associar ao lead existente e avisar o corretor responsável.

### 3.8 Follow-up e reativação (RF-42 a RF-44)

- **RF-42** Enviar lembretes automáticos para leads que abandonaram a simulação (ex.: após 1h, 24h e 72h), respeitando a janela de mensagens e templates aprovados do WhatsApp.
- **RF-43** Permitir ao lead parar de receber mensagens ("sair", "parar").
- **RF-44** Reativar leads frios em campanhas (novos lançamentos, mudança de condições), com consentimento.

### 3.9 Administração (RF-45 a RF-52)

- **RF-45** Painel para gerenciar **empreendimentos**: nome, localização, descrição, plantas, tipologias, metragens, previsão de entrega, FAQ e materiais.
- **RF-46** Painel para gerenciar a **tabela de preços** e a disponibilidade das unidades (manual, planilha ou integração).
- **RF-47** Painel para gerenciar **parâmetros financeiros**: faixas de renda, cotas, taxas por banco/linha, seguros, limites de prazo e idade, percentual de comprometimento, com **vigência por data** e **histórico de alterações**.
- **RF-48** Painel para gerenciar **regras de distribuição** e escalas de corretores.
- **RF-49** Editor de **textos e fluxos** do bot sem necessidade de código.
- **RF-50** **Painel de métricas** (ver seção 8).
- **RF-51** Perfis de acesso (admin, gerente, corretor, financeiro, somente leitura).
- **RF-52** **Log de auditoria** de alterações em parâmetros financeiros e regras.

---

## 4. Regras de negócio

> Os valores abaixo são **exemplos ilustrativos**. Todos devem vir de tabelas configuráveis e ser validados pelo financeiro/jurídico antes do uso.

### 4.1 Comprometimento de renda

```
parcela_maxima = (renda_familiar * pct_comprometimento) - dividas_mensais
```

- `pct_comprometimento` padrão: 30% (configurável por linha de crédito).
- Se `parcela_maxima <= 0`, o parecer é **Inviável** com orientação de quitar dívidas ou incluir co-proponente.

### 4.2 Valor financiável

```
valor_financiavel = MIN(
    valor_imovel * cota_maxima,
    valor_que_cabe_na_parcela(parcela_maxima, taxa, prazo, sistema)
)
```

### 4.3 Entrada necessária

```
entrada_necessaria = valor_imovel - valor_financiavel - subsidio - fgts_na_entrada
```

- Se `entrada_disponivel + fgts_na_entrada + subsidio >= valor_imovel - valor_financiavel`, parecer **Viável**.
- Se a diferença for menor ou igual a uma tolerância configurável (ex.: 10% da entrada), **Viável com ajustes**.
- Caso contrário, **Inviável no momento**.

### 4.4 Fórmulas de amortização

**Price (parcela fixa):**

```
PMT = PV * [ i * (1+i)^n ] / [ (1+i)^n - 1 ]
```

**SAC (amortização constante):**

```
amortizacao = PV / n
parcela_k = amortizacao + saldo_devedor_(k-1) * i
```

Onde `PV` é o valor financiado, `i` a taxa mensal e `n` o prazo em meses. Sobre a parcela incidem seguros (MIP/DFI) e taxa de administração.

### 4.5 Idade e prazo

- Prazo máximo limitado pela idade: `idade_ao_final <= idade_maxima_produto` (parametrizável por linha de crédito).
- Em caso de co-proponente, usar a regra do banco/linha (por padrão, o mais velho).

### 4.6 Regras de FGTS (parametrizáveis)

- Tempo mínimo de trabalho sob regime FGTS.
- Não possuir imóvel residencial financiado no município/país, conforme regra da linha.
- Valor do imóvel dentro do teto da linha.

### 4.7 Enquadramento

Tabela configurável de linhas de crédito, por exemplo:

| Linha                           | Condições de elegibilidade         | Cota máx. | Taxa    | Subsídio |
| ------------------------------- | ---------------------------------- | --------- | ------- | -------- |
| Programa habitacional – faixa A | Renda até R$ X                     | Y%        | Z% a.a. | Sim      |
| Programa habitacional – faixa B | Renda até R$ X                     | Y%        | Z% a.a. | Sim      |
| SBPE                            | Sem limite de renda, teto de valor | Y%        | Z% a.a. | Não      |

### 4.8 Avisos legais (obrigatórios no PDF e na conversa)

- A simulação é **indicativa** e não constitui aprovação de crédito.
- Valores e condições estão sujeitos à análise de crédito, política do agente financeiro e disponibilidade da unidade.
- Taxas e regras podem mudar sem aviso prévio.
- Data e hora de geração da simulação.

---

## 5. Fluxo da conversa

```
[Início] → Saudação + empreendimento
   ↓
[Consentimento LGPD] → recusou → encerra com mensagem cordial
   ↓ aceitou
[Identificação] nome, telefone, e-mail
   ↓
[Interesse] tipologia / unidade
   ↓
[Perfil financeiro] renda, tipo de renda, nascimento, dívidas
   ↓
[Co-proponente?] sim → coleta dados adicionais
   ↓
[Entrada e FGTS] valor disponível, FGTS, tempo de trabalho
   ↓
[Elegibilidade] imóvel próprio, primeiro imóvel
   ↓
[Cálculo] motor de simulação
   ↓
[Apresentação] resumo + parecer + cenários
   ↓
[Ajustes?] sim → recalcula (loop) | não ↓
[Próximo passo] agendar visita / falar com corretor / receber PDF
   ↓
[Entrega ao corretor] dossiê + PDF + notificação
   ↓
[Follow-up] lembretes e reativação
```

### 5.1 Princípios de conversa

- Tom cordial, claro e sem jargão (explicar "SAC", "cota de financiamento" quando usados).
- Uma pergunta por vez; mensagens curtas.
- Sempre oferecer saída ("falar com corretor").
- Nunca prometer aprovação, taxa ou prazo de entrega de forma definitiva.
- Confirmar dados-chave antes de calcular ("Renda de R$ 6.000, confere?").

### 5.2 Exemplo de trecho

> **Bot:** Para simular, qual é a renda bruta mensal da família? Pode somar a de quem vai comprar junto.
> **Lead:** uns 7 mil
> **Bot:** Anotado: R$ 7.000/mês. Você tem alguma parcela de financiamento, cartão parcelado ou empréstimo que paga todo mês? Se sim, qual o valor somado?

---

## 6. Dossiê do corretor (modelo)

```
🔥 LEAD QUENTE — Score 82/100

👤 CLIENTE
Maria Souza | (13) 9XXXX-XXXX | maria@email.com
Idade: 34 | Renda familiar: R$ 7.000 (CLT) | Co-proponente: não
Primeiro imóvel: sim | FGTS: R$ 18.000 (4 anos de carteira)

🏢 INTERESSE
Empreendimento: [Nome] | Unidade: 2 dorm. – 58 m² | Valor: R$ XXX.000

💰 SIMULAÇÃO (indicativa)
Linha: [Linha enquadrada] | Sistema: SAC | Prazo: 360 meses
Valor financiável: R$ XXX.000 | Entrada necessária: R$ XX.000
Subsídio estimado: R$ X.000 | FGTS na entrada: R$ 18.000
1ª parcela: R$ X.XXX | Última parcela: R$ X.XXX
Fluxo de obra: sinal R$ X + 36x R$ X + 3 reforços de R$ X
Parecer: ✅ Viável

⚠️ ALERTAS
• Comprometimento de renda em 28% (próximo do limite)
• Confirmar vínculo empregatício atual

🎯 PRÓXIMO PASSO SUGERIDO
Ligar em até 5 min e agendar visita ao stand. Destacar: entrada parcelada e uso do FGTS.

📎 PDF da simulação anexo | 💬 Ver conversa completa
```

---

## 7. Requisitos não funcionais

### 7.1 Desempenho

- Cálculo da simulação em menos de 1 segundo.
- **Produção (alvo):** resposta do bot em até 3 segundos (p95), exceto geração de PDF (até 10 s); picos de campanha (ex.: 500 conversas simultâneas), com escalabilidade horizontal.
- **MVP:** respostas do fluxo (templates e parsers determinísticos) sem LLM devem ser imediatas; respostas que usam o LLM local têm meta de latência **definida a partir de medição** na bateria de testes do modelo. Concorrência dimensionada para dezenas de conversas, com fila e limite de concorrência.

### 7.2 Disponibilidade e confiabilidade

- Disponibilidade alvo de 99,5% (mensal).
- Fila de mensagens com reprocessamento em caso de falha de integração (CRM, WhatsApp).
- O endpoint de webhook responde em bem menos de 10 s (timeout do WA-AKG, que faz **uma única tentativa** de entrega): só valida, grava e confirma.
- Nenhum lead pode ser perdido: se o CRM estiver indisponível, o lead é guardado e reenviado.

### 7.3 Segurança e LGPD

- Criptografia em trânsito (TLS) e em repouso para dados pessoais e financeiros.
- Minimização de dados: coletar só o necessário para a simulação.
- Base legal e finalidade registradas; consentimento versionado e auditável.
- Controle de acesso por perfil (RBAC) e logs de acesso a dados pessoais.
- Política de retenção configurável (ex.: anonimizar leads inativos após N meses).
- Fluxo para atender direitos do titular (acesso, correção, exclusão, portabilidade).
- Mascarar dados sensíveis em logs.
- Definir encarregado (DPO) e registrar operações de tratamento.

### 7.4 Observabilidade

- Logs estruturados, métricas técnicas e alertas (latência, erros, filas).
- Rastreamento de cada conversa por ID para suporte.

### 7.5 Manutenibilidade

- Regras financeiras fora do código (tabelas versionadas com vigência).
- Testes automatizados do motor de cálculo, com casos de referência validados pelo financeiro.
- Ambientes separados: desenvolvimento, homologação e produção.

### 7.6 Acessibilidade e usabilidade

- Mensagens compreensíveis para público leigo; suporte a áudio como entrada é desejável (v2).
- Interface administrativa responsiva.

### 7.7 Conformidade com WhatsApp

- **Produção:** uso exclusivo da API oficial (WhatsApp Business Platform), com templates aprovados para mensagens fora da janela de 24 horas.
- **MVP/piloto:** uso do WA-AKG (não oficial) restrito a número dedicado, volume baixo, apenas leads que iniciaram a conversa ou deram opt-in, sem envio em massa e sem mensagens ativas frias. O risco de bloqueio e de violação dos termos do WhatsApp é aceito conscientemente para o piloto.
- Opt-in e opt-out respeitados em ambos os modos.

---

## 8. Métricas e indicadores

| Métrica                                          | Definição                         |
| ------------------------------------------------ | --------------------------------- |
| Leads iniciados                                  | Conversas com consentimento       |
| Taxa de conclusão da simulação                   | Simulações concluídas / iniciadas |
| Abandono por etapa                               | Onde o lead desiste no fluxo      |
| Tempo médio até a simulação                      | Do início ao resultado            |
| Distribuição do parecer                          | % viável / com ajustes / inviável |
| Distribuição do score                            | Quente / morno / frio             |
| Tempo de primeiro contato do corretor            | Da entrega ao 1º contato          |
| Taxa de visita                                   | Leads que visitaram o stand       |
| Taxa de proposta e de venda                      | Conversão por etapa do funil      |
| Conversão por corretor / empreendimento / origem | Comparativos                      |
| Acurácia do score                                | Correlação entre score e venda    |
| Motivos de perda                                 | Registrados pelo corretor         |

---

## 9. Arquitetura proposta

### 9.1 Componentes

```
┌──────────────┐   ┌──────────────┐
│  WhatsApp    │   │  Site/Widget │
└──────┬───────┘   └──────┬───────┘
       └────────┬─────────┘
                ▼
        ┌───────────────┐
        │ Gateway de    │
        │ canais        │
        └───────┬───────┘
                ▼
        ┌───────────────────────────┐
        │ Orquestrador da conversa  │  ← LLM + máquina de estados
        │ (estado, NLU, validação)  │
        └──┬────────┬────────┬──────┘
           │        │        │
           ▼        ▼        ▼
   ┌──────────┐ ┌────────┐ ┌──────────────┐
   │ Motor de │ │ Score  │ │ Base de      │
   │ simulação│ │ do lead│ │ conhecimento │
   └────┬─────┘ └───┬────┘ └──────────────┘
        │           │
        ▼           ▼
   ┌──────────────────────┐     ┌──────────────┐
   │ Banco de dados       │◄───►│ Painel admin │
   │ (leads, conversas,   │     └──────────────┘
   │  parâmetros, logs)   │
   └───────────┬──────────┘
               ▼
   ┌────────────────────────────────────────┐
   │ Integrações: CRM · Espelho de vendas · │
   │ Agenda · E-mail · Gerador de PDF       │
   └────────────────────────────────────────┘
```

Notas do MVP sobre o diagrama:

- O **Gateway de canais** expõe `ChannelAdapter` (enviar texto/lista/documento, indicar "digitando", marcar como lida). Implementações: `WaAkgAdapter` (MVP) e `CloudApiAdapter` (produção, futuro).
- Entre o webhook do canal e o orquestrador há uma **fila de entrada persistente**: o endpoint valida a assinatura, grava a mensagem de forma idempotente e responde de imediato; um worker processa e reprocessa em caso de falha.
- O WA-AKG roda isolado, com banco próprio; o banco do bot é um **PostgreSQL separado**. Integrações do MVP: `SimulatedCrm`, e-mail e gerador de PDF.
- O WA-AKG só entrega webhooks para URLs **HTTPS** cujo host resolva para **IP público** (proteção SSRF do próprio WA-AKG). Em desenvolvimento: CA local + rede Docker em faixa não privada (ver `infra/README.md`); no piloto: domínio público com certificado válido. Assinatura `X-Webhook-Signature: sha256=<HMAC do corpo bruto>` é sempre verificada.

### 9.2 Decisões-chave

- **Cálculo determinístico:** a simulação é feita por código (motor de cálculo), **nunca pelo LLM**. O LLM entende a linguagem do cliente e redige as mensagens, mas os números vêm do motor.
- **Máquina de estados** controlando as etapas, com o LLM extraindo e normalizando as respostas dentro de cada estado.
- **Regras financeiras em tabelas** com vigência, versionadas e auditadas.
- **Fila de eventos** para entrega ao CRM e notificações, garantindo reprocessamento.
- **Parsers determinísticos primeiro:** valores monetários, sim/não, datas, telefone, e-mail, opções numeradas e comandos ("voltar", "corrigir", "sair", "corretor") são interpretados por código; o LLM local entra apenas como fallback de extração (saída em JSON validada por schema) e na redação/FAQ a partir de trechos cadastrados. Resposta inválida do LLM nunca avança o estado: o bot repergunta.
- **Confirmação explícita** dos valores-chave (renda, entrada, dívidas) antes de calcular.
- **Guardrails no LLM:** não inventar taxas, preços, prazos ou condições; só usar dados da base e do motor; recusar assuntos fora do escopo.

### 9.3 Tecnologias sugeridas (referência)

- Backend: Node.js + TypeScript (Fastify), validação com Zod, ORM Prisma, testes com Vitest
- Banco de dados: PostgreSQL (separado do banco do WA-AKG); fila em PostgreSQL no MVP (Redis opcional depois)
- Canais: WA-AKG no MVP (Docker, isolado); WhatsApp Business Platform (API oficial) em produção
- LLM: local e leve via Ollama no MVP (modelo escolhido por bateria de testes em PT-BR), atrás de `LlmClient`; prompts versionados e testes de regressão
- PDF: biblioteca de renderização HTML→PDF
- Painel: React/Next.js (pós-MVP; no MVP, parâmetros por seed/CLI com auditoria)
- Infra: contêineres em cloud, com CI/CD

---

## 10. Modelo de dados (resumo)

Implementação (MVP): `packages/db/prisma/schema.prisma`, com identificadores em inglês. A correspondência com os nomes abaixo está em `packages/db/README.md`. `LinhaCredito` pertence a uma versão de parâmetros (`ParameterSet`), que guarda a vigência. Versões são imutáveis, e alterar parâmetros cria nova versão com auditoria.

```
Lead
  id, nome, telefone, email, data_nascimento, origem, campanha,
  consentimento_id, status, score, classe, corretor_id, criado_em

Consentimento
  id, lead_id, texto_versao, canal, aceito_em, revogado_em

Conversa
  id, lead_id, canal, estado_atual, historico, iniciada_em, atualizada_em, handoff

PerfilFinanceiro
  id, lead_id, renda_bruta, tipo_renda, dividas_mensais, entrada_disponivel,
  fgts_saldo, fgts_tempo_meses, possui_imovel, primeiro_imovel,
  coproponente_renda, coproponente_nascimento

Empreendimento
  id, nome, cidade, descricao, previsao_entrega, faq, materiais

Unidade
  id, empreendimento_id, tipologia, area, valor, status (disponível/reservada/vendida)

Simulacao
  id, lead_id, unidade_id, linha_credito_id, sistema, prazo,
  valor_financiavel, entrada_necessaria, subsidio, fgts_usado,
  primeira_parcela, ultima_parcela, fluxo_obra (json), parecer,
  parametros_versao, gerada_em, pdf_url

LinhaCredito
  id, nome, renda_max, valor_imovel_max, cota_max, taxa_aa,
  seguro_mip, seguro_dfi, taxa_adm, idade_max, prazo_max,
  vigencia_inicio, vigencia_fim

Corretor
  id, nome, telefone, email, equipe, ativo, escala

DistribuicaoLead
  id, lead_id, corretor_id, atribuido_em, primeiro_contato_em, sla_estourado

ResultadoContato
  id, lead_id, corretor_id, resultado, motivo_perda, observacoes, registrado_em

LogAuditoria
  id, usuario_id, entidade, acao, antes, depois, em
```

---

## 11. Integrações

| Sistema                                          | Finalidade                                | Direção             | Observação                            |
| ------------------------------------------------ | ----------------------------------------- | ------------------- | ------------------------------------- |
| WhatsApp (WA-AKG no MVP; API oficial em produção) | Canal de conversa                        | Bidirecional        | Via `ChannelAdapter`; opt-in; templates só na API oficial |
| CRM simulado (MVP) → RD Station, HubSpot, Salesforce ou próprio | Criar/atualizar lead, registrar simulação | Bot → CRM | `CrmAdapter`; evitar duplicidade por telefone |
| Espelho de vendas                                | Disponibilidade e preço de unidades       | Sistema → Bot       | Tempo real ou sincronização periódica |
| Agenda (Google/Outlook)                          | Agendar visita ao stand                   | Bidirecional        | Opcional na v1                        |
| E-mail transacional                              | Enviar PDF e notificações                 | Bot → Lead/Corretor |                                       |
| Analytics (GA/Meta Pixel)                        | Atribuição de campanha                    | Bot → Plataforma    | Respeitar consentimento               |

---

## 12. Casos de borda e tratamento

| Situação                                        | Tratamento                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Lead não informa renda                          | Oferecer faixa aproximada; se recusar, encaminhar ao corretor sem simulação |
| Renda informal/sem comprovação                  | Simular com aviso e marcar alerta no dossiê                                 |
| Valor digitado inconsistente (ex.: renda R$ 5)  | Pedir confirmação                                                           |
| Idade acima do limite                           | Informar com cuidado e sugerir co-proponente                                |
| Unidade vendida durante a conversa              | Avisar e sugerir alternativas                                               |
| Mudança de tabela no meio da conversa           | Usar a versão vigente na geração e registrar a versão                       |
| Falha no CRM                                    | Enfileirar e reenviar; alertar o administrador                              |
| Lead já existente no CRM                        | Vincular e notificar o corretor responsável                                 |
| Lead pede para falar com humano                 | Handoff imediato fora do horário: registrar e agendar retorno               |
| Mensagem de áudio/imagem                        | Orientar a responder por texto (v1); transcrição na v2                      |
| Pedido de taxa ou condição "garantida"          | Reforçar que é simulação indicativa                                         |
| Tentativa de manipular o bot (prompt injection) | Ignorar instruções fora do fluxo e manter o escopo                          |
| Mensagem de grupo ou enviada pelo próprio número (`fromMe`) | Ignorar; o bot só responde a conversas privadas iniciadas pelo lead |
| Webhook reentregue / mensagem duplicada         | Processar uma única vez (idempotência pelo id da mensagem)                  |
| Identificador do contato em formato LID, sem telefone | Resolver o telefone pelos campos alternativos do gateway; se impossível, pedir o telefone ao lead |
| LLM devolve saída inválida ou de baixa confiança | Repetir a pergunta com exemplo; após N falhas, oferecer handoff             |

---

## 13. Critérios de aceitação (v1)

- [ ] O lead conclui a simulação via WhatsApp em até 5 minutos, sem intervenção humana.
- [ ] O consentimento LGPD é registrado antes da coleta de dados pessoais.
- [ ] Os cálculos de SAC e Price conferem com planilha de referência da área financeira em todos os casos de teste.
- [ ] O parecer (viável / com ajustes / inviável) é coerente com as regras parametrizadas.
- [ ] O corretor recebe o dossiê e o PDF em até 1 minuto após a conclusão.
- [ ] O lead é criado no CRM sem duplicidade e com a simulação anexada.
- [ ] O handoff humano funciona em qualquer etapa e preserva o histórico.
- [ ] O financeiro consegue alterar taxas e faixas no painel, sem deploy, com histórico de alterações.
- [ ] O bot nunca informa valores que não venham do motor ou da base cadastrada.
- [ ] Painel exibe métricas básicas do funil.
- [ ] Fluxo de exclusão de dados do titular funciona.

---

## 14. Plano de entrega

### Fase 1 – MVP / piloto controlado (6 a 8 semanas)

Piloto com número dedicado, volume baixo e leads com opt-in (ver §7.7). Detalhamento fase a fase em `docs/04-plano.md`.

- Canal WhatsApp via WA-AKG (`ChannelAdapter`) + fila de entrada + fluxo de coleta
- Camada de linguagem: parsers determinísticos + LLM local como fallback
- Motor de simulação (SAC/Price, enquadramento básico, FGTS)
- Dossiê ao corretor (WhatsApp) + PDF simples
- CRM simulado (`CrmAdapter`), sem duplicidade por telefone
- Parâmetros financeiros e empreendimentos por seed/CLI, com vigência e auditoria (painel fica para a Fase 2)
- Handoff humano
- LGPD básica (consentimento versionado e exclusão)

### Fase 2 – Evolução (4 a 6 semanas)

- Migração para a API oficial do WhatsApp (`CloudApiAdapter`) e templates
- Painel administrativo de parâmetros, empreendimentos e regras
- Integração com CRM real
- Score de lead com pesos configuráveis
- Distribuição avançada e SLA com reatribuição
- Follow-up e reativação automática
- Cenários alternativos e sugestão de unidades
- Painel de métricas completo
- Integração com espelho de vendas em tempo real

### Fase 3 – Expansão

- Widget no site e outros canais
- Entrada por áudio (transcrição)
- Agendamento de visita integrado à agenda
- Pré-preenchimento de ficha cadastral e proposta
- Análise preditiva de conversão

> Prazos indicativos; ajustar após definição de CRM, canais e escopo de integrações.

---

## 15. Riscos e mitigação

| Risco                                 | Impacto                     | Mitigação                                                                           |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| Regras/taxas de crédito mudam         | Simulação desatualizada     | Parâmetros com vigência, responsável pela atualização e alerta de revisão periódica |
| Lead entende simulação como aprovação | Risco jurídico/reputacional | Avisos legais claros, linguagem cuidadosa, revisão jurídica                         |
| LLM "inventa" valores                 | Perda de confiança          | Cálculo determinístico, guardrails, testes de regressão                             |
| Vazamento de dados financeiros        | Sanções LGPD                | Criptografia, RBAC, minimização, auditoria                                          |
| Baixa adesão dos corretores           | Lead desperdiçado           | SLA, gamificação, dossiê enxuto, treinamento                                        |
| Bloqueio de número no WhatsApp (**alto** no MVP, pelo uso do WA-AKG não oficial) | Perda de canal e violação dos termos | Piloto com número dedicado, sem envio em massa nem mensagens frias, respeito a opt-out; adaptador permite migrar para a API oficial |
| Webhook perdido (WA-AKG sem retry: uma tentativa, timeout 10 s — confirmado no código v1.7.0) | Mensagem de lead perdida | Ingress mínimo com fila persistente e idempotência; conferir logs de entrega do WA-AKG |
| LLM local errar extração           | Dado financeiro incorreto   | Parsers determinísticos primeiro, schema estrito, confirmação dos valores-chave, bateria de testes de modelo |
| Integração com CRM instável           | Lead perdido                | Fila, reprocessamento e alertas                                                     |

---

## 16. Questões em aberto

1. Qual CRM a construtora utiliza hoje?
2. Quais linhas de crédito e bancos serão contemplados na v1 (programa habitacional, SBPE, financiamento direto com a construtora)?
3. Quem será o responsável por manter as taxas e regras atualizadas?
4. O espelho de vendas tem API ou será atualizado por planilha?
5. Haverá vários empreendimentos simultâneos ou um lançamento por vez?
6. Como é a política de distribuição de leads atual (roleta, plantão, equipes por empreendimento)?
7. O corretor prefere receber o dossiê por WhatsApp, e-mail ou direto no CRM?
8. Há tabela de fluxo de obra padrão (sinal, parcelas, reforços) por empreendimento?
9. Qual o texto jurídico aprovado para consentimento e avisos legais?
10. Existe identidade visual para o PDF e tom de voz definido para o bot?

---

## 17. Glossário

- **SAC:** Sistema de Amortização Constante; parcelas decrescentes.
- **Price:** parcelas fixas ao longo do prazo.
- **SBPE:** Sistema Brasileiro de Poupança e Empréstimo.
- **FGTS:** Fundo de Garantia do Tempo de Serviço.
- **MIP:** Morte e Invalidez Permanente (seguro).
- **DFI:** Danos Físicos ao Imóvel (seguro).
- **Cota de financiamento:** percentual máximo do valor do imóvel que pode ser financiado.
- **Espelho de vendas:** mapa de disponibilidade das unidades de um empreendimento.
- **Handoff:** transferência da conversa do bot para um atendente humano.
- **Co-proponente:** pessoa que soma renda ao financiamento.
- **LGPD:** Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
