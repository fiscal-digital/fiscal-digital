# Governança de Fiscais

> Processo obrigatório para adicionar/modificar Fiscais.
> Origem: 6.454 erros silenciosos descobertos em 2026-05-02 (3 dos 5 Fiscais quebrados em prod) — testes unitários passavam mas integração com DynamoDB falhava.

---

## Princípio

> **Unit test verde ≠ Fiscal funciona em prod.**
>
> Validação obrigatória em 4 camadas antes de promover:
> 1. Unit (mock everything)
> 2. Integration (real DynamoDB schema, mock external)
> 3. Smoke PoC (Caxias do Sul + Porto Alegre, gazettes reais)
> 4. Soak (24h sem regressão)

---

## Etapas Obrigatórias

### Etapa 1 — Unit Tests

- **O que:** Casos positivos, negativos, edge cases, valores nulos
- **Onde:** `packages/engine/src/fiscais/__tests__/<fiscal>.test.ts`
- **Mocks:** todas as skills (extractEntities, saveMemory, queryAlertsByCnpj)
- **Critério de aceite:**
  - 100% testes passando
  - Cobertura > 80% de linhas
  - **Cada `null` field testado** — particular relevância para fields indexados em GSI
- **Bloqueia merge:** sim (CI runs `npm test`)

### Etapa 2 — Integration Tests

- **O que:** Fiscal escrevendo no DynamoDB schema real (alerts-prod-test ou local DynamoDB)
- **Onde:** `packages/engine/src/fiscais/__tests__/<fiscal>.integration.test.ts`
- **Critério de aceite:**
  - PutItem com todos os campos null válidos não quebra
  - GSI keys (cnpj, secretaria) presentes ou ausentes — nunca NULL
  - Query GSI funciona após PutItem
- **Bloqueia merge:** sim
- **Lição aprendida (LRN-019):** atributos indexados em GSI **rejeitam NULL** no DynamoDB. Use omissão condicional (`...(cnpj && { cnpj })`) em vez de `cnpj ?? null`.

### Etapa 3 — Smoke PoC (Caxias + Porto Alegre)

- **O que:** rodar Fiscal contra gazettes reais das 2 cidades de prova
- **Como:**
  ```bash
  node packages/engine/scripts/smoke-fiscal.mjs --fiscal=fiscalContratos --poc
  ```
- **Critério de aceite:**
  - **0 erros** em CloudWatch durante o teste
  - Findings esperados aparecem (calibração documentada por Fiscal)
  - Latência por gazette < 5s p99
- **Cidades:** Caxias do Sul (4305108) + Porto Alegre (4314902)
- **Razão:** [CLAUDE.md "Cidades-padrão para Provas de Conceito"](../../CLAUDE.md)
- **Bloqueia deploy:** sim

### Etapa 4 — Soak Test (24h em prod)

- **O que:** monitorar erros e métricas após deploy
- **Como:** CloudWatch alarm dedicado por Fiscal (erro > 1% em 1h → alarm)
- **Critério de aceite:**
  - Erro rate < 0.5% em 24h
  - Sem ThrottlingException recorrente (Bedrock)
  - Findings gerados consistentes com calibração
- **Rollback:** automático se erro > 5% em 1h

---

## Documentação Obrigatória por Fiscal

Cada Fiscal deve ter 2 documentos versionados:

### `<fiscal>.legal.md`
- Referência legal (Lei 14.133/2021 Art. X, etc.)
- Exemplo positivo (deve disparar)
- Exemplo negativo (NÃO deve disparar)
- Edge cases conhecidos

### `<fiscal>.validation.md` (NOVO — UH-26)
- Status atual: `unit | integration | smoke | soak | promoted`
- Última execução: timestamp + commit
- Métricas observadas: erros, findings, latência
- Calibração: quantos findings esperados em Caxias + PA por mês

---

## Aplicação Retroativa (UH-25)

Os 5 Fiscais existentes precisam ser auditados pela governança:

| Fiscal | Status atual | Ação imediata |
|---|---|---|
| FiscalLicitacoes | ⚠️ 1.019 erros (null cnpj) | Bug fixed em 2026-05-02 — Etapa 3 pendente |
| FiscalContratos | 🔴 3.987 erros (null cnpj) | Bug fixed em 2026-05-02 — Etapa 3 pendente |
| FiscalFornecedores | ⚠️ 1.448 erros (Bedrock throttle) | Cache deployado — Etapa 3 com cache populado |
| FiscalPessoal | ❓ desconhecido — sem findings em prod | Etapa 1+2+3 |
| FiscalGeral | ❓ orquestrador | Etapa 2+3 |

---

## Próximos Fiscais (Backlog Sprint 7+)

- **FiscalConvenios** — convênios > R$ X sem licitação prévia
- **FiscalNepotismo** — nomeações de parentes em cargos comissionados (Lei 7.853/89, STF Súmula 13)
- **FiscalPublicidade** — gastos de publicidade em ano eleitoral (Lei 9.504/97 Art. 73)
- **FiscalLocacao** — locação de imóveis acima do valor de mercado
- **FiscalDiarias** — pagamento de diárias em finais de semana / feriados

Cada um deve passar pelas 4 etapas antes de ser promovido.

---

## TODO de Compatibilidade

### CNPJ Alfanumérico (Lei 14.973/2024 — efeito julho/2026)

A partir de julho/2026, novos CNPJs serão alfanuméricos (8 chars + 4 chars + 2 dígitos verificadores). Atual regex `\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}` perde matches.

**Ação obrigatória ANTES de julho/2026:**
1. Atualizar regex em `packages/engine/src/regex/`
2. Atualizar validação em `validate_cnpj.ts`
3. Atualizar BrasilAPI integration (verificar suporte)
4. Atualizar testes com casos alfanuméricos

**Anotado em:** `docs/fiscais/GOVERNANCA.md` + Sprint 6 backlog

---

## Owner / Aprovação

- **Owner do Fiscal:** agente Claude que adicionou/modificou (registrado em commit)
- **Aprovação para promote (Etapa 4 → prod):** Diego (review de evidências da Etapa 3)
- **Sem promoção sem evidências:** Etapa 3 sem print/log = bloqueado
