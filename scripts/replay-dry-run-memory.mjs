// Memória em RAM para o DRY-RUN do replay-fiscal.mjs (#213).
//
// Os Fiscais gravam memória durante `analisar` (DISPENSA#, ADITIVO#, ...) via
// `context.saveMemory`, e o replay passava o saveMemory REAL também no
// dry-run: o modo que anunciava "nada foi gravado" escrevia em alerts-prod.
// Para virar smoke de CI, o dry-run não pode tocar a tabela.
//
// Não basta trocar por um no-op: o fracionamento de fiscal-licitacoes conta,
// via queryAlertsByCnpj, as dispensas gravadas pelas gazettes anteriores DO
// MESMO run (por isso o replay é sequencial). Sem devolver o que foi "gravado"
// em RAM, o dry-run subestimaria fracionamento e divergiria do --apply.

/**
 * @returns {{
 *   saveMemory: { name: string, description: string, execute(input: { pk: string, item: object }): Promise<object> },
 *   withMemory(query: (cnpj: string, sinceISO: string) => Promise<object[]>): (cnpj: string, sinceISO: string) => Promise<object[]>,
 *   size(): number,
 * }}
 */
export function createDryRunMemory() {
  const store = new Map()

  const saveMemory = {
    name: 'save_memory',
    description: 'dry-run: grava em RAM, nunca no DynamoDB',
    async execute({ pk, item }) {
      store.set(pk, { ...item, pk })
      return { data: undefined, source: `dry-run-memory#${pk}`, confidence: 1.0 }
    },
  }

  // Mesmo recorte da GSI2-cnpj-date (cnpj = :cnpj AND createdAt >= :since);
  // o item em RAM substitui o do DynamoDB de mesmo pk, como o PutItem faria.
  function withMemory(query) {
    return async (cnpj, sinceISO) => {
      const remote = await query(cnpj, sinceISO)
      const local = [...store.values()].filter(
        i => i.cnpj === cnpj && typeof i.createdAt === 'string' && i.createdAt >= sinceISO,
      )
      const localPks = new Set(local.map(i => i.pk))
      return [...remote.filter(i => !localPks.has(i.pk)), ...local]
    }
  }

  return { saveMemory, withMemory, size: () => store.size }
}
