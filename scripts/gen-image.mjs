#!/usr/bin/env node
/**
 * Gera uma imagem com Gemini (Nano Banana 2 / gemini-3.1-flash-image) e salva em output/.
 *
 * Uso:
 *   node scripts/gen-image.mjs --name <slug> --prompt "<texto>" [--model <id>] [--out <dir>]
 *
 * Resolução da chave (mesma lógica do wrapper MCP):
 *   1. env GEMINI_API_KEY (fast path / CI), senão
 *   2. AWS Secrets Manager: fiscaldigital-gemini-dev (campo api_key).
 *
 * Usado pelos skills /ig-story e /linkedin-post. O texto factual/legal NÃO deve
 * ser pedido ao modelo (risco de garble viola "sempre citar a fonte"); o prompt
 * deve descrever só o visual. Texto preciso entra como overlay determinístico.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_ID = 'fiscaldigital-gemini-dev';
const REGION = 'us-east-1';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  return a;
}

function resolveKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const out = execSync(
    `aws secretsmanager get-secret-value --secret-id ${SECRET_ID} --query SecretString --output text --region ${REGION}`,
    { encoding: 'utf8' },
  );
  const key = JSON.parse(out.trim()).api_key;
  if (!key) throw new Error('secret fiscaldigital-gemini-dev tem api_key vazio');
  return key;
}

async function main() {
  const { name, prompt, model = DEFAULT_MODEL, out = 'output' } = parseArgs(process.argv.slice(2));
  if (!name || !prompt) {
    console.error('Uso: node scripts/gen-image.mjs --name <slug> --prompt "<texto>" [--model <id>] [--out <dir>]');
    process.exit(1);
  }

  const key = resolveKey();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  );

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    console.error('Resposta sem imagem:', JSON.stringify(json).slice(0, 500));
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  const ext = part.inlineData.mimeType?.includes('png') ? 'png' : 'jpg';
  const path = join(out, `${name}.${ext}`);
  writeFileSync(path, Buffer.from(part.inlineData.data, 'base64'));
  console.error(`OK -> ${path} (${Math.round(Buffer.from(part.inlineData.data, 'base64').length / 1024)} KB, ${part.inlineData.mimeType})`);
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
