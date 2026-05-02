import type { EventBridgeEvent } from 'aws-lambda'
import { runCollector } from './collector'

interface BackfillPayload {
  territory_id?: string
  since?: string
  backfill?: boolean
}

// Top 50 cidades brasileiras por população com cobertura ativa
const CIDADES = [
  { territory_id: '3550308', name: 'São Paulo' },
  { territory_id: '3304557', name: 'Rio de Janeiro' },
  { territory_id: '5300108', name: 'Brasília' },
  { territory_id: '2304400', name: 'Fortaleza' },
  { territory_id: '2927408', name: 'Salvador' },
  { territory_id: '3106200', name: 'Belo Horizonte' },
  { territory_id: '1302603', name: 'Manaus' },
  { territory_id: '4106902', name: 'Curitiba' },
  { territory_id: '2611606', name: 'Recife' },
  { territory_id: '5208707', name: 'Goiânia' },
  { territory_id: '4314902', name: 'Porto Alegre' },
  { territory_id: '1501402', name: 'Belém' },
  { territory_id: '3518800', name: 'Guarulhos' },
  { territory_id: '3509502', name: 'Campinas' },
  { territory_id: '2111300', name: 'São Luís' },
  { territory_id: '2704302', name: 'Maceió' },
  { territory_id: '5002704', name: 'Campo Grande' },
  { territory_id: '3304904', name: 'São Gonçalo' },
  { territory_id: '2211001', name: 'Teresina' },
  { territory_id: '2507507', name: 'João Pessoa' },
  { territory_id: '3548708', name: 'São Bernardo do Campo' },
  { territory_id: '3301702', name: 'Duque de Caxias' },
  { territory_id: '3303500', name: 'Nova Iguaçu' },
  { territory_id: '2408102', name: 'Natal' },
  { territory_id: '3547809', name: 'Santo André' },
  { territory_id: '3534401', name: 'Osasco' },
  { territory_id: '3552205', name: 'Sorocaba' },
  { territory_id: '3170206', name: 'Uberlândia' },
  { territory_id: '3543402', name: 'Ribeirão Preto' },
  { territory_id: '3549904', name: 'São José dos Campos' },
  { territory_id: '5103403', name: 'Cuiabá' },
  { territory_id: '2607901', name: 'Jaboatão dos Guararapes' },
  { territory_id: '3118601', name: 'Contagem' },
  { territory_id: '4209102', name: 'Joinville' },
  { territory_id: '2910800', name: 'Feira de Santana' },
  { territory_id: '2800308', name: 'Aracaju' },
  { territory_id: '4113700', name: 'Londrina' },
  { territory_id: '3136702', name: 'Juiz de Fora' },
  { territory_id: '4205407', name: 'Florianópolis' },
  { territory_id: '5201405', name: 'Aparecida de Goiânia' },
  { territory_id: '3205002', name: 'Serra' },
  { territory_id: '3301009', name: 'Campos dos Goytacazes' },
  { territory_id: '3300456', name: 'Belford Roxo' },
  { territory_id: '3303302', name: 'Niterói' },
  { territory_id: '3549805', name: 'São José do Rio Preto' },
  { territory_id: '1500800', name: 'Ananindeua' },
  { territory_id: '3205200', name: 'Vila Velha' },
  { territory_id: '1100205', name: 'Porto Velho' },
  { territory_id: '3530607', name: 'Mogi das Cruzes' },
  { territory_id: '4305108', name: 'Caxias do Sul' },
]

export const handler = async (
  event: EventBridgeEvent<'Scheduled Event', BackfillPayload>,
): Promise<void> => {
  const detail = event.detail ?? {}

  // Manual backfill: single city with explicit since date
  if (detail.backfill && detail.territory_id) {
    console.log(`[collector] backfill ${detail.territory_id} since=${detail.since}`)
    const result = await runCollector({ territory_id: detail.territory_id, since: detail.since })
    console.log(`[collector] done processed=${result.processed} sent=${result.sent}`)
    return
  }

  // Daily run: all cities in parallel
  const results = await Promise.allSettled(
    CIDADES.map(c => runCollector({ territory_id: c.territory_id }).then(r => ({ ...r, name: c.name }))),
  )

  for (const r of results) {
    if (r.status === 'fulfilled') {
      console.log(`[collector] ${r.value.name} processed=${r.value.processed} sent=${r.value.sent}`)
    } else {
      console.error('[collector] error', r.reason)
    }
  }
}
