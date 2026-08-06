/**
 * Guarda de arquitetura: PROCESSAMENTO NUNCA TOCA A FONTE.
 *
 * A camada raw existe para que reprocessar seja local e barato ("adquirir 1×,
 * derivar ∞×"). O dia em que o analyzer importar o cliente do Querido Diário,
 * reprocessamento volta a depender de uma fonte externa com rate limit de
 * 60/min — que já secou para 15 das nossas 50 cidades. Este teste transforma
 * essa regra de comentário em gate: quebra o build, não uma revisão.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const PROIBIDOS = [
  'query_diario',                    // skill de busca no QD (só o collector usa)
  'api.queridodiario.ok.org.br',     // chamada direta à API
]

function arquivosTs(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, e.name)
    if (e.isDirectory() && e.name !== '__tests__') out.push(...arquivosTs(caminho))
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(caminho)
  }
  return out
}

test('analyzer não referencia o cliente nem a API do Querido Diário', () => {
  const violacoes: string[] = []
  for (const arquivo of arquivosTs(SRC)) {
    const conteudo = readFileSync(arquivo, 'utf-8')
    for (const termo of PROIBIDOS) {
      if (conteudo.includes(termo)) violacoes.push(`${arquivo}: contém "${termo}"`)
    }
  }
  expect(violacoes).toEqual([])
})
