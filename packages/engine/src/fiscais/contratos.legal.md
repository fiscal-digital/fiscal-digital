# Fiscal de Contratos — Documentação Legal

## 1. Base legal

### Aditivo abusivo — Lei 14.133/2021, Art. 125, §1º

O Art. 125 da Lei 14.133/2021 (Nova Lei de Licitações) regula as alterações unilaterais e
consensuais dos contratos administrativos. O §1º fixa os limites percentuais para acréscimos:

- **Inciso I (regra geral):** obras, serviços e compras em geral — limite de **25%** do valor
  original do contrato.
- **Inciso II (reforma de edifícios e equipamentos):** acréscimos em contratos exclusivos de
  reforma de edifício ou de equipamento — limite de **50%** do valor original do contrato.

Referência: Lei 14.133, de 1º de abril de 2021, Art. 125, §1º, I e II.

### Prorrogação excessiva — Lei 14.133/2021, Art. 107, caput

O Art. 107 regula a duração dos contratos de serviços contínuos. O caput autoriza a
manutenção de contratos de natureza contínua por até **10 anos**, podendo ser prorrogado por
novo período, observadas as condições do mercado. Contratos que ultrapassam o limite decenal
total de vigência exigem revisão.

Referência: Lei 14.133, de 1º de abril de 2021, Art. 107, caput.

---

## 2. Padrões detectados

### Aditivo abusivo (`aditivo_abusivo`)

Detectado quando um Termo Aditivo publicado no diário oficial apresenta valor percentual
acima do limite legal em relação ao valor original do contrato:

- **Regra geral (Art. 125 §1º I):** aditivo > 25% do valor original.
- **Reforma de edifício/equipamento (Art. 125 §1º II):** aditivo > 50% do valor original.

O Fiscal classifica a natureza do objeto (reforma ou geral) combinando o `subtype` extraído
pelo Haiku com a presença de termos como "reforma", "edifício" ou "equipamento" no excerpt.

O valor original do contrato é obtido por **Opção C (combo)**:
1. Lookup histórico no DynamoDB `alerts-prod` (preferred): busca registro com
   `actType='contrato'` e mesmo `contractNumber` para o CNPJ.
2. Fallback LLM: campo `valorOriginalContrato` extraído pelo Haiku quando o excerpt
   cita explicitamente o valor original (ex.: "valor original de R$ X").
3. Skip silencioso: se nenhuma das fontes disponível, o aditivo não gera finding — evita
   falsos positivos por falta de dados.

Todo aditivo processado (abusivo ou dentro do limite) é persistido com `actType='aditivo'`
no DynamoDB para histórico futuro.

### Prorrogação excessiva (`prorrogacao_excessiva`)

Detectada quando:
- O excerpt contém referência a prorrogação contratual.
- O histórico em `alerts-prod` indica que a vigência inicial do contrato foi há mais de
  10 anos (contagem a partir da data da evidência mais antiga com `actType` em
  `['contrato', 'prorrogacao']`).

---

## 3. Exemplo que DISPARA

### Aditivo abusivo (regra geral)

```
TERMO ADITIVO n° 003/2026 ao Contrato n° 042/2024.
Objeto: acréscimo de serviços de tecnologia da informação.
Valor do aditivo: R$ 30.000,00.
Contratada: Tech Solutions LTDA, CNPJ: 12.345.678/0001-90.
Secretaria Municipal de Administração.
```

**Contexto:** contrato original R$ 100.000,00 (registro em `alerts-prod`).
**Razão:** R$ 30.000 / R$ 100.000 = 30% > 25% (limite Art. 125 §1º I).
**Finding gerado:** `aditivo_abusivo`, legalBasis: `Lei 14.133/2021, Art. 125, §1º, I`.

### Prorrogação excessiva

```
PRORROGAÇÃO CONTRATUAL ao Contrato n° 005/2014.
Objeto: prorrogação de contrato de vigilância patrimonial.
Novo prazo: até 31/12/2026.
CNPJ: 99.000.111/0001-33.
```

**Contexto:** contrato firmado em 2014-01-01 (histórico em `alerts-prod`).
**Razão:** 2026 - 2014 = ~12 anos > 10 anos (limite Art. 107).
**Finding gerado:** `prorrogacao_excessiva`, legalBasis: `Lei 14.133/2021, Art. 107, caput`.

---

## 4. Exemplo que NÃO DISPARA

### Aditivo dentro do limite geral

```
TERMO ADITIVO n° 002/2026 ao Contrato n° 043/2024.
Objeto: acréscimo de serviços de limpeza e conservação.
Valor do aditivo: R$ 20.000,00.
Contratada: Limpeza Caxias LTDA, CNPJ: 22.333.444/0001-55.
Secretaria Municipal de Saúde.
```

**Contexto:** contrato original R$ 100.000,00.
**Razão:** R$ 20.000 / R$ 100.000 = 20% ≤ 25% (limite Art. 125 §1º I).
**Resultado:** nenhum finding.

### Aditivo de reforma dentro do limite especial

```
TERMO ADITIVO ao Contrato n° 046/2024.
Objeto: acréscimo de serviços de reforma do edifício da sede.
Valor do aditivo: R$ 40.000,00.
Contratada: Construtora Caxias LTDA.
```

**Contexto:** contrato original R$ 100.000,00, `subtype='obra_engenharia'`, excerpt contém "reforma do edifício".
**Razão:** R$ 40.000 / R$ 100.000 = 40% ≤ 50% (limite Art. 125 §1º II — reforma).
**Resultado:** nenhum finding.

### Prorrogação dentro do prazo

```
PRORROGAÇÃO CONTRATUAL ao Contrato n° 010/2020.
Objeto: prorrogação de contrato de limpeza e conservação.
Novo prazo: até 31/12/2026.
```

**Contexto:** contrato firmado em 2020-01-01.
**Razão:** 2026 - 2020 = ~6 anos ≤ 10 anos (limite Art. 107).
**Resultado:** nenhum finding.

---

## Filtros de exclusão pré-LLM (ADR-001 — patch 2026-05-10)

Após o patch P1 Contratos (precisão Ciclo 1 33,3% → Ciclo 2 11,3% sobre n=180,
89% de FP por falta de cross-reference), 4 filtros defensivos são aplicados:

### Floor de valor mínimo

Aditivos < **R$ 5.000,00** são pulados (ajustes operacionais, correção de NF,
rounding contábil). GS-085 (R$ 2.200), GS-088 (R$ 234,96).

### Percentual declarado é fonte primária

Quando o PDF cita `acréscimo de XX,YY%` explicitamente E o percentual está
abaixo do limite legal (25% geral / 50% reforma), o finding é suprimido —
texto explícito > inferência de cross-reference. GS-084 (`20,22%` declarado).

### Instrumentos fora do escopo Art. 125

| Padrão | Razão | GS |
|---|---|---|
| Termo de Compromisso/Cooperação/Fomento/Colaboração/Cessão de Uso | Não são contrato administrativo Lei 14.133 | GS-082, 089 |
| Convênio, SÚMULA DE CONVÊNIOS E CONTRATOS | Cross-block matching | C2 |
| Termo de Adesão, Edital de Capitação de Projetos | Fora de Lei 14.133 | C2 |

### Reajuste legal (Art. 124, não Art. 125 §1º)

| Padrão | Razão |
|---|---|
| `revisão anual`, `reajuste por índice`, `reajuste anual pelo IPCA`, `reajuste com base no IST`, `reajuste monetário` | Art. 124 — não é acréscimo abusivo |
| `repactuação CCT/coletiva/por convenção` | Repactuação de mão de obra (Lei 14.133 Art. 135) |
| `apostilamento` | Registro contábil, não aditivo material |
| `supressão`, `retenção de valor`, `valor suprimido`, `impactação financeira negativa` | Decréscimo, não acréscimo |

### Cross-reference suppliers-prod (implementado 2026-05-11)

Cross-reference com a tabela `suppliers-prod` via skill nova
`querySuppliersContract` (`packages/engine/src/skills/query_suppliers_contract.ts`).
Source canônica do valor original do contrato (resolve 89% dos FPs identificados
no Ciclo 2/3).

**Ordem de lookup do valor original:**
1. **`context.querySuppliersContract`** → consulta `suppliers-prod` por
   (cnpj, cityId, contractNumber). Schema: `pk = SUPPLIER#{cnpj}`,
   `sk = {contractedAt}#{contractId}`. Source primária para contratos
   cadastrados pelo MIT-02/EVO-002.
2. **`context.queryAlertsByCnpj`** → consulta `alerts-prod` por CNPJ.
   Fallback para contratos já registrados pelo engine (registros do MVP
   antes do MIT-02 popular `suppliers-prod` completamente).
3. **`entities.valorOriginalContrato`** → fallback LLM (Haiku extraiu valor
   original do excerpt).
4. **Skip silencioso** se nenhuma fonte estiver disponível — não emite
   finding. Persiste aditivo no histórico de qualquer forma para análises
   futuras.

A skill `querySuppliersContract` é injetada via `FiscalContext` (campo
opcional) — testes rodam com mock; prod injeta a implementação real via
boot do Lambda analyzer.

---

## 5. Limitações conhecidas

### Cobertura de prorrogação nos primeiros meses de operação

A detecção de `prorrogacao_excessiva` depende da existência de histórico em `alerts-prod`
com o contrato original (`actType='contrato'`) ou prorrogação anterior (`actType='prorrogacao'`).
Nos primeiros meses após o deploy, o histórico estará incompleto:
- Contratos anteriores ao início do backfill não terão entrada em `alerts-prod`.
- Prorrogações sem histórico resultam em **skip silencioso** (sem false positive).
- Cobertura cresce progressivamente conforme o backfill avança (01/01/2021 → hoje).

**Estimativa:** cobertura plena esperada após conclusão do backfill de Caxias do Sul.

### Reajuste (correção monetária) não é aditivo de valor

Aditivos de reajuste monetário (IPCA-E, INPC, etc.) não aumentam o escopo do contrato
e **não devem disparar** este fiscal. O Haiku é instruído a classificar esses casos como
`actType='aditivo'` com valor do reajuste, mas o fiscal não possui atualmente lógica para
distinguir aditivos de reajuste de aditivos de acréscimo de escopo.

**Mitigação atual:** na prática, aditivos de reajuste citam explicitamente "reajuste",
"IPCA-E", "índice de correção", reduzindo a chance de o valor do aditivo ser interpretado
como acréscimo de escopo. Refinamento futuro via campo `actSubtype` no Haiku.

**TODO próximo sprint:** adicionar campo `actSubtype: reajuste | acrescimo | supressao | null`
na extração e filtrar reajustes antes da comparação percentual.

### Outros incisos do Art. 125 não cobertos no MVP

O Art. 125 abrange outras hipóteses de alteração contratual (unilateral qualitativa, supressão,
etc.) que **não são detectadas** neste MVP. Cobertos: acréscimo de valor (§1º I e II).

**TODO próximo sprint:** cobertura de supressão abusiva (§1º, limite 25%/50%) e
alteração unilateral qualitativa sem justificativa.

---

## 6. Como reportar falso positivo

Se identificar um alerta incorreto gerado por este Fiscal:

1. Abra uma issue no repositório `fiscal-digital` com o label `falso-positivo`.
2. Inclua: (a) URL do diário oficial, (b) número do contrato, (c) razão pela qual o alerta
   é incorreto com referência legal.
3. A correção será publicada nas mesmas redes com o mesmo alcance do alerta original
   (política de retratação — ver `CLAUDE.md`, seção "Governança Open Source").
