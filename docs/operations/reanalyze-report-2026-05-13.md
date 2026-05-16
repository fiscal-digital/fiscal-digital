# Reanalyze v1.7.0 — relatório (2026-05-13 → 2026-05-14)

**Início:** 2026-05-13T01:20:26Z (PID 8908, PowerShell Start-Process)
**Fim:** 2026-05-14T05:51Z (~14h)
**Status:** ✅ CONCLUÍDO sem erros, 0 reinícios consumidos

## Objetivo

Re-rodar os 9 Fiscais sobre todo o histórico de gazettes em DDB
(`fiscal-digital-gazettes-prod`) após o Ciclo 4 ter aplicado 7 patches
P0/P1/P2 para reduzir falsos positivos.

Patches aplicados antes do reanalyze:
- **P0 fiscal-diarias** — trigger restrito + 19 stopwords
- **P0 fiscal-pessoal** — trigger restrito (não disparar em atos meramente administrativos)
- **P1 fiscal-contratos** — 4 filtros defensivos
- **P2 fiscal-licitacoes** — 3 filtros vazamento + 5 hipóteses sem teto

## Execução

```
Candidatos: 46.660 gazettes
Enfileirados: 38.772 (7.888 sem excerpts QD — gazettes vazias)
EVO-001 cache hits: 3.523 (excerpts já em DDB pré-reanalyze)
EVO-001 cache misses: 43.137 (precisaram QD)
EVO-001 write-throughs: 35.249 (DDB ganhou excerpts cacheados)
Cache hit ratio inicial: 7,6%
Cache hit ratio futuro: ~92% (próxima rodada é ~30min, não 14h)
```

Bottleneck: QD rate-limit IP-based (60 req/min). Paralelização não-trivial
sem infra adicional (Lambda em VPC com NAT próprio).

## Resultado vs baseline

| Métrica | Antes (v1.6.0) | Depois (v1.7.0) | Δ |
|---|---|---|---|
| Total findings em DDB | 1.696 | **892** | **-47%** |
| Findings publicáveis (risk≥60, conf≥0.70) | 617 | **179** | **-71%** |
| Cidades com alertas | 41 | 26 | -37% |
| Total valor em contratos | — | R$ 499M | — |

**Interpretação:** Redução agressiva é o objetivo do Ciclo 4 — patches removeram
falsos positivos. Site agora mostra menos alertas mas com qualidade superior.

## Por Fiscal (total / publicáveis)

| Fiscal | Antes total | Depois total | Δ total | Depois pub | Patch |
|---|---:|---:|---:|---:|---|
| fiscal-pessoal | 708 | 117 | **-83%** | 8 | P0 |
| fiscal-locacao | 476 | 442 | -7% | 2 | — |
| fiscal-contratos | 204 | 101 | -50% | 101 | P1 |
| fiscal-licitacoes | 171 | 148 | -13% | 49 | P2 |
| fiscal-convenios | 75 | 66 | -12% | 3 | — |
| fiscal-diarias | 37 | 3 | **-92%** | 2 | P0 |
| fiscal-publicidade | 23 | 13 | -43% | 13 | — |
| fiscal-nepotismo | 0 | 0 | — | 0 | — |
| fiscal-fornecedores | 0 | 0 | — | 0 | — |
| fiscal-geral | 1 (preservado) | 1 (novo) | — | 1 | — |

**Highlights:**
- `fiscal-pessoal` -83% — patch P0 funcionou como esperado, eliminou pico_nomeacoes
  em atos administrativos rotineiros
- `fiscal-diarias` -92% — patch P0 trigger restrito + 19 stopwords removeu quase tudo
- `fiscal-contratos` 100% das narrativas passaram threshold de publicação

## Cleanup

1.694 findings órfãos (`createdAt < START` AND `fiscalId IN [9 Fiscais reanalisados]`)
deletados via BatchWriteItem (25/batch). 1 finding antigo do `fiscal-geral` preservado
(cross-gazette, não é parte do reanalyze).

```
Total a deletar: 1694
Total deletados: 1694
Unprocessed: 0
```

## Validação prod

- `/stats` retorna 180 findings publicáveis ✅
- `/alerts?limit=3` lista findings novos com narrativas v1.7.0 ✅
- 26 cidades cobertas
- R$ 499M em valor de contratos analisados

## Próximos passos sugeridos

1. **Observação 30d (Ciclo 4)** — janela até 2026-06-10 — meta ≥5 TP + ≤1 FP por Fiscal
2. **Mostrar reanalyze ao usuário** — site/evolucao já comunica patches; opcional adicionar nota sobre reanalyze
3. **Próxima rodada** — após patches futuros, custa ~30min (cache hit ~92%, não mais 7,6%)

## Arquivos auxiliares (gitignored — não commitar)

- `reanalyze-stdout.log` — log completo do reanalyze
- `reanalyze-start.txt` — timestamp de início
- `all-findings.json` — snapshot DDB pós-reanalyze
- `reanalyze-new-findings.json` — só os novos
- `orfaos-pks.txt` — PKs deletados
- `delete-orfaos.mjs` — script de cleanup
