# Fiscal de Fornecedores — Base Legal e Exemplos

## Detecções implementadas

### 1. CNPJ Jovem (`cnpj_jovem`)

**Base legal:** Lei 14.133/2021, Art. 67 — exige que o contratado comprove
qualificação técnica e econômico-financeira compatível com o objeto. Empresa
constituída há menos de 6 meses dificilmente acumula capacidade operacional
e financeira suficiente para contratos públicos.

**Limiar:** `dataAbertura` → `gazette.date` < 6 meses inteiros.

**Exemplo positivo (dispara):**
```
CONTRATO n° 012/2026. Objeto: prestação de serviços de consultoria em TI.
Valor: R$ 48.000,00. Contratada: Nova Tech Soluções LTDA, CNPJ: 55.111.222/0001-33.
Secretaria Municipal de Administração. Vigência: 12 meses.
```
→ CNPJ aberto em 2025-12-01, contrato em 2026-03-15 = 3 meses → `cnpj_jovem`.

**Exemplo negativo (não dispara):**
```
CONTRATO n° 013/2026. Objeto: fornecimento de material de escritório.
Valor: R$ 30.000,00. Contratada: Papelaria RS LTDA, CNPJ: 66.222.333/0001-44.
Secretaria Municipal de Educação.
```
→ CNPJ aberto em 2021-01-10 = 62 meses → abaixo do limiar → sem finding.

---

### 2. Concentração de Fornecedor (`concentracao_fornecedor`)

**Base legal:** Lei 14.133/2021, Art. 11, §2º — exige competição e isonomia
no processo de contratação. Concentração excessiva em um único fornecedor
por secretaria pode indicar direcionamento ou captura de recursos.

**Limiar configurado:** `CONCENTRACAO_LIMITE = 40%` de contratos de uma
secretaria com o mesmo CNPJ em janela de 12 meses.

**Exemplo positivo (dispara — heurística MVP):**
```
CONTRATOS nos 016, 017, 018, 019/2026 — Secretaria Municipal de Saúde.
Contratada: MegaSaúde Serviços LTDA, CNPJ: 44.555.666/0001-77 (x4 contratos).
```
→ 4 ocorrências do mesmo CNPJ no excerpt → `concentracao_fornecedor`.

**Exemplo negativo (não dispara):**
```
CONTRATOS nos 020, 021/2026 — Secretaria Municipal de Educação.
Contrato 020: CNPJ: 11.111.111/0001-11. Contrato 021: CNPJ: 22.222.222/0001-22.
```
→ CNPJs distintos → não atinge limiar → sem finding.

---

## Limitações do MVP

### Concentração sem lookup histórico (TODO)

A detecção de concentração atual usa **heurística leve por excerpt**: conta
quantas vezes o mesmo CNPJ aparece dentro do mesmo trecho extraído da gazette.

**Limitação:** só detecta concentração quando vários contratos com o mesmo
fornecedor são publicados na mesma gazette e extraídos para o mesmo excerpt.
Não cobre a série temporal de 12 meses descrita no CLAUDE.md.

**Solução futura (MIT-02):** quando o GSI `SECRETARIA#CNPJ` estiver
disponível no DynamoDB (`fiscal-digital-suppliers-prod`), substituir por:
```typescript
const historico = await context.queryAlertsByCnpj(cnpj, sinceISO)
const contratosPorSecretaria = historico.filter(f => f.secretaria === secretaria)
const percentual = contratosPorSecretaria.length / totalContratosSecretaria
if (percentual > CONCENTRACAO_LIMITE) { /* emitir finding */ }
```

### CNPJ sem dataAbertura

Se a BrasilAPI retornar `situacaoCadastral: 'nao_encontrado'` ou
`dataAbertura: undefined`, o fiscal faz skip silencioso (sem log de erro).
Isso evita falsos positivos por falha de rede ou CNPJ com OCR incorreto.

### Validação de CNPJ

O fiscal chama `validateCNPJ` (BrasilAPI) para cada CNPJ extraído do excerpt.
Em produção, isso pode gerar múltiplas chamadas HTTP por gazette. Futuramente
considerar cache local em DynamoDB (`fiscal-digital-suppliers-prod`) para
evitar consultas repetidas ao mesmo CNPJ na janela de 24 horas.
