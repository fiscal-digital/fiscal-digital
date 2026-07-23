# Backfill de `excerpts` em gazettes-prod a partir do S3 (EVO-001 / UH-22)

Ferramenta operacional: [`scripts/backfill-excerpts-from-s3.mjs`](../../scripts/backfill-excerpts-from-s3.mjs).

## Contexto

O núcleo do EVO-001 (persistir `excerpts` em `gazettes-prod` para evitar re-coletar
o Querido Diário a cada reanálise) já está em produção:

- o **collector** grava `excerpts` no item ao coletar (pós ~2026-05-09);
- `packages/analyzer/scripts/reanalyze.mjs` faz **write-through lazy** (QD → DDB)
  via `if_not_exists`, auto-amortizando (1ª passada ~$10, 2ª ~$0.05).

Resta o **resíduo**: gazettes coletadas antes de o collector gravar `excerpts` e
que nunca passaram por reanalyze. Elas ficam invisíveis ao runner local
`scripts/replay-fiscal.mjs` (que filtra `attribute_exists(excerpts)` e não tem
fallback QD). Este script copia `excerpts` do arquivo S3 L3'
(`excerpts/<key>.json`) para o DDB — **grátis, ZERO chamadas ao Querido Diário**.

## Uso

```bash
npm run build -w packages/engine   # dependência @fiscal-digital/engine

# dry-run por cidade (default) — reporta cobertura, não escreve
node scripts/backfill-excerpts-from-s3.mjs --city=4305108 --dry-run

# aplicar (idempotente via if_not_exists — nunca sobrescreve)
node scripts/backfill-excerpts-from-s3.mjs --city=4305108 --apply
```

## Fronteira conhecida (não resolve)

Gazettes **anteriores ao S3 caching** não têm nem `excerpts` no DDB nem
`excerpts/<key>.json` no S3 — são **irrecuperáveis sem QD**. O script as reporta
como "SEM arquivo S3 (só QD resolve)" e as deixa como estão; o lazy-fill do
`reanalyze.mjs` cobre quando/se necessário.

## Achado empírico (2026-07-23)

Na prática, o collector grava o arquivo S3 L3' **e** o campo `excerpts` do DDB na
mesma operação — não há janela em que o S3 tenha `excerpts` e o DDB não. Dry-run
das cidades-padrão e amostras confirmou **0 gazettes backfillável a partir do S3**:

- Caxias do Sul (4305108): 0 gazettes sem `excerpts` (100% coberto no DDB).
- Porto Alegre (4314902): 111 sem `excerpts`, **todas** sem arquivo S3 (pré-S3).

O script permanece como **auditor de cobertura** (o dry-run mede exatamente a
fronteira DDB vs. S3 vs. só-QD) e como **rede de segurança** caso a gravação S3 e
DDB do collector algum dia divirjam.
