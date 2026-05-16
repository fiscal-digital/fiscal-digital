# Estratégia de archive permanente para reprocessamento

**Decidido:** 2026-05-11
**Driver:** Diego — "ter todo material para 50 cidades desde 2021 para reprocessamento e revisão de novos Fiscais"

## Princípio

Toda gazette processada pelo Fiscal Digital fica persistida em **5 camadas independentes**, cada uma reaproveitável sem repetir custo de Bedrock ou request ao Querido Diário.

| Camada | O quê | Onde | Estado |
|---|---|---|---|
| **L1 — PDF original** | Bytes do diário oficial | S3 `gazettes-cache-prod` `/<territory>/<date>/<hash>.pdf` | ⚠️ Parcial (~10% — lazy cache CDN) |
| **L2 — Texto extraído** | Plain text do PDF | S3 `gazettes-cache-prod` `/txt/<territory>/<date>/<hash>.txt` | ❌ Não persistido |
| **L3 — Excerpts** | Passagens filtradas (keywords QD) | DDB `gazettes-prod.excerpts` | ❌ Ausente (EVO-001 previu, não executado para histórico) |
| **L4 — Entidades** | Output Bedrock Camada 2 (Nova Lite) | DDB `entities-prod` | ✅ 4.185 items |
| **L5 — Findings + Narrativas** | Output 10 Fiscais + Haiku | DDB `alerts-prod` | ✅ 1.695 items |

## Casos de uso da persistência

1. **Reprocessar Fiscais ajustados/novos** sem custo de Bedrock ou QD
2. **Treinar/avaliar modelos próprios** (extração custom, embeddings, fine-tune Haiku, RAG) sobre corpus real e reproduzível
3. **Auditoria pública** — terceiro pode reprocessar exatamente o que processamos (princípio de verificabilidade)
4. **Recuperação** — se Bedrock decommissionar Nova Lite, reprocessamos via outro modelo

## Bucket único, prefixos por camada

Decisão: **reusar `fiscal-digital-gazettes-cache-prod`** em vez de criar bucket separado.

Razões:
- Já tem versioning + lifecycle (noncurrent_version 90d, GLACIER_IR 181d)
- Já tem CloudFront OAC para servir PDFs via `gazettes.fiscaldigital.org`
- Layout atual `<territory>/<date>/<hash>.pdf` mantém compat com `pdfCacheUrl` do engine

Adições:
- `/txt/<territory>/<date>/<hash>.txt` — texto extraído do PDF
- `/excerpts/<territory>/<date>/<hash>.json` — excerpts QD (backup do que vai pra DDB)

## Cobertura alvo

- **50 cidades** ativas (top 50 + capitais — fonte de verdade: `packages/engine/src/cities/index.ts`)
- **Período:** 2021-01-01 → presente
- **Universo esperado:** ~60-80K gazettes (descontando feriados/finais de semana + cobertura QD)
- **Universo atual em DDB:** 46.408
- **Gap estimado:** ~15-30K (cidades indexadas pelo QD recentemente, dias pré-MVP)

## Custo

| Componente | Custo único | Custo recorrente |
|---|---|---|
| Coleta retroativa (QD gratuito) | $0 | — |
| S3 PUTs (~70K objetos) | $0,40 | — |
| S3 Standard 1º ano (~100GB) | — | ~R$ 25/ano |
| S3 GLACIER_IR após 181d | — | ~R$ 4/mês |
| DDB writes (gazettes + entities) | $2 | — |
| Lambda execution (coleta + extração) | ~$5 | — |
| Bedrock Camada 2 (extração de gap) | ~$2-5 | — |
| **Total cobertura inicial** | **~R$ 80** | ~R$ 50/ano |
| Reanalyze futuro (qualquer época) | ~R$ 22 | — |

Sem archive, cada reanalyze custaria ~R$ 270. Após archive, ~R$ 22. Break-even em ~3 reanalyses.

## Schedule de coleta

- **Antes:** `cron(0 7 ? * MON *)` — Mon-only, throttle por gap QD
- **Depois:** `cron(0 7 * * ? *)` — diário 07:00 UTC (04:00 BRT)

Justificativa do diário: mesmo cidades com indexação QD lenta podem ter publicações esporádicas. Pagamos R$ ~5/mês a mais em invocações de Lambda em troca de zero latência entre publicação e captura.

## Sequência de implantação

1. **Schedule diário** (TF — 1 linha): immediate
2. **Collector v2** salva txt + excerpts em S3 ao processar (código): próxima PR
3. **Backfill coleta retroativa CURTA** (7 dias): cobre o gap desde último coletor Mon-only
4. **PAUSA** — aguardar Ciclo 4 observação 30d encerrar (2026-06-10) antes de:
5. **Backfill coleta retroativa LONGA** (2021-presente): geraria muitos findings novos e poluiria a observação baseline em curso
6. **Backfill caches** (L1/L2/L3 missing para gazettes em DDB): pode rodar a qualquer tempo (não gera findings novos, só preenche caches)
7. **Validação**: para cada gazette em DDB, garantir L1+L2+L3+L4 existem

### Conflito com Ciclo 4

A outra sessão coordena "Ciclo 4 observação 30d" do engine v1.6.0 em prod. Backfill massivo durante essa janela criaria influxo de findings que tornaria difícil distinguir TP/FP do baseline. Por isso o backfill longo fica para **após 2026-06-10**.

## Princípio inegociável

Após este trabalho, **NUNCA mais pagar Bedrock ou QD para reprocessar gazette já processada**. Cache é fonte de verdade.
