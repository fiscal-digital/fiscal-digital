# ADR-2026-07-23-EVO-002 — Close-out do schema `suppliers-prod` com `range_key` (MIT-02)

**Status:** Accepted (close-out / verificação)
**Data:** 2026-07-23
**Autor:** Diego Moreira Vieira
**Card:** EVO-002 (MIT-02) · Notion `3a231d9588a6818f8413ebd103380fcc`

---

## Contexto

O card EVO-002 pedia o schema da tabela `fiscal-digital-suppliers-prod` com `range_key`
(chave secundária) para suportar cross-reference de contratos por fornecedor — gap central do
FiscalContratos apontado pela ADR-001 (89% de falso-positivo por falta do valor original do
contrato).

A investigação de close-out constatou que **o schema já está implementado e aplicado em PROD**:
a tabela tem `hash_key = "pk"` + `range_key = "sk"` e os dois GSIs (`GSI1-city-date` e
`GSI2_ConcentracaoSecretaria`) definidos em `terraform/modules/dynamodb/main.tf`. O GSI2 entrou
no PR #89. A "decisão pendente do Diego sobre a chave secundária" já foi tomada e implementada
(`sk = {contractedAt}#{contractId}`).

Portanto **não há migração de schema a fazer**. O residual é de verificação (provar zero drift
em PROD) e de formalização (mapear cada chave/índice ao consumidor no engine e desbloquear os
cards dependentes). Este ADR registra o desfecho **A (close-out)** do slice. O desfecho B
(habilitar o write-path que popula a tabela) é uma story separada e **não** faz parte deste PR.

---

## Schema (fonte da verdade: `terraform/modules/dynamodb/main.tf:103-173`)

Tabela `fiscal-digital-suppliers-prod` — `PAY_PER_REQUEST`, SSE com CMK, PITR habilitado,
`deletion_protection_enabled = true`.

| Chave | Atributo | Formato | Semântica |
|---|---|---|---|
| `hash_key` (pk) | `pk` (S) | `SUPPLIER#{cnpj}` | Partição por fornecedor. CNPJ normalizado (sem `.`/`-`/`/`, uppercase — Lei 14.973/2024 admite CNPJ alfanumérico). |
| `range_key` (sk) | `sk` (S) | `{contractedAt YYYY-MM-DD}#{contractId}` | Ordenação cronológica + dedupe por `contractId`. |

### Índices

| Índice | hash_key | range_key | Projeção | Uso |
|---|---|---|---|---|
| `GSI1-city-date` | `cityId` (S) | `contractedAt` (S) | ALL | Cross-supplier por cidade — "contratos em Caxias por data". |
| `GSI2_ConcentracaoSecretaria` | `secretariaId` (S) | `mesCNPJ` (S, `YYYY-MM#CNPJ14`) | ALL | FiscalFornecedores v2 — concentração por secretaria nos últimos 12 meses. |

Atributos declarados: `pk`, `sk`, `cityId`, `contractedAt`, `secretariaId`, `mesCNPJ`
(coerentes com as chaves da tabela e dos dois GSIs).

---

## Mapa de acesso — chave/índice → consumidor no engine

| Chave / índice | Consumidor | Como consome |
|---|---|---|
| pk `SUPPLIER#{cnpj}` + sk | `packages/engine/src/skills/query_suppliers_contract.ts` | `QueryCommand` com `KeyConditionExpression: 'pk = :pk'`, `ScanIndexForward: false` (mais recente primeiro); filtra `contractNumber`+`cityId` no client (cardinalidade baixa por CNPJ). Ativa (v1.7.0 / PR #24). |
| pk `SUPPLIER#{cnpj}` (via skill acima) | `packages/engine/src/fiscais/contratos.ts` | Cross-reference do valor original para calcular % de aditivo (follow-up da ADR-001 — EVO-002). Etapa 3.a "Descoberta valor original". |
| `GSI2_ConcentracaoSecretaria` (`secretariaId` / `mesCNPJ`) | `packages/engine/src/fiscais/fornecedores-v2.ts` | `queryConcentracaoGSI2()` — `IndexName = GSI2_ConcentracaoSecretaria`, `KeyCondition: secretariaId = :sid AND mesCNPJ BETWEEN :inicio AND :fim`. **Gated** pela flag `enable-fiscal-fornecedores-v2` (OFF por default). |
| `GSI1-city-date` (`cityId` / `contractedAt`) | — (sem consumidor dedicado ainda) | IAM já concede acesso (`/index/*`). Reservado para queries cross-supplier por cidade; a skill `query_suppliers_contract` prefere a pk (mais barato que varrer a cidade). |

IAM (`terraform/modules/iam/main.tf`): Query na tabela (`suppliers_table_arn`, linhas 589/720),
`/index/*` (linha 721, GSI1) e Sid `QueryGSI2Concentracao` apontando o ARN do
`GSI2_ConcentracaoSecretaria` (linhas 631-635). Cobertura completa dos índices consumidos.

---

## Feature flags (SSM Parameter Store)

Ambas com `lifecycle { ignore_changes = [value] }` — o Terraform provisiona o parâmetro mas não
gerencia o valor (flip manual via `aws ssm put-parameter --overwrite`, fail-safe para `false`).

| Parâmetro SSM | Default | Definição | Estado / gate |
|---|---|---|---|
| `/fiscal-digital/prod/enable-supplier-write` | `false` | `terraform/main.tf:124-132` | Deploy "dark". **Nenhum código do engine a consome ainda** — citada como exemplo em `feature-flags.ts:13`. Habilita o write-path (desfecho B, story própria). |
| `/fiscal-digital/prod/enable-fiscal-fornecedores-v2` | `false` | `terraform/main.tf:149-158` | Ativar APENAS após Ciclo 4 concluído + canary Caxias/POA + aprovação do Diego. Consumida por `fornecedores-v2.ts`. |

---

## Verificação de drift — `terraform plan` (PROD)

Plan **read-only** (sem `apply`), com lock desabilitado, targetado só nos recursos em escopo:

```
terraform init -input=false
terraform plan -input=false -lock=false -var github_org=fiscal-digital \
  -target=module.dynamodb.aws_dynamodb_table.suppliers \
  -target=aws_ssm_parameter.enable_supplier_write \
  -target=aws_ssm_parameter.enable_fiscal_fornecedores_v2
```

Backend: S3 `fiscal-digital-terraform-state` (`prod/terraform.tfstate`, `us-east-1`).

Resultado (2026-07-23):

```
aws_ssm_parameter.enable_supplier_write: Refreshing state... [id=/fiscal-digital/prod/enable-supplier-write]
aws_ssm_parameter.enable_fiscal_fornecedores_v2: Refreshing state... [id=/fiscal-digital/prod/enable-fiscal-fornecedores-v2]
module.dynamodb.aws_dynamodb_table.suppliers: Refreshing state... [id=fiscal-digital-suppliers-prod]

No changes. Your infrastructure matches the configuration.
```

**Zero diff** na tabela `suppliers`, nos dois GSIs (parte do recurso da tabela) e nos dois
`aws_ssm_parameter`. Nenhum replace/destroy proposto. A configuração em `main.tf` bate com o
estado real de PROD.

> Nota de reprodutibilidade: `github_org` é a única variável sem default; passar
> `-var github_org=fiscal-digital` (org real) apenas satisfaz o grafo de variáveis e não afeta os
> recursos targetados. Este passo pode ser re-executado no CI ou pelo Diego a qualquer momento.

---

## Decisão

1. EVO-002 (schema `suppliers-prod` com `range_key`) está **entregue** — schema aplicado em PROD,
   consumido pelo engine, zero drift verificado.
2. Desbloquear **EVO-021** e **EVO-022** (dependiam da estabilização do schema).
3. O write-path (`enable-supplier-write` → popular a tabela) fica como **desfecho B / story
   separada** — depende de decisão explícita do Diego e não é coberto por este ADR.

---

## Consequências

**Positivas:**

- MIT-02 formalmente fechado com evidência de zero drift em PROD.
- Mapa chave→consumidor documentado — reduz risco de regressão em mudanças futuras no schema.
- EVO-021/022 desbloqueados.

**Negativas / pendências:**

- `GSI1-city-date` provisionado mas sem consumidor dedicado no engine (só a pk é usada hoje).
  Não é bug; o índice cobre um padrão de query cross-supplier ainda não exercido.
- `enable-supplier-write` provisionada mas inerte (nenhum writer). Fica explícita como gate do
  desfecho B.

---

## Achados laterais (registrados, não editados neste PR)

- **Deprecação do provider AWS v6:** `terraform plan` emite `hash_key is deprecated. Use
  key_schema instead.` para as tabelas DynamoDB (12 avisos no total, não só `suppliers`). É débito
  de manutenção do provider — não é drift e não altera comportamento. Migrar `hash_key`/`range_key`
  → `key_schema` é uma story de manutenção à parte, fora do escopo deste close-out.
