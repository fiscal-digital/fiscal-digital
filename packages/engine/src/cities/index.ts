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
    active: true,
  },
  '3550308': {
    cityId: '3550308',
    name: 'São Paulo',
    slug: 'sao-paulo',
    uf: 'SP',
    hashtag: 'SaoPaulo',
    subreddit: 'FiscalDigitalBR',
    active: true,
  },
  '3509502': {
    cityId: '3509502',
    name: 'Campinas',
    slug: 'campinas',
    uf: 'SP',
    hashtag: 'Campinas',
    subreddit: 'FiscalDigitalBR',
    active: true,
  },
  '4205407': {
    cityId: '4205407',
    name: 'Florianópolis',
    slug: 'florianopolis',
    uf: 'SC',
    hashtag: 'Florianopolis',
    subreddit: 'FiscalDigitalBR',
    active: true,
  },
  '4106902': {
    cityId: '4106902',
    name: 'Curitiba',
    slug: 'curitiba',
    uf: 'PR',
    hashtag: 'Curitiba',
    subreddit: 'FiscalDigitalBR',
    active: true,
  },
  // Top 50 Brasil por população
  '3304557': { cityId: '3304557', name: 'Rio de Janeiro',           slug: 'rio-de-janeiro',           uf: 'RJ', hashtag: 'RioDeJaneiro',          subreddit: 'FiscalDigitalBR', active: true  },
  '5300108': { cityId: '5300108', name: 'Brasília',                 slug: 'brasilia',                 uf: 'DF', hashtag: 'Brasilia',               subreddit: 'FiscalDigitalBR', active: true  },
  '2304400': { cityId: '2304400', name: 'Fortaleza',                slug: 'fortaleza',                uf: 'CE', hashtag: 'Fortaleza',              subreddit: 'FiscalDigitalBR', active: true  },
  '2927408': { cityId: '2927408', name: 'Salvador',                 slug: 'salvador',                 uf: 'BA', hashtag: 'Salvador',               subreddit: 'FiscalDigitalBR', active: true  },
  '3106200': { cityId: '3106200', name: 'Belo Horizonte',           slug: 'belo-horizonte',           uf: 'MG', hashtag: 'BeloHorizonte',          subreddit: 'FiscalDigitalBR', active: true  },
  '1302603': { cityId: '1302603', name: 'Manaus',                   slug: 'manaus',                   uf: 'AM', hashtag: 'Manaus',                  subreddit: 'FiscalDigitalBR', active: true  },
  '2611606': { cityId: '2611606', name: 'Recife',                   slug: 'recife',                   uf: 'PE', hashtag: 'Recife',                  subreddit: 'FiscalDigitalBR', active: true  },
  '5208707': { cityId: '5208707', name: 'Goiânia',                  slug: 'goiania',                  uf: 'GO', hashtag: 'Goiania',                 subreddit: 'FiscalDigitalBR', active: true  },
  '1501402': { cityId: '1501402', name: 'Belém',                    slug: 'belem',                    uf: 'PA', hashtag: 'Belem',                   subreddit: 'FiscalDigitalBR', active: true  },
  '3518800': { cityId: '3518800', name: 'Guarulhos',                slug: 'guarulhos',                uf: 'SP', hashtag: 'Guarulhos',               subreddit: 'FiscalDigitalBR', active: true  },
  '2111300': { cityId: '2111300', name: 'São Luís',                 slug: 'sao-luis',                 uf: 'MA', hashtag: 'SaoLuis',                 subreddit: 'FiscalDigitalBR', active: true  },
  '2704302': { cityId: '2704302', name: 'Maceió',                   slug: 'maceio',                   uf: 'AL', hashtag: 'Maceio',                  subreddit: 'FiscalDigitalBR', active: true  },
  '5002704': { cityId: '5002704', name: 'Campo Grande',             slug: 'campo-grande',             uf: 'MS', hashtag: 'CampoGrande',             subreddit: 'FiscalDigitalBR', active: true  },
  '3304904': { cityId: '3304904', name: 'São Gonçalo',              slug: 'sao-goncalo',              uf: 'RJ', hashtag: 'SaoGoncalo',              subreddit: 'FiscalDigitalBR', active: true  },
  '2211001': { cityId: '2211001', name: 'Teresina',                 slug: 'teresina',                 uf: 'PI', hashtag: 'Teresina',                subreddit: 'FiscalDigitalBR', active: true  },
  '2507507': { cityId: '2507507', name: 'João Pessoa',              slug: 'joao-pessoa',              uf: 'PB', hashtag: 'JoaoPessoa',              subreddit: 'FiscalDigitalBR', active: true  },
  '3548708': { cityId: '3548708', name: 'São Bernardo do Campo',    slug: 'sao-bernardo-do-campo',    uf: 'SP', hashtag: 'SaoBernardoDoCampo',     subreddit: 'FiscalDigitalBR', active: true  },
  '3301702': { cityId: '3301702', name: 'Duque de Caxias',          slug: 'duque-de-caxias',          uf: 'RJ', hashtag: 'DuqueDeCaxias',           subreddit: 'FiscalDigitalBR', active: true  },
  '3303500': { cityId: '3303500', name: 'Nova Iguaçu',              slug: 'nova-iguacu',              uf: 'RJ', hashtag: 'NovaIguacu',              subreddit: 'FiscalDigitalBR', active: true  },
  '2408102': { cityId: '2408102', name: 'Natal',                    slug: 'natal',                    uf: 'RN', hashtag: 'Natal',                   subreddit: 'FiscalDigitalBR', active: true  },
  '3547809': { cityId: '3547809', name: 'Santo André',              slug: 'santo-andre',              uf: 'SP', hashtag: 'SantoAndre',              subreddit: 'FiscalDigitalBR', active: true  },
  '3534401': { cityId: '3534401', name: 'Osasco',                   slug: 'osasco',                   uf: 'SP', hashtag: 'Osasco',                  subreddit: 'FiscalDigitalBR', active: true  },
  '3552205': { cityId: '3552205', name: 'Sorocaba',                 slug: 'sorocaba',                 uf: 'SP', hashtag: 'Sorocaba',                subreddit: 'FiscalDigitalBR', active: true  },
  '3170206': { cityId: '3170206', name: 'Uberlândia',               slug: 'uberlandia',               uf: 'MG', hashtag: 'Uberlandia',              subreddit: 'FiscalDigitalBR', active: true  },
  '3543402': { cityId: '3543402', name: 'Ribeirão Preto',           slug: 'ribeirao-preto',           uf: 'SP', hashtag: 'RibeiraoPreto',           subreddit: 'FiscalDigitalBR', active: true  },
  '3549904': { cityId: '3549904', name: 'São José dos Campos',      slug: 'sao-jose-dos-campos',      uf: 'SP', hashtag: 'SaoJosedosCampos',        subreddit: 'FiscalDigitalBR', active: true  },
  '5103403': { cityId: '5103403', name: 'Cuiabá',                   slug: 'cuiaba',                   uf: 'MT', hashtag: 'Cuiaba',                  subreddit: 'FiscalDigitalBR', active: true  },
  '2607901': { cityId: '2607901', name: 'Jaboatão dos Guararapes',  slug: 'jaboatao-dos-guararapes',  uf: 'PE', hashtag: 'JaboataodosGuararapes',   subreddit: 'FiscalDigitalBR', active: true  },
  '3118601': { cityId: '3118601', name: 'Contagem',                 slug: 'contagem',                 uf: 'MG', hashtag: 'Contagem',                subreddit: 'FiscalDigitalBR', active: true  },
  '4209102': { cityId: '4209102', name: 'Joinville',                slug: 'joinville',                uf: 'SC', hashtag: 'Joinville',               subreddit: 'FiscalDigitalBR', active: true  },
  '2910800': { cityId: '2910800', name: 'Feira de Santana',         slug: 'feira-de-santana',         uf: 'BA', hashtag: 'FeiradeSantana',          subreddit: 'FiscalDigitalBR', active: true  },
  '2800308': { cityId: '2800308', name: 'Aracaju',                  slug: 'aracaju',                  uf: 'SE', hashtag: 'Aracaju',                  subreddit: 'FiscalDigitalBR', active: true  },
  '4113700': { cityId: '4113700', name: 'Londrina',                 slug: 'londrina',                 uf: 'PR', hashtag: 'Londrina',                subreddit: 'FiscalDigitalBR', active: true  },
  '3136702': { cityId: '3136702', name: 'Juiz de Fora',             slug: 'juiz-de-fora',             uf: 'MG', hashtag: 'JuizdeFora',              subreddit: 'FiscalDigitalBR', active: true  },
  '5201405': { cityId: '5201405', name: 'Aparecida de Goiânia',     slug: 'aparecida-de-goiania',     uf: 'GO', hashtag: 'AparecidadeGoiania',      subreddit: 'FiscalDigitalBR', active: true  },
  '3205002': { cityId: '3205002', name: 'Serra',                    slug: 'serra',                    uf: 'ES', hashtag: 'Serra',                   subreddit: 'FiscalDigitalBR', active: true  },
  '3301009': { cityId: '3301009', name: 'Campos dos Goytacazes',    slug: 'campos-dos-goytacazes',    uf: 'RJ', hashtag: 'CamposdosGoytacazes',     subreddit: 'FiscalDigitalBR', active: true  },
  '3300456': { cityId: '3300456', name: 'Belford Roxo',             slug: 'belford-roxo',             uf: 'RJ', hashtag: 'BelfordRoxo',             subreddit: 'FiscalDigitalBR', active: true  },
  '3303302': { cityId: '3303302', name: 'Niterói',                  slug: 'niteroi',                  uf: 'RJ', hashtag: 'Niteroi',                  subreddit: 'FiscalDigitalBR', active: true  },
  '3549805': { cityId: '3549805', name: 'São José do Rio Preto',    slug: 'sao-jose-do-rio-preto',    uf: 'SP', hashtag: 'SaoJosedoRioPreto',       subreddit: 'FiscalDigitalBR', active: true  },
  '1500800': { cityId: '1500800', name: 'Ananindeua',               slug: 'ananindeua',               uf: 'PA', hashtag: 'Ananindeua',               subreddit: 'FiscalDigitalBR', active: true  },
  '3205200': { cityId: '3205200', name: 'Vila Velha',               slug: 'vila-velha',               uf: 'ES', hashtag: 'VilaVelha',               subreddit: 'FiscalDigitalBR', active: true  },
  '1100205': { cityId: '1100205', name: 'Porto Velho',              slug: 'porto-velho',              uf: 'RO', hashtag: 'PortoVelho',              subreddit: 'FiscalDigitalBR', active: true  },
  '3530607': { cityId: '3530607', name: 'Mogi das Cruzes',          slug: 'mogi-das-cruzes',          uf: 'SP', hashtag: 'MogidosCruzes',           subreddit: 'FiscalDigitalBR', active: true  },
  // Canoas e Passo Fundo sem cobertura QD confirmada
  '4304606': { cityId: '4304606', name: 'Canoas',      slug: 'canoas',      uf: 'RS', hashtag: 'Canoas',      subreddit: 'FiscalDigitalBR', active: false },
  '4314100': { cityId: '4314100', name: 'Passo Fundo', slug: 'passo-fundo', uf: 'RS', hashtag: 'PassoFundo', subreddit: 'FiscalDigitalBR', active: false },
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
