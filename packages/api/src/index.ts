import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

// Sprint 3: rotas REST (alertas por cidade/secretaria/fornecedor)
export const handler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 503,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'API not yet implemented — Sprint 3',
      project: 'fiscal-digital',
    }),
  }
}
