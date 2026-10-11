/**
 * loadCguApiKey — leitura da chave da CGU no analyzer (fiscal-digital#239).
 * Mesmo contrato do supplier-collector: string crua ou JSON { api_key }.
 */

const mockSmSend = jest.fn()
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: mockSmSend })),
  GetSecretValueCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

import { loadCguApiKey, _resetCguCacheForTests } from '../cgu-sanctions'

const ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:fiscaldigital-cgu-prod-abc'

beforeEach(() => {
  _resetCguCacheForTests()
  mockSmSend.mockReset()
  process.env.CGU_SECRET_ARN = ARN
})
afterAll(() => {
  delete process.env.CGU_SECRET_ARN
})

test('sem CGU_SECRET_ARN devolve null sem chamar o Secrets Manager', async () => {
  delete process.env.CGU_SECRET_ARN
  await expect(loadCguApiKey()).resolves.toBeNull()
  expect(mockSmSend).not.toHaveBeenCalled()
})

test('SecretString cru é a própria chave', async () => {
  mockSmSend.mockResolvedValue({ SecretString: 'chave-crua' })
  await expect(loadCguApiKey()).resolves.toBe('chave-crua')
})

test('SecretString JSON { api_key }', async () => {
  mockSmSend.mockResolvedValue({ SecretString: '{"api_key":"chave-json"}' })
  await expect(loadCguApiKey()).resolves.toBe('chave-json')
})

test('JSON sem api_key ou secret vazio degradam para null', async () => {
  mockSmSend.mockResolvedValue({ SecretString: '{"outra":"x"}' })
  await expect(loadCguApiKey()).resolves.toBeNull()

  _resetCguCacheForTests()
  mockSmSend.mockResolvedValue({ SecretString: '' })
  await expect(loadCguApiKey()).resolves.toBeNull()
})

test('erro do SDK degrada para null em vez de derrubar o analyzer', async () => {
  mockSmSend.mockRejectedValue(new Error('AccessDeniedException'))
  await expect(loadCguApiKey()).resolves.toBeNull()
})

test('carrega uma vez por container', async () => {
  mockSmSend.mockResolvedValue({ SecretString: 'chave' })
  await loadCguApiKey()
  await loadCguApiKey()
  expect(mockSmSend).toHaveBeenCalledTimes(1)
})
