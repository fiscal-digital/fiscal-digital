/**
 * Mapeamento de cidades cobertas pelo Fiscal Digital.
 *
 * Indexado por `cityId` (territory_id IBGE — 7 dígitos).
 * Usado por publisher (formatação de alerta + roteamento de subreddit) e por
 * fiscais (filtros, dashboards). Adicionar nova cidade = adicionar entry aqui.
 *
 * Status `active`:
 *   - true  = MVP/Sprint atual (Fase 1)
 *   - false = mapeada mas não publicada (Fase 2 ou futuro)
 */

export interface City {
  /** IBGE territory_id de 7 dígitos. */
  cityId: string
  /** Nome legível em português ("Caxias do Sul"). */
  name: string
  /** Slug URL-safe ("caxias-do-sul"). */
  slug: string
  /** UF de 2 letras ("RS"). */
  uf: string
  /** Hashtag sem o `#` ("CaxiasdoSul"). */
  hashtag: string
  /** Subreddit padrão sem o `r/`. Override por env `REDDIT_SUBREDDIT`. */
  subreddit: string
  /** Cidade está em produção ativa (Fase 1) ou planejada (Fase 2+). */
  active: boolean
}

export const CITIES: Record<string, City> = {
  '4305108': {
    cityId: '4305108',
    name: 'Caxias do Sul',
    slug: 'caxias-do-sul',
    uf: 'RS',
    hashtag: 'CaxiasdoSul',
    subreddit: 'FiscalDigitalBR',
    active: true,
  },
  '4314902': {
    cityId: '4314902',
    name: 'Porto Alegre',
    slug: 'porto-alegre',
    uf: 'RS',
    hashtag: 'PortoAlegre',
    subreddit: 'FiscalDigitalBR',
    active: false,
  },
  '4304606': {
    cityId: '4304606',
    name: 'Canoas',
    slug: 'canoas',
    uf: 'RS',
    hashtag: 'Canoas',
    subreddit: 'FiscalDigitalBR',
    active: false,
  },
  '4314100': {
    cityId: '4314100',
    name: 'Passo Fundo',
    slug: 'passo-fundo',
    uf: 'RS',
    hashtag: 'PassoFundo',
    subreddit: 'FiscalDigitalBR',
    active: false,
  },
}

/**
 * Busca cidade por IBGE. Retorna `undefined` se desconhecida.
 * Use quando ausência precisa ser tratada explicitamente (ex: validação).
 */
export function getCity(cityId: string): City | undefined {
  return CITIES[cityId]
}

/**
 * Busca cidade por IBGE com fallback para entry sintética.
 * Use em formatação onde nunca queremos crashar — fallback usa o próprio
 * `cityId` em todos os campos textuais para que o alerta ainda seja publicável.
 */
export function getCityOrFallback(cityId: string): City {
  return CITIES[cityId] ?? {
    cityId,
    name: cityId,
    slug: cityId,
    uf: '',
    hashtag: cityId,
    subreddit: 'FiscalDigitalBR',
    active: false,
  }
}

/** Lista todas as cidades ativas em produção (Fase 1). */
export function activeCities(): City[] {
  return Object.values(CITIES).filter((c) => c.active)
}
