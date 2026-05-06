/**
 * Populações estimadas das cidades cobertas pelo Fiscal Digital.
 *
 * Fonte: IBGE Censo 2022 + estimativas oficiais. Usado para normalizar
 * thresholds de detecção (ex: Fiscal de Pessoal usa porte da cidade para
 * calibrar quantos atos por gazette indicam anomalia).
 *
 * Indexado por `cityId` IBGE (7 dígitos) — mesma chave de `CITIES`.
 *
 * Cidades sem entrada caem em `DEFAULT_POPULATION` (100k) — bucket
 * "medium" do `cityBucket`. Estratégia conservadora: assume porte médio
 * em vez de inferir errado. Atualizar quando ampliar cobertura.
 */

export const POPULATIONS: Record<string, number> = {
  // Capitais — todas as 27 (algumas via aproximação Censo 2022)
  '3550308': 11_451_245, // São Paulo / SP
  '3304557':  6_211_423, // Rio de Janeiro / RJ
  '5300108':  2_817_381, // Brasília / DF
  '2304400':  2_428_708, // Fortaleza / CE
  '2927408':  2_418_005, // Salvador / BA
  '3106200':  2_315_560, // Belo Horizonte / MG
  '1302603':  2_063_547, // Manaus / AM
  '4106902':  1_773_733, // Curitiba / PR
  '2611606':  1_488_920, // Recife / PE
  '5208707':  1_437_366, // Goiânia / GO
  '4314902':  1_332_570, // Porto Alegre / RS
  '1501402':  1_303_403, // Belém / PA
  '2111300':  1_037_589, // São Luís / MA
  '2704302':    957_916, // Maceió / AL
  '5002704':    897_938, // Campo Grande / MS
  '2507507':    833_932, // João Pessoa / PB
  '2211001':    814_230, // Teresina / PI
  '2408102':    751_300, // Natal / RN
  '2800308':    657_013, // Aracaju / SE
  '5103403':    650_877, // Cuiabá / MT
  '4205407':    421_240, // Florianópolis / SC
  '1100205':    460_434, // Porto Velho / RO
  '1600303':    442_933, // Macapá / AP (não está na lista atual; mantém por defesa)
  '1200401':    367_102, // Rio Branco / AC (idem)
  '1400100':    284_313, // Boa Vista / RR (idem)
  '1721000':    221_742, // Palmas / TO (idem)

  // Top 50 não-capitais (parcial — alta confiança)
  '3518800':  1_291_784, // Guarulhos / SP
  '3509502':  1_139_047, // Campinas / SP
  '3304904':    896_744, // São Gonçalo / RJ
  '3548708':    810_729, // São Bernardo do Campo / SP
  '3301702':    808_486, // Duque de Caxias / RJ
  '3303500':    757_811, // Nova Iguaçu / RJ
  '3549904':    729_737, // São José dos Campos / SP
  '3534401':    729_628, // Osasco / SP
  '3547809':    718_894, // Santo André / SP
  '3552205':    691_954, // Sorocaba / SP
  '3170206':    706_597, // Uberlândia / MG
  '2607901':    706_867, // Jaboatão dos Guararapes / PE
  '3543402':    698_642, // Ribeirão Preto / SP
  '3118601':    668_949, // Contagem / MG
  '2910800':    619_609, // Feira de Santana / BA
  '4209102':    597_658, // Joinville / SC
  '4113700':    575_377, // Londrina / PR
  '5201405':    528_550, // Aparecida de Goiânia / GO
  '3303302':    481_749, // Niterói / RJ
  '1500800':    471_980, // Ananindeua / PA
  '3300456':    469_261, // Belford Roxo / RJ
  '4305108':    463_846, // Caxias do Sul / RS
  '3301009':    462_106, // Campos dos Goytacazes / RJ
  '4314100':    347_124, // Pelotas / RS (caso esteja na lista)
  '3205002':    422_127, // Vitória / ES (capital — duplicado por defesa)
  '3205200':    414_420, // Vila Velha / ES
  '3530607':    444_136, // Mogi das Cruzes / SP
  '3136702':    577_488, // Juiz de Fora / MG
  '3549805':    443_555, // São José do Rio Preto / SP
  '2607900':    490_127, // (placeholder — defensivo)
}

/** Fallback conservador para cidades sem entrada conhecida. */
export const DEFAULT_POPULATION = 100_000

/**
 * Retorna a população estimada de uma cidade. Para cidades sem entrada
 * em `POPULATIONS`, retorna `DEFAULT_POPULATION` — bucket "medium".
 */
export function populationOf(cityId: string): number {
  return POPULATIONS[cityId] ?? DEFAULT_POPULATION
}

export type CityBucket = 'large' | 'medium' | 'small'

/**
 * Classifica a cidade em 3 buckets para thresholds dinâmicos:
 *  - large:  > 1M habitantes (capitais e grandes metrópoles)
 *  - medium: 100k–1M (cidades médias, padrão administrativo moderado)
 *  - small:  < 100k (admin enxuto, picos são proporcionalmente raros)
 */
export function cityBucket(cityId: string): CityBucket {
  const pop = populationOf(cityId)
  if (pop > 1_000_000) return 'large'
  if (pop >= 100_000) return 'medium'
  return 'small'
}
