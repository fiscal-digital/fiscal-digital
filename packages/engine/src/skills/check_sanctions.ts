import type { Skill, SkillResult } from '../types'

const CGU_API = 'https://api.portaldatransparencia.gov.br/api-de-dados'

export interface CheckSanctionsInput {
  cnpj: string
  apiKey?: string  // chave-api-dados do Portal da Transparência
}

export interface SanctionRecord {
  type: 'CEIS' | 'CNEP'
  sanction: string
  startDate?: string
  endDate?: string
  organ?: string
}

export interface SanctionResult {
  sanctioned: boolean
  records: SanctionRecord[]
}

export const checkSanctions: Skill<CheckSanctionsInput> = {
  name: 'check_sanctions',
  description: 'Verifica se empresa consta no CEIS/CNEP (CGU) — empresas suspensas e multadas',

  async execute(input: CheckSanctionsInput): Promise<SkillResult<SanctionResult>> {
    if (!input.apiKey) {
      return { data: { sanctioned: false, records: [] }, source: CGU_API, confidence: 0.0 }
    }

    const clean = input.cnpj.replace(/\D/g, '')
    const headers = { Accept: 'application/json', 'chave-api-dados': input.apiKey }

    const [ceisRes, cnepRes] = await Promise.allSettled([
      fetch(`${CGU_API}/ceis?cnpjSancionado=${clean}&pagina=1`, { headers }),
      fetch(`${CGU_API}/cnep?cnpjSancionado=${clean}&pagina=1`, { headers }),
    ])

    const records: SanctionRecord[] = []

    type CGURecord = { tipoSancao: string; dataInicioSancao?: string; dataFimSancao?: string; orgaoSancionador?: string }

    async function collect(res: PromiseSettledResult<Response>, type: 'CEIS' | 'CNEP') {
      if (res.status !== 'fulfilled' || !res.value.ok) return
      const data = await res.value.json() as CGURecord[]
      for (const item of data) {
        records.push({ type, sanction: item.tipoSancao, startDate: item.dataInicioSancao, endDate: item.dataFimSancao, organ: item.orgaoSancionador })
      }
    }

    await Promise.all([collect(ceisRes, 'CEIS'), collect(cnepRes, 'CNEP')])

    const today = new Date().toISOString().split('T')[0]
    const active = records.filter(r => !r.endDate || r.endDate >= today)

    return {
      data: { sanctioned: active.length > 0, records },
      source: `${CGU_API}/ceis,${CGU_API}/cnep`,
      confidence: 0.95,
    }
  },
}
