#!/usr/bin/env node
/**
 * Wrapper MCP do Gemini image (gemini-image).
 *
 * Resolve a GEMINI_API_KEY e lança o servidor `mcp-image`. Permite desenvolver
 * em qualquer máquina com credencial AWS, sem depender de env var local:
 *   1. Se GEMINI_API_KEY já estiver no ambiente, usa (fast path / CI).
 *   2. Senão, busca do AWS Secrets Manager (fiscaldigital-gemini-dev).
 *
 * IMPORTANTE: stdout é o canal JSON-RPC do MCP — nunca escrever nele.
 * Todo log vai para stderr.
 */
import { execSync, spawn } from 'node:child_process';

const SECRET_ID = 'fiscaldigital-gemini-dev';
const REGION = 'us-east-1';

const log = (m) => process.stderr.write(`[mcp-gemini-image] ${m}\n`);

let apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  try {
    log(`buscando chave no AWS Secrets Manager (${SECRET_ID})...`);
    // SECRET_ID/REGION são constantes — sem input do usuário, sem risco de injeção.
    const out = execSync(
      `aws secretsmanager get-secret-value --secret-id ${SECRET_ID} --query SecretString --output text --region ${REGION}`,
      { encoding: 'utf8' },
    );
    apiKey = JSON.parse(out.trim()).api_key;
    log('chave resolvida via AWS.');
  } catch (e) {
    log(`ERRO ao buscar secret: ${e.message}`);
    log('Confira credenciais AWS (aws sts get-caller-identity) e acesso ao secret.');
    process.exit(1);
  }
}

if (!apiKey) {
  log('Nenhuma GEMINI_API_KEY resolvida (nem env nem AWS).');
  process.exit(1);
}

const child = spawn('npx', ['-y', 'mcp-image'], {
  stdio: 'inherit',
  shell: process.platform === 'win32', // npx é .cmd no Windows
  env: {
    ...process.env,
    GEMINI_API_KEY: apiKey,
    IMAGE_OUTPUT_DIR: process.env.GEMINI_IMAGE_OUTPUT_DIR || 'output',
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (e) => {
  log(`falha ao iniciar mcp-image: ${e.message}`);
  process.exit(1);
});
