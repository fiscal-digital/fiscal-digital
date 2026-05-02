import type { Gazette } from '../../types'

const BASE_GAZETTE: Gazette = {
  id: 'gazette-nepotismo-001',
  territory_id: '4305108',
  date: '2026-04-15',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=nepotismo-test',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

// ─── Caso A — Sobrenome RARO 3+ vezes → DISPARA indício ──────────────────────

/**
 * Sobrenome "Albuquerque" (fora do top 50 IBGE) repetido 3 vezes em nomeações
 * para cargos em comissão. Deve emitir nepotismo_indicio com confidence >= 0.95.
 */
export const gazetteSobrenomeRaroTresVezes: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-A',
  date: '2026-04-15',
  excerpts: [
    'PORTARIAS DE PESSOAL — Secretaria Municipal de Administração. ' +
    'NOMEIA Carlos Albuquerque para o cargo em comissão de Chefe de Divisão. ' +
    'NOMEIA Beatriz Albuquerque para Diretora de Departamento, cargo em comissão. ' +
    'NOMEIA Roberto Albuquerque para Assessor Especial, cargo em comissão. ' +
    'NOMEIA Maria da Silva para Chefe de Seção em cargo em comissão.',
  ],
}

// ─── Caso B — Sobrenome COMUM (Silva) 5 vezes → NÃO DISPARA ───────────────────

/**
 * Cinco nomeações com sobrenome "Silva". Apesar do volume, é o sobrenome
 * mais comum do Brasil → blocklist → não emite finding.
 */
export const gazetteSobrenomeComumCincoVezes: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-B',
  date: '2026-04-20',
  excerpts: [
    'PORTARIAS — Secretaria Municipal de Educação. ' +
    'NOMEIA Maria da Silva para Chefe de Divisão, cargo em comissão. ' +
    'NOMEIA João Silva para Diretor, cargo em comissão. ' +
    'NOMEIA Ana Silva para Assessora, cargo em comissão. ' +
    'NOMEIA Pedro Silva para Coordenador de Projetos, cargo em comissão. ' +
    'NOMEIA Carla Silva para Chefe de Seção, cargo em comissão.',
  ],
}

// ─── Caso C — Sobrenome RARO 1x → NÃO DISPARA (abaixo do threshold 3) ────────

/**
 * Apenas uma nomeação com sobrenome incomum. Coincidência absoluta —
 * nunca emite finding.
 */
export const gazetteSobrenomeRaroUmaVez: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-C',
  date: '2026-04-22',
  excerpts: [
    'PORTARIA n° 312/2026. NOMEIA Carlos Albuquerque para o cargo em comissão de ' +
    'Chefe de Divisão na Secretaria de Saúde. NOMEIA Maria da Silva para o cargo em ' +
    'comissão de Assessora Técnica.',
  ],
}

// ─── Caso D — Sobrenome RARO 2x → NÃO DISPARA (limiar é 3) ───────────────────

/**
 * Duas pessoas com sobrenome "Albuquerque". Threshold MVP é conservador (3+).
 * Coincidência de duas pessoas ainda é plausivelmente aleatória.
 */
export const gazetteSobrenomeRaroDuasVezes: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-D',
  date: '2026-04-23',
  excerpts: [
    'PORTARIAS DE PESSOAL. NOMEIA Carlos Albuquerque para Chefe de Divisão, ' +
    'cargo em comissão. NOMEIA Beatriz Albuquerque para Diretora, cargo em comissão. ' +
    'NOMEIA Maria da Silva para Assessora, cargo em comissão.',
  ],
}

// ─── Caso E — Sem cargo em comissão → NÃO DISPARA (filtro etapa 1) ───────────

/**
 * Três Albuquerques nomeados, mas para cargos efetivos (não em comissão).
 * Filtro etapa 1 descarta — nepotismo aplicável só a cargos em comissão.
 */
export const gazetteSemCargoComissao: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-E',
  date: '2026-04-25',
  excerpts: [
    'NOMEIA Carlos Albuquerque para o cargo efetivo de Analista, conforme aprovação ' +
    'em concurso público. NOMEIA Beatriz Albuquerque para o cargo efetivo de Técnico ' +
    'em Enfermagem. NOMEIA Roberto Albuquerque para o cargo efetivo de Engenheiro Civil.',
  ],
}

// ─── Caso F — Excerpt sem nomeações → NÃO DISPARA ────────────────────────────

/**
 * Excerpt só com licitação. Filtro etapa 1 descarta.
 */
export const gazetteSemNomeacao: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-F',
  date: '2026-04-26',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 055/2026. Objeto: aquisição de material de escritório. ' +
    'Valor: R$ 15.000,00. Contratada: Papelaria Central LTDA, CNPJ: 11.222.333/0001-44.',
  ],
}

// ─── Caso G — Sobrenome raro 4x → confidence MAIOR que com 3x ────────────────

export const gazetteSobrenomeRaroQuatroVezes: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-G',
  date: '2026-05-02',
  excerpts: [
    'PORTARIAS DE PESSOAL. ' +
    'NOMEIA Carlos Albuquerque para Chefe de Divisão, cargo em comissão. ' +
    'NOMEIA Beatriz Albuquerque para Diretora, cargo em comissão. ' +
    'NOMEIA Roberto Albuquerque para Coordenador, cargo em comissão. ' +
    'NOMEIA Patricia Albuquerque para Assessora Especial, cargo em comissão.',
  ],
}

// ─── Caso H — Sobrenomes raros DIFERENTES, 2x cada → NÃO DISPARA ─────────────

/**
 * Dois "Albuquerque" + dois "Cavalcanti". Ambos abaixo do threshold de 3
 * por grupo. Sobrenomes raros diferentes não somam.
 */
export const gazetteDoisSobrenomesRarosCadaUmDuasVezes: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-H',
  date: '2026-05-05',
  excerpts: [
    'NOMEIA Carlos Albuquerque para Chefe de Divisão, cargo em comissão. ' +
    'NOMEIA Beatriz Albuquerque para Diretora, cargo em comissão. ' +
    'NOMEIA Roberto Cavalcanti para Coordenador, cargo em comissão. ' +
    'NOMEIA Patricia Cavalcanti para Assessora, cargo em comissão.',
  ],
}

// ─── Caso I — Nome simples (1 token) → IGNORADO pela extração ────────────────

/**
 * "NOMEIA Carlos para...". Sem sobrenome → extração ignora.
 * Garante robustez contra edge cases de OCR mal-formado.
 */
export const gazetteNomeSimples: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-I',
  date: '2026-05-06',
  excerpts: [
    'PORTARIA. NOMEIA Carlos para o cargo em comissão. NOMEIA Beatriz para cargo em ' +
    'comissão. NOMEIA Roberto para cargo em comissão.',
  ],
}

// ─── Caso J — Múltiplos excerpts da mesma gazette consolidam ─────────────────

/**
 * Três excerpts SEPARADOS, cada um com um Albuquerque. O Fiscal consolida
 * por gazette (não por excerpt) → 3 ocorrências = dispara.
 */
export const gazetteSobrenomeRaroMultiplosExcerpts: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-nepotismo-J',
  date: '2026-05-08',
  excerpts: [
    'PORTARIA 101/2026. NOMEIA Carlos Albuquerque para Chefe de Divisão, cargo em comissão.',
    'PORTARIA 102/2026. NOMEIA Beatriz Albuquerque para Diretora, cargo em comissão.',
    'PORTARIA 103/2026. NOMEIA Roberto Albuquerque para Coordenador, cargo em comissão.',
  ],
}
