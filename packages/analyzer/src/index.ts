import type { SQSEvent } from 'aws-lambda'

// Sprint 2: implementar Fiscais + Fiscal Geral aqui
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('[analyzer] stub — Sprint 2 implementa Fiscais', {
    records: event.Records.length,
  })
}
