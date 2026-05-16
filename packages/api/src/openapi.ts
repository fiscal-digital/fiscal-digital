/**
 * OpenAPI 3.1 spec da API pública do Fiscal Digital.
 *
 * Servida em `GET /openapi.json`. Consumida por:
 *  - LLMs com tool use (Claude tools, ChatGPT actions) — geração automática
 *    de função handlers a partir da spec
 *  - Plugin manifests (`/.well-known/ai-plugin.json` no site)
 *  - Geradores de docs (Scalar, Redoc)
 *
 * Servers declara `api.fiscaldigital.org` (forward-looking). Quando o
 * subdomínio for ativado, OpenAPI continua válido sem rewrite.
 *
 * Blueprint AI SEO Onda 2 Item 1 (Seções 5.1 e 6.6).
 */

const SERVER_URL = 'https://api.fiscaldigital.org'
const SITE_URL = 'https://fiscaldigital.org'

export const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Fiscal Digital API',
    summary: 'Autonomous oversight of Brazilian municipal public spending',
    description: [
      'API REST pública do Fiscal Digital. Retorna alertas de fiscalização autônoma',
      'de gastos públicos municipais brasileiros, com fonte primária no Querido',
      'Diário/OKFN. Todos os dados sob licença CC-BY-4.0; atribuição obrigatória.',
      '',
      'Cada resposta 200 carrega headers de citação (`x-source`, `x-license`,',
      '`x-attribution`) e suporta cache via `ETag` + `If-None-Match` (304).',
      '',
      'Sem autenticação. Sem rate limit explícito (CloudFront na frente).',
    ].join('\n'),
    version: '1.0.0',
    license: {
      name: 'CC-BY-4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
    },
    contact: {
      name: 'Fiscal Digital',
      url: SITE_URL,
      email: 'lineu@fiscaldigital.org',
    },
    termsOfService: `${SITE_URL}/pt-br/sobre`,
    'x-attribution-required': 'Fiscal Digital (fiscaldigital.org), com base em dados do Querido Diário/OKFN',
  },
  servers: [
    {
      url: SERVER_URL,
      description: 'Produção',
    },
  ],
  tags: [
    { name: 'alerts', description: 'Alertas de fiscalização (findings)' },
    { name: 'cities', description: 'Cidades cobertas e estatísticas por cidade' },
    { name: 'stats', description: 'Agregados gerais do corpus' },
    { name: 'feeds', description: 'Feeds RSS para leitores e crawlers' },
    { name: 'transparency', description: 'Transparência operacional (custos)' },
    { name: 'meta', description: 'Health check e descoberta' },
  ],
  paths: {
    '/alerts': {
      get: {
        operationId: 'listAlerts',
        tags: ['alerts'],
        summary: 'Lista alertas publicados',
        description:
          'Retorna alertas filtráveis por cidade, estado, tipo ou busca textual. Paginado. Apenas findings com `riskScore >= 60` e `confidence >= 0.70` são retornados.',
        parameters: [
          { $ref: '#/components/parameters/CityFilter' },
          { $ref: '#/components/parameters/StateFilter' },
          { $ref: '#/components/parameters/TypeFilter' },
          { $ref: '#/components/parameters/SearchFilter' },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/SizeParam' },
        ],
        responses: {
          '200': {
            description: 'Lista paginada de alertas',
            headers: { $ref: '#/components/headers/StandardCitationHeaders' },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AlertsResponse' },
              },
            },
          },
          '304': { $ref: '#/components/responses/NotModified' },
        },
      },
    },
    '/alerts/{slug}': {
      get: {
        operationId: 'getAlert',
        tags: ['alerts'],
        summary: 'Detalha um alerta por slug',
        description:
          'Retorna um alerta individual identificado pelo `slug` (base64url do ID interno). GetItem O(1) em DynamoDB. Aplica gate de publicação.',
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Slug base64url do ID do finding',
            example: 'RklORElORyNmaXNjYWwtbGljaXRhY29lcyM0MzA1MTA4I2RpcGVuc2FfaXJyZWd1bGFy',
          },
        ],
        responses: {
          '200': {
            description: 'Alerta encontrado',
            headers: { $ref: '#/components/headers/StandardCitationHeaders' },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Finding' },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/cities': {
      get: {
        operationId: 'listCities',
        tags: ['cities'],
        summary: 'Lista todas as cidades cobertas',
        description:
          'Retorna as 50 cidades ativas + 2 planejadas, com contagem de findings publicáveis e timestamp do último alerta.',
        responses: {
          '200': {
            description: 'Lista de cidades',
            headers: { $ref: '#/components/headers/StandardCitationHeaders' },
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/City' },
                },
              },
            },
          },
        },
      },
    },
    '/cities/{cityId}/stats': {
      get: {
        operationId: 'getCityStats',
        tags: ['cities'],
        summary: 'Estatísticas por cidade',
        description:
          'Retorna métricas por cidade: gazettes processadas, findings publicáveis, período coberto.',
        parameters: [
          {
            name: 'cityId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'IBGE 7-digit territory ID',
            example: '4305108',
          },
        ],
        responses: {
          '200': {
            description: 'Stats da cidade',
            headers: { $ref: '#/components/headers/StandardCitationHeaders' },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CityStats' },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/stats': {
      get: {
        operationId: 'getStats',
        tags: ['stats'],
        summary: 'Estatísticas agregadas globais',
        description:
          'Total de findings, breakdown por Fiscal/cidade/tipo, custo estimado em BRL, uptime.',
        responses: {
          '200': {
            description: 'Stats globais',
            headers: { $ref: '#/components/headers/StandardCitationHeaders' },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Stats' },
              },
            },
          },
        },
      },
    },
    '/rss': {
      get: {
        operationId: 'getRssFeed',
        tags: ['feeds'],
        summary: 'Feed RSS 2.0 de alertas',
        description:
          'Feed RSS atualizado. Suporta filtros por `state`, `city`, `type` via query string.',
        parameters: [
          { $ref: '#/components/parameters/CityFilter' },
          { $ref: '#/components/parameters/StateFilter' },
          { $ref: '#/components/parameters/TypeFilter' },
        ],
        responses: {
          '200': {
            description: 'XML RSS 2.0',
            content: {
              'application/rss+xml': {
                schema: { type: 'string', format: 'xml' },
              },
            },
          },
        },
      },
    },
    '/transparencia/costs': {
      get: {
        operationId: 'getCosts',
        tags: ['transparency'],
        summary: 'Custos operacionais do Fiscal Digital',
        description:
          'Snapshots diários + mensal. Coleta via AWS Cost Explorer, valores em BRL via PTAX BCB.',
        parameters: [
          {
            name: 'days',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
            description: 'Janela em dias',
          },
        ],
        responses: {
          '200': {
            description: 'Custos do período',
            headers: { $ref: '#/components/headers/StandardCitationHeaders' },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CostsResponse' },
              },
            },
          },
        },
      },
    },
    '/transparencia/costs/mtd': {
      get: {
        operationId: 'getCostsMtd',
        tags: ['transparency'],
        summary: 'Custo MTD + projeção mensal',
        description: 'Endpoint focado para Hero do site. Cache 1h.',
        responses: {
          '200': {
            description: 'Custo MTD',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CostsMtd' },
              },
            },
          },
          '503': {
            description: 'Custos ainda não disponíveis (collector não rodou)',
          },
        },
      },
    },
    '/transparencia/costs/feed.xml': {
      get: {
        operationId: 'getCostsRss',
        tags: ['transparency', 'feeds'],
        summary: 'Feed RSS de custos diários',
        responses: {
          '200': {
            description: 'XML RSS 2.0',
            content: {
              'application/rss+xml': {
                schema: { type: 'string', format: 'xml' },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'getHealth',
        tags: ['meta'],
        summary: 'Health check + lista de endpoints',
        responses: {
          '200': {
            description: 'API up',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
              },
            },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApi',
        tags: ['meta'],
        summary: 'Esta especificação OpenAPI 3.1',
        responses: {
          '200': {
            description: 'OpenAPI spec',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      CityFilter: {
        name: 'city',
        in: 'query',
        schema: { type: 'string' },
        description: 'IBGE 7-digit territory ID',
        example: '4305108',
      },
      StateFilter: {
        name: 'state',
        in: 'query',
        schema: { type: 'string', minLength: 2, maxLength: 2 },
        description: 'UF (2 letras maiúsculas)',
        example: 'RS',
      },
      TypeFilter: {
        name: 'type',
        in: 'query',
        schema: {
          type: 'string',
          enum: [
            'dispensa_irregular',
            'fracionamento',
            'aditivo_abusivo',
            'prorrogacao_excessiva',
            'cnpj_jovem',
            'concentracao_fornecedor',
            'pico_nomeacoes',
            'rotatividade_anormal',
            'inexigibilidade_sem_justificativa',
            'padrao_recorrente',
            'convenio_sem_chamamento',
            'repasse_recorrente_osc',
            'diaria_irregular',
            'publicidade_eleitoral',
            'locacao_sem_justificativa',
            'nepotismo_indicio',
            'cnpj_situacao_irregular',
            'fornecedor_sancionado',
          ],
        },
        description: 'Tipo do achado',
      },
      SearchFilter: {
        name: 'search',
        in: 'query',
        schema: { type: 'string' },
        description: 'Busca textual livre (city, cnpj, narrative, secretaria)',
      },
      PageParam: {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', minimum: 1, default: 1 },
      },
      SizeParam: {
        name: 'size',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
    headers: {
      StandardCitationHeaders: {
        description: 'Headers de citação e cache padrão',
        schema: { type: 'object' },
        // Documentation purposes — actual headers:
        //   etag, last-modified, x-source, x-license, x-attribution,
        //   access-control-allow-origin, link
      },
    },
    responses: {
      NotFound: {
        description: 'Recurso não encontrado',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      NotModified: {
        description: 'Resposta cacheada (If-None-Match casou ETag atual)',
      },
    },
    schemas: {
      Finding: {
        type: 'object',
        required: ['id', 'type', 'cityId', 'city', 'state', 'riskScore', 'confidence', 'createdAt'],
        properties: {
          id: {
            type: 'string',
            description: 'ID interno; formato `FINDING#fiscalId#cityId#type#date#hash`',
          },
          fiscalId: { type: 'string', description: 'Agente Fiscal que detectou' },
          type: { type: 'string', description: 'Tipo do achado (ver enum em TypeFilter)' },
          cityId: { type: 'string', description: 'IBGE 7-digit' },
          city: { type: 'string' },
          state: { type: 'string', minLength: 2, maxLength: 2 },
          riskScore: { type: 'number', minimum: 0, maximum: 100 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          value: { type: 'number', description: 'Valor financeiro em BRL' },
          cnpj: { type: 'string', description: 'CNPJ envolvido (se houver)' },
          contractNumber: { type: 'string' },
          secretaria: { type: 'string' },
          legalBasis: { type: 'string', description: 'Base legal citada' },
          narrative: { type: 'string', description: 'Narrativa gerada por LLM' },
          source: { type: 'string', format: 'uri', description: 'URL do diário oficial no Querido Diário' },
          cachedPdfUrl: { type: 'string', format: 'uri', nullable: true },
          pdfProxyUrl: { type: 'string', format: 'uri', nullable: true },
          evidence: {
            type: 'array',
            items: { $ref: '#/components/schemas/Evidence' },
          },
          published: { type: 'boolean' },
          publishedAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Evidence: {
        type: 'object',
        required: ['source', 'excerpt'],
        properties: {
          source: { type: 'string', format: 'uri' },
          excerpt: { type: 'string' },
          date: { type: 'string', format: 'date' },
        },
      },
      AlertsResponse: {
        type: 'object',
        required: ['total', 'items'],
        properties: {
          total: { type: 'integer' },
          filters: { type: 'object', additionalProperties: { type: 'string' } },
          pageInfo: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              totalPages: { type: 'integer' },
              totalValue: { type: 'number', description: 'Soma de values em BRL' },
              citiesCount: { type: 'integer' },
            },
          },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Finding' },
          },
        },
      },
      City: {
        type: 'object',
        required: ['cityId', 'name', 'slug', 'uf', 'active', 'findingsCount'],
        properties: {
          cityId: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          uf: { type: 'string' },
          active: { type: 'boolean' },
          findingsCount: { type: 'integer' },
          lastFindingAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      CityStats: {
        type: 'object',
        properties: {
          cityId: { type: 'string' },
          totalGazettesProcessed: { type: 'integer' },
          totalFindings: { type: 'integer' },
          lastFindingAt: { type: 'string', format: 'date-time', nullable: true },
          periodCovered: {
            type: 'object',
            nullable: true,
            properties: {
              from: { type: 'string', format: 'date' },
              to: { type: 'string', format: 'date' },
            },
          },
        },
      },
      Stats: {
        type: 'object',
        properties: {
          totalFindings: { type: 'integer' },
          totalGazettesProcessed: { type: 'integer', nullable: true },
          findingsByFiscal: { type: 'object', additionalProperties: { type: 'integer' } },
          findingsByCity: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                cityId: { type: 'string' },
                name: { type: 'string' },
                count: { type: 'integer' },
              },
            },
          },
          findingsByType: { type: 'object', additionalProperties: { type: 'integer' } },
          estimatedCostBrl: { type: 'number' },
          lastFindingAt: { type: 'string', format: 'date-time', nullable: true },
          uptimeDays: { type: 'integer' },
        },
      },
      CostsResponse: {
        type: 'object',
        properties: {
          currency: { type: 'string', enum: ['BRL'] },
          days: { type: 'integer' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          monthly: { type: 'object', nullable: true },
          daily: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', format: 'date' },
                totalBrl: { type: 'number' },
                totalUsd: { type: 'number' },
                ptaxBrl: { type: 'number' },
                byService: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      service: { type: 'string' },
                      brl: { type: 'number' },
                      usd: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      CostsMtd: {
        type: 'object',
        properties: {
          currency: { type: 'string', enum: ['BRL'] },
          month: { type: 'string', description: 'YYYY-MM' },
          mtdBrl: { type: 'number' },
          projectedBrl: { type: 'number' },
          lifetimeBrl: { type: 'number' },
          deltaPct: { type: 'number', nullable: true },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          source: { type: 'string', enum: ['aws-cost-explorer'] },
        },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok'] },
          version: { type: 'string' },
          cities: { type: 'integer' },
          lastDeployedAt: { type: 'string', format: 'date-time' },
          endpoints: { type: 'array', items: { type: 'string' } },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
    },
  },
  externalDocs: {
    description: 'Documentação completa do projeto',
    url: `${SITE_URL}/pt-br/sobre`,
  },
  'x-license': 'CC-BY-4.0',
  'x-source-data': 'https://queridodiario.ok.org.br',
} as const
