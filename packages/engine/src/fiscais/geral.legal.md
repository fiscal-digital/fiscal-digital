# Fiscal Geral — Orquestrador

## Papel no sistema

O Fiscal Geral **não detecta irregularidades diretamente** — essa é a responsabilidade
dos Fiscais especializados (Licitações, Contratos, Fornecedores, Pessoal).

Seu papel é **consolidar findings** produzidos pelos demais Fiscais e identificar
**padrões recorrentes** que nenhum Fiscal especializado vê isoladamente.

## Lógica de consolidação (MVP)

```
fiscalGeral.consolidar({ findings, cityId })
  → agrupa findings por CNPJ
  → se grupo >= 3 findings → emite meta-finding padrao_recorrente
  → riskScore = 90 + (qtd - 3) * 2   (cap: 100)
  → devolve: findings originais + meta-findings
```

## Meta-finding `padrao_recorrente`

Emitido quando 3 ou mais findings de **qualquer tipo** apontam o mesmo CNPJ,
independentemente de secretaria. Indica risco sistêmico — o fornecedor aparece
em múltiplas irregularidades.

**riskScore consolidado:**
- 3 findings → 90
- 4 findings → 92
- 5 findings → 94
- 10 findings → 100 (cap)

**confidence:** mínimo entre os findings do grupo (conservador).

**evidence:** todos os excerpts dos findings do grupo (rastreabilidade completa).

## Integração com o ciclo autônomo

```
Fiscais especializados → findings[]
    ↓
fiscalGeral.consolidar()
    ↓
findings + meta-findings
    ↓
riskScore >= 60 + confidence >= 0.70 → SQS → publisher
```

## TODOs

- Detectar padrão por secretaria (mesmo CNPJ, múltiplas secretarias → risco maior).
- Cruzar com dados do TSE (doações de campanha) quando Fase 2 estiver disponível.
- Persistir meta-findings no DynamoDB com `actType: 'padrao_recorrente'` para
  evitar re-publicação do mesmo padrão em ciclos consecutivos.
