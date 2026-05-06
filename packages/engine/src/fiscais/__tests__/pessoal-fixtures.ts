import type { Gazette } from '../../types'

const BASE_GAZETTE: Gazette = {
  id: 'gazette-pessoal-001',
  territory_id: '4305108',
  date: '2026-08-15',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=pessoal-test',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

// ─── Pico de nomeações ────────────────────────────────────────────────────────

/**
 * Caso 1 — Janela eleitoral 2026 (ago/2026) + 7 atos de pessoal → dispara pico_nomeacoes (alto).
 * 7 atos >= limiar 5 em janela eleitoral.
 */
export const gazettePicoNomeacoesJanelaEleitoral: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-pessoal-001',
  date: '2026-08-15',
  excerpts: [
    'PORTARIAS DE PESSOAL — Secretaria Municipal de Administração. ' +
    'NOMEIA Maria da Silva para o cargo em comissão de Chefe de Divisão. ' +
    'NOMEIA João de Oliveira para Diretor de Departamento. ' +
    'EXONERA Pedro Rodrigues do cargo em comissão de Assessor Técnico. ' +
    'NOMEIA Ana Costa para Assessor Técnico, Secretaria de Saúde. ' +
    'DESIGNA Carlos Souza para responder pelo cargo de Diretor. ' +
    'EXONERA Luiza Ferreira do cargo em comissão de Chefe de Seção. ' +
    'NOMEIA Roberto Lima para Chefe de Seção na Secretaria de Educação.',
  ],
}

/**
 * Caso 2 — Fora da janela eleitoral (março/2026) + 7 atos → NÃO dispara em
 * cidade `medium` (Caxias 463k hab; limiar fora janela medium = 10).
 * Disparararia em cidade `small` (limiar 7) — exercitado em test separado.
 */
export const gazettePicoForaJanela7Atos: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-pessoal-002',
  date: '2026-03-10',
  excerpts: [
    'PORTARIAS DE PESSOAL — Secretaria Municipal de Obras. ' +
    'NOMEIA Fernanda Castro para o cargo em comissão de Diretora de Obras. ' +
    'NOMEIA Marcelo Duarte para Chefe de Divisão de Projetos. ' +
    'EXONERA Sandra Mendes do cargo em comissão de Assessora. ' +
    'NOMEIA Fabio Martins para Assessor Técnico Sênior. ' +
    'DESIGNA Renata Alves para responder pela Diretoria. ' +
    'EXONERA Paulo Gomes do cargo em comissão de Coordenador. ' +
    'NOMEIA Juliana Vieira para Coordenadora de Planejamento.',
  ],
}

/**
 * Caso 3 — Fora da janela eleitoral (fevereiro/2026) + 12 atos → dispara pico_nomeacoes
 * com riskScore baixo (informativo, fora de janela eleitoral).
 */
export const gazettePicoForaJanela12Atos: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-pessoal-003',
  date: '2026-02-20',
  excerpts: [
    'PORTARIAS DE PESSOAL — Secretaria Municipal de Finanças. ' +
    'NOMEIA Ana Lima para Diretora de Tributação. ' +
    'NOMEIA José Pereira para Chefe de Divisão Fiscal. ' +
    'EXONERA Marcos Souza do cargo em comissão de Assessor. ' +
    'NOMEIA Clara Ferraz para Assessora Fiscal. ' +
    'DESIGNA Bruno Costa para responder pela Diretoria de Arrecadação. ' +
    'EXONERA Luciana Santos do cargo em comissão de Chefe de Seção. ' +
    'NOMEIA Felipe Rodrigues para Chefe de Seção Tributária. ' +
    'NOMEIA Daniela Melo para Assessora de Planejamento Orçamentário. ' +
    'EXONERA Sérgio Alves do cargo em comissão de Coordenador Fiscal. ' +
    'NOMEIA Patrícia Dias para Coordenadora de Arrecadação Municipal. ' +
    'DESIGNA Tiago Moreira para exercer a função de Chefe de Gabinete. ' +
    'NOMEIA Vanessa Cunha para Diretora de Controle Interno.',
  ],
}

/**
 * Caso 4 — Janela eleitoral 2026 + apenas 3 atos → NÃO dispara em cidade
 * `medium` (Caxias 463k hab; limiar eleitoral medium = 5). Dispararia em
 * cidade `small` (limiar 3) — exercitado em test separado.
 */
export const gazettePicoJanelaEleitoral3Atos: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-pessoal-004',
  date: '2026-09-01',
  excerpts: [
    'PORTARIA n° 312/2026. O Prefeito Municipal NOMEIA Carlos Eduardo para o cargo em comissão ' +
    'de Chefe de Divisão na Secretaria de Saúde, a partir de 01/09/2026. ' +
    'EXONERA Maria Aparecida do cargo em comissão de Assessora Técnica. ' +
    'NOMEIA Rodrigo Nascimento para Assessor Técnico Sênior.',
  ],
}

// ─── Rotatividade anormal ─────────────────────────────────────────────────────

/**
 * Caso 5 — Mesmo cargo comissionado: exoneração + nomeação no mesmo excerpt (2 titulares).
 * Dispara rotatividade_anormal.
 */
export const gazetteRotatividadeAnormal: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-pessoal-005',
  date: '2026-05-10',
  excerpts: [
    'PORTARIA n° 198/2026. O Prefeito Municipal, no uso das atribuições legais, ' +
    'EXONERANDO o Sr. Antônio Rocha do cargo em comissão de Chefe da Divisão de Contratos, ' +
    'a partir de 10/05/2026, e na sequência NOMEANDO a Sra. Bruna Tavares para o mesmo ' +
    'cargo em comissão de Chefe da Divisão de Contratos junto à Secretaria Municipal de Administração, ' +
    'com efeitos a partir da mesma data.',
  ],
}

/**
 * Caso 6 — Excerpt sem palavras-chave de pessoal → filtro etapa 1 retorna [].
 */
export const gazettesSemTermosPessoal: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-pessoal-006',
  date: '2026-05-15',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 055/2026. Objeto: aquisição de material de escritório. ' +
    'Valor: R$ 15.000,00. Contratada: Papelaria Central LTDA, CNPJ: 11.222.333/0001-44. ' +
    'Secretaria Municipal de Administração. Base Legal: Lei 14.133/2021, Art. 75, II.',
  ],
}
