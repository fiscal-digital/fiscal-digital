# EVO-003 — CLI Labeler para Golden Set

CLI interativo para Diego rotular o golden set de 70 amostras (Sprint 7).

## Objetivo

Sem dataset rotulado, qualquer mudança em Fiscal é palpite. Este labeler permite rotular **<10s por amostra**, removendo friction de planilha.

## Uso

```bash
# Modo padrão: rotula amostras pendentes em fixtures/golden-set.json
pnpm label

# Importar candidatos novos de prod (gazettes-prod com findings reais)
pnpm label --import --fiscal=fiscal-pessoal --count=12

# Pular para um Fiscal específico
pnpm label --fiscal=fiscal-nepotismo

# Stats sem rotular
pnpm label --stats
```

## Distribuição alvo

| Fiscal | Amostras | Prioridade |
|---|---|---|
| FiscalPessoal | 12 | P0 (alto risco eleitoral) |
| FiscalNepotismo | 12 | P0 (alto risco reputacional) |
| FiscalLicitacoes | 8 | P1 |
| FiscalContratos | 8 | P1 |
| FiscalFornecedores | 8 | P1 |
| FiscalGeral | 6 | P1 (orquestrador) |
| FiscalDiarias | 4 | P2 |
| FiscalPublicidade | 4 | P2 |
| FiscalConvenios | 4 | P2 |
| FiscalLocacao | 4 | P2 |
| **Total** | **70** | |

## Workflow recomendado

1. **Sessão 1 (90 min):** rotular 30 amostras iniciais — ~5 por Fiscal P0+P1, 1 por P2
2. Validar baseline numérico via `pnpm eval` (script futuro)
3. **Sessão 2 (90 min):** rotular +40 para chegar em 70

## Schema da amostra

```json
{
  "id": "GS-001",
  "gazetteId": "4305108#2026-04-15#1",
  "excerptIdx": 0,
  "fiscalId": "fiscal-licitacoes",
  "expectedFinding": {
    "type": "dispensa_irregular",
    "expectedRiskRange": [60, 85],
    "expectedConfidenceRange": [0.7, 0.95]
  },
  "label": "TP",
  "labeledBy": "diego",
  "labeledAt": "2026-05-10T15:30:00.000Z",
  "schemaVersion": 1,
  "notes": "Dispensa R$ 120k > teto Lei 14.133 Art. 75 II"
}
```

`label` aceita: `TP` (true positive — devia disparar e disparou), `FP` (false positive — disparou mas não devia), `FN` (false negative — devia disparar mas não disparou), `borderline` (caso ambíguo, sinaliza incerteza).

## LRN

Plan agent OPUS (2026-05-09): "rotulagem fatiga após 90min — não tente 70 num dia. 30 primeiro, 40 depois."
