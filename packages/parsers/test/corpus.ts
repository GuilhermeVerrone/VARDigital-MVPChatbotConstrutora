// Conjunto de teste dos parsers: frases de lead em PT-BR e o resultado esperado.
// `null` = o parser deve se abster (ambíguo/sem dado) para o orquestrador repetir a pergunta
// ou acionar o LLM. Errar o valor é pior do que se abster: o teste exige zero valores errados.

export type Case<T> = readonly [input: string, expected: T];

export const money: Case<number | null>[] = [
  ['5k', 5000], ['5K', 5000], ['uns 5 mil', 5000], ['R$ 5.000', 5000], ['R$5000', 5000], ['5000', 5000],
  ['5.000,00', 5000], ['5000,50', 5000.5], ['R$ 5.500,75', 5500.75], ['5 mil', 5000], ['5mil', 5000],
  ['7 mil reais', 7000], ['uns 7 mil', 7000], ['cerca de 7 mil', 7000], ['aproximadamente 12 mil', 12000],
  ['mais ou menos 3500', 3500], ['3.500', 3500], ['3,5 mil', 3500], ['3.5 mil', 3500], ['2,5k', 2500],
  ['cinco mil', 5000], ['dois mil e quinhentos', 2500], ['três mil e duzentos', 3200], ['mil reais', 1000],
  ['mil e quinhentos', 1500], ['dez mil', 10000], ['quinze mil reais', 15000], ['vinte e cinco mil', 25000],
  ['cento e vinte mil', 120000], ['trezentos mil', 300000], ['1 milhão', 1_000_000], ['1,5 milhão', 1_500_000],
  ['dois milhões', 2_000_000], ['um milhão e meio', 1_500_000], ['meio milhão', 500_000], ['2 milhões e 300 mil', 2_300_000],
  ['5 mil e 500', 5500], ['5 mil e quinhentos', 5500], ['5 mil e pouco', 5000], ['uns 800 reais', 800],
  ['800', 800], ['R$ 800,00', 800], ['1.200', 1200], ['1200', 1200], ['1.2k', 1200], ['12k', 12000],
  ['150 mil', 150000], ['R$ 150.000', 150000], ['R$ 150.000,00', 150000], ['280k', 280000], ['uns 40 mil de entrada', 40000],
  ['tenho 30 mil guardados', 30000], ['ganho 7 mil por mês', 7000], ['minha renda é de R$ 6.000', 6000],
  ['a renda da familia é uns 9 mil', 9000], ['dá uns 4500', 4500], ['4500 mais ou menos', 4500],
  ['paga 800 por mês', 800], ['pago 1.150 de parcela', 1150], ['1150 reais', 1150], ['uns 2 mil de cartão', 2000],
  ['nada', 0], ['zero', 0], ['não tenho', 0], ['nenhuma', 0], ['sem dívidas', 0], ['não pago nada', 0],
  ['não tenho entrada', 0], ['0', 0], ['R$ 0', 0], ['nao tenho nenhuma divida', 0], ['sem entrada', 0],
  ['6k liquido', 6000], ['6 k', 6000], ['8.500 bruto', 8500], ['oito mil e quinhentos', 8500], ['onze mil', 11000],
  // abstenção esperada
  ['entre 5 e 6 mil', null], ['5 ou 6 mil', null], ['ganho 5 mil e pago 800', null], ['não sei', null],
  ['depende do mês', null], ['oi', null], ['quero simular', null], ['tenho 2 filhos', null], ['30 anos', null],
  ['10x de 500', null], ['não tenho 5 mil', null], ['sim', null], ['15%', null], ['13981264295', null],
  ['', null], ['   ', null], ['sei lá, varia', null], ['5 mil ou 8 mil', null], ['de 3 a 4 mil', null],
  ['tenho 2 filhos e ganho 5 mil', 5000], ['um financiamento de 800 por mês', 800],
];

export const yesNo: Case<boolean | null>[] = [
  ['sim', true], ['Sim', true], ['SIM', true], ['s', true], ['ss', true], ['sim!', true], ['sim.', true], ['claro', true],
  ['com certeza', true], ['isso', true], ['isso mesmo', true], ['confere', true], ['confirmo', true], ['correto', true],
  ['ok', true], ['pode ser', true], ['pode sim', true], ['tenho', true], ['tenho sim', true], ['possuo', true],
  ['sou sim', true], ['quero', true], ['aceito', true], ['positivo', true], ['uhum', true], ['aham', true],
  ['👍', true], ['✅', true], ['certo', true], ['exato', true], ['perfeito', true], ['beleza', true], ['sim, tenho', true],
  ['sim, pode', true], ['sim senhor', true], ['claro que sim', true], ['é isso mesmo', true], ['sim, confere', true],
  ['não', false], ['Não', false], ['NÃO', false], ['nao', false], ['n', false], ['nn', false], ['não.', false],
  ['nao!', false], ['negativo', false], ['nunca', false], ['não tenho', false], ['nao tenho', false], ['não possuo', false],
  ['não quero', false], ['de jeito nenhum', false], ['👎', false], ['❌', false], ['não, obrigado', false],
  ['não tenho nenhum', false], ['não, nunca tive', false], ['não é', false], ['nao e o primeiro', false],
  ['não sou', false], ['nenhum', false], ['jamais', false], ['não, não tenho', false], ['nope', false],
  // abstenção esperada
  ['talvez', null], ['não sei', null], ['depende', null], ['acho que sim', null], ['sim e não', null], ['sim, mas não tenho certeza', null],
  ['como assim?', null], ['oi', null], ['quero falar com corretor', null], ['5 mil', null], ['', null],
  ['não sei se tenho', null], ['sei lá', null], ['quem sabe', null], ['nao entendi', null],
  ['eu estava pensando em comprar um apartamento grande para minha familia no centro', null],
];

export const dates: Case<string | null>[] = [
  ['05/03/1990', '1990-03-05'], ['5/3/1990', '1990-03-05'], ['05-03-1990', '1990-03-05'], ['05.03.1990', '1990-03-05'],
  ['05031990', '1990-03-05'], ['5/3/90', '1990-03-05'], ['05/03/85', '1985-03-05'], ['31/12/1975', '1975-12-31'],
  ['01/01/2000', '2000-01-01'], ['29/02/1992', '1992-02-29'], ['5 de março de 1990', '1990-03-05'],
  ['5 de marco de 1990', '1990-03-05'], ['05 de março de 90', '1990-03-05'], ['12 de dezembro de 1988', '1988-12-12'],
  ['1 de janeiro de 1970', '1970-01-01'], ['nasci em 05/03/1990', '1990-03-05'], ['nasci dia 15/08/1983', '1983-08-15'],
  ['minha data de nascimento é 22/11/1979', '1979-11-22'], ['22 nov 1979', '1979-11-22'], ['3 mar 1995', '1995-03-03'],
  ['1990-03-05', '1990-03-05'], ['05 03 1990', '1990-03-05'], ['25/07/2001', '2001-07-25'], ['10/10/1960', '1960-10-10'],
  ['09/09/1999', '1999-09-09'], ['15/05/1955', '1955-05-15'], ['  05/03/1990  ', '1990-03-05'], ['05/03/1990.', '1990-03-05'],
  ['dia 5 de março de 1990', '1990-03-05'], ['28/02/1993', '1993-02-28'], ['31 de outubro de 1987', '1987-10-31'],
  // abstenção esperada
  ['31/02/1990', null], ['29/02/1991', null], ['32/01/1990', null], ['03/25/1990', null], ['00/01/1990', null],
  ['05/03/2999', null], ['1990', null], ['março de 1990', null], ['oi', null], ['não sei', null], ['', null],
  ['05/03/1990 e 06/04/1991', null], ['13981264295', null], ['5 mil', null], ['trinta anos', null], ['05/13/1990', null],
  ['hoje', null], ['uns 35 anos', null],
];

export const names: Case<string | null>[] = [
  ['Maria Silva', 'Maria Silva'], ['maria silva', 'Maria Silva'], ['MARIA SILVA', 'Maria Silva'], ['João da Silva', 'João da Silva'],
  ['joão da silva', 'João da Silva'], ['Ana Paula de Souza', 'Ana Paula de Souza'], ['meu nome é Carlos Eduardo', 'Carlos Eduardo'],
  ['Meu nome é Carlos Eduardo Lima', 'Carlos Eduardo Lima'], ['me chamo Fernanda Oliveira', 'Fernanda Oliveira'],
  ['sou o Pedro Henrique Santos', 'Pedro Henrique Santos'], ['sou a Juliana Costa', 'Juliana Costa'], ['Sou Marcos Vinícius', 'Marcos Vinícius'],
  ['aqui é a Patrícia Almeida', 'Patrícia Almeida'], ['nome: Ricardo Alves', 'Ricardo Alves'], ['Nome completo: Beatriz Nunes', 'Beatriz Nunes'],
  ['José Carlos dos Santos', 'José Carlos dos Santos'], ['Luiz Felipe das Neves', 'Luiz Felipe das Neves'], ['Maria José', 'Maria José'],
  ['Ana Li', 'Ana Li'], ['Ivo Mello', 'Ivo Mello'], ['Gabriel D\'Ávila', 'Gabriel D\'Ávila'], ['Anne-Marie Dubois', 'Anne-Marie Dubois'],
  ['olá, meu nome é Rafael Moreira', 'Rafael Moreira'], ['Bom dia, sou Camila Ferreira', 'Camila Ferreira'], ['Thiago Mendes.', 'Thiago Mendes'],
  ['mariana vieira dias', 'Mariana Vieira Dias'], ['Francisco de Assis Pereira', 'Francisco de Assis Pereira'], ['Lúcia Helena', 'Lúcia Helena'],
  ['Antônio Carlos Jobim', 'Antônio Carlos Jobim'], ['pode me chamar de Bruno Tavares', 'Bruno Tavares'],
  // abstenção esperada
  ['Maria', null], ['João', null], ['oi', null], ['sim', null], ['bom dia', null], ['boa tarde tudo bem', null], ['quero simular', null],
  ['maria123 silva', null], ['5 mil', null], ['', null], ['M S', null], ['M. Silva', null], ['sou de São Paulo', null],
  ['meu email é a@b.com', null], ['quero falar com corretor', null], ['não', null], ['de Souza', null], ['Maria da', null],
  ['tenho interesse no apartamento', null], ['qual o valor da entrada', null], ['a b c d e f g h', null], ['Maria Silva 13981264295', null],
];

export const phones: Case<string | null>[] = [
  ['13981264295', '5513981264295'], ['(13) 98126-4295', '5513981264295'], ['13 98126-4295', '5513981264295'],
  ['+55 13 98126-4295', '5513981264295'], ['+5513981264295', '5513981264295'], ['5513981264295', '5513981264295'],
  ['(11) 99999-1234', '5511999991234'], ['11 91234 5678', '5511912345678'], ['meu whats é (21) 98765-4321', '5521987654321'],
  ['41987654321', '5541987654321'], ['085 99876-5432'.replace('085', '85'), '5585998765432'], ['(13) 3222-1234', '551332221234'],
  ['1332221234', '551332221234'], ['1381264295', '5513981264295'], ['(11) 8765-4321', '5511987654321'],
  ['(61) 99123-4567', '5561991234567'], ['telefone: 31 98888-7777', '5531988887777'], ['55 11 98765-4321', '5511987654321'],
  ['11987654321.', '5511987654321'], ['  (47) 99911-2233 ', '5547999112233'],
  // abstenção esperada
  ['98126-4295', null], ['981264295', null], ['123', null], ['00000000000', null], ['(00) 98126-4295', null], ['(10) 98126-4295', null],
  ['13881264295', null], ['oi', null], ['', null], ['5 mil', null], ['05/03/1990', null], ['123456789012345', null], ['(13) 1234', null],
  ['44 13981264295', null], ['11999999999', null],
];

export const emails: Case<string | null>[] = [
  ['maria@gmail.com', 'maria@gmail.com'], ['Maria.Silva@Gmail.com', 'maria.silva@gmail.com'], ['meu email é joao_99@hotmail.com', 'joao_99@hotmail.com'],
  ['joao+corretor@empresa.com.br', 'joao+corretor@empresa.com.br'], ['contato@dominio.com.br.', 'contato@dominio.com.br'],
  ['pode ser ana@outlook.com mesmo', 'ana@outlook.com'], ['  x.y@z.io  ', 'x.y@z.io'], ['a-b@c-d.org', 'a-b@c-d.org'],
  ['email: lucas@uol.com.br', 'lucas@uol.com.br'], ['carlos@empresa.net', 'carlos@empresa.net'],
  ['maria@', null], ['maria@gmail', null], ['@gmail.com', null], ['maria gmail.com', null], ['não tenho', null], ['a@b.com e c@d.com', null],
  ['oi', null], ['', null], ['maria..silva@gmail.com', null], ['maria@gmail.c', null], ['5 mil', null], ['maria@@gmail.com', null],
];

export const durations: Case<number | null>[] = [
  ['3 anos', 36], ['36 meses', 36], ['2 anos e meio', 30], ['1 ano e 6 meses', 18], ['seis meses', 6], ['uns 5 anos', 60],
  ['30 anos', 360], ['360 meses', 360], ['dois anos', 24], ['1 ano', 12], ['um ano', 12], ['10 meses', 10], ['2 anos e 3 meses', 27],
  ['trabalho há 4 anos', 48], ['faz 8 anos', 96], ['35 anos', 420], ['quinze anos', 180], ['um ano e meio', 18], ['3 anos e meio', 42],
  ['mais ou menos 7 meses', 7], ['vinte e cinco anos', 300],
  ['30', null], ['oi', null], ['', null], ['5 mil', null], ['não sei', null], ['0 meses', null],
];

import type { OptionDef } from '../src';

export const listOptions: OptionDef[] = [
  { id: 'STUDIO', label: 'Studio', aliases: ['stúdio', 'kitnet'] },
  { id: 'DOIS_Q', label: '2 quartos', aliases: ['dois quartos', 'apartamento de 2 quartos'] },
  { id: 'TRES_Q', label: '3 quartos', aliases: ['tres quartos', 'três quartos'] },
];

export const options: Case<string | null>[] = [
  ['1', 'STUDIO'], ['2', 'DOIS_Q'], ['3', 'TRES_Q'], [' 2 ', 'DOIS_Q'], ['2.', 'DOIS_Q'], ['2)', 'DOIS_Q'], ['opção 3', 'TRES_Q'],
  ['opcao 1', 'STUDIO'], ['a segunda', 'DOIS_Q'], ['a primeira', 'STUDIO'], ['terceira', 'TRES_Q'], ['dois', 'DOIS_Q'],
  ['três', 'TRES_Q'], ['quero a 3', 'TRES_Q'], ['pode ser a 2', 'DOIS_Q'], ['letra b', 'DOIS_Q'], ['studio', 'STUDIO'], ['Studio', 'STUDIO'],
  ['quero o studio', 'STUDIO'], ['kitnet', 'STUDIO'], ['3 quartos', 'TRES_Q'], ['três quartos', 'TRES_Q'], ['tres quartos', 'TRES_Q'],
  ['o de 2 quartos', 'DOIS_Q'], ['dois quartos', 'DOIS_Q'], ['stúdio', 'STUDIO'], ['studios', 'STUDIO'],
  ['4', null], ['0', null], ['10', null], ['quarta', null], ['oi', null], ['', null], ['não sei', null], ['studio ou 3 quartos', null],
  ['cobertura', null], ['quero o maior', null],
];

export const incomeTypes: Case<string | null>[] = [
  ['1', 'CLT'], ['2', 'AUTONOMO'], ['3', 'SERVIDOR'], ['4', 'APOSENTADO'], ['5', 'OUTROS'], ['clt', 'CLT'], ['CLT', 'CLT'],
  ['sou clt', 'CLT'], ['carteira assinada', 'CLT'], ['trabalho com carteira assinada', 'CLT'], ['autônomo', 'AUTONOMO'], ['autonomo', 'AUTONOMO'],
  ['sou autônomo', 'AUTONOMO'], ['sou autonoma', 'AUTONOMO'], ['MEI', 'AUTONOMO'], ['profissional liberal', 'AUTONOMO'], ['por conta própria', 'AUTONOMO'],
  ['servidor público', 'SERVIDOR'], ['sou servidor', 'SERVIDOR'], ['concursado', 'SERVIDOR'], ['funcionário público', 'SERVIDOR'],
  ['aposentado', 'APOSENTADO'], ['aposentada', 'APOSENTADO'], ['pensionista', 'APOSENTADO'], ['recebo pelo INSS', 'APOSENTADO'],
  ['outros', 'OUTROS'], ['outro', 'OUTROS'], ['empresário', 'AUTONOMO'], ['informal', 'AUTONOMO'], ['freelancer', 'AUTONOMO'],
  ['6', null], ['oi', null], ['', null], ['não sei', null], ['clt e autônomo', null], ['sim', null],
];

export const commands: Case<string | null>[] = [
  ['voltar', 'back'], ['Voltar', 'back'], ['volta', 'back'], ['quero voltar', 'back'], ['voltar uma etapa', 'back'], ['pode voltar', 'back'],
  ['voltar pergunta', 'back'], ['retornar', 'back'], ['pergunta anterior', 'back'],
  ['corrigir', 'correct'], ['corrigir renda', 'correct:renda'], ['quero corrigir a renda', 'correct:renda'], ['corrige o nome', 'correct:nome'],
  ['alterar a entrada', 'correct:entrada'], ['mudar minha renda', 'correct:renda'], ['errei', 'correct'], ['a renda está errada', 'correct:renda'],
  ['o telefone ta errado', 'correct:telefone'], ['digitei errado', 'correct'], ['quero alterar o email', 'correct:email'],
  ['sair', 'exit'], ['Sair', 'exit'], ['encerrar', 'exit'], ['quero sair', 'exit'], ['tchau', 'exit'], ['cancelar', 'exit'], ['desistir', 'exit'],
  ['quero encerrar a conversa', 'exit'], ['finalizar', 'exit'],
  ['corretor', 'human'], ['Corretor', 'human'], ['atendente', 'human'], ['humano', 'human'], ['falar com corretor', 'human'],
  ['quero falar com um corretor', 'human'], ['quero falar com atendente', 'human'], ['me passa para um atendente', 'human'],
  ['preciso de um humano', 'human'], ['chama o corretor', 'human'], ['quero conversar com uma pessoa', 'human'],
  ['gostaria de falar com o vendedor', 'human'], ['pode me transferir para o corretor?', 'human'], ['quero um corretor', 'human'],
  ['falar com alguém', 'human'], ['o corretor pode me ligar', 'human'],
  ['parar', 'optout'], ['PARAR', 'optout'], ['stop', 'optout'], ['não quero mais receber mensagens', 'optout'], ['parar de receber mensagens', 'optout'],
  ['para de me mandar mensagem', 'optout'], ['me descadastra', 'optout'], ['descadastrar', 'optout'],
  ['apagar meus dados', 'lgpd_request'], ['quero que apaguem meus dados', 'lgpd_request'], ['excluir meus dados pessoais', 'lgpd_request'],
  ['quero excluir meu cadastro', 'lgpd_request'], ['deletar meus dados', 'lgpd_request'], ['quero remover meus dados da base', 'lgpd_request'],
  ['LGPD', 'lgpd_request'], ['direito ao esquecimento', 'lgpd_request'], ['apague tudo sobre mim e meus dados', 'lgpd_request'],
  // não são comandos
  ['não quero falar com corretor', null], ['o corretor me ligou ontem e disse que o apartamento tem 2 quartos e fica no centro', null],
  ['oi', null], ['sim', null], ['5 mil', null], ['', null], ['minha renda é 5 mil', null], ['3 anos', null], ['Maria Silva', null],
  ['quero saber o valor da entrada', null], ['volto amanhã', null], ['não vou voltar atrás', null], ['quero simular um apartamento', null],
  ['corretora da construtora é boa?', null], ['qual o prazo de entrega', null],
];
