import type { SQSEvent } from 'aws-lambda'

// Sprint 3: integrar X (twitter-api-v2) + Reddit (snoowrap)
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('[publisher] stub — Sprint 3 integra X e Reddit', {
    records: event.Records.length,
  })
}
