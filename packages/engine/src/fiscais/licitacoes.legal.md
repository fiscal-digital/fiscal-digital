# Fiscal de Licitações — Documentação Legal

## 1. Base Legal

### Lei 14.133/2021 — Nova Lei de Licitações

**Art. 75** — Dispensa de Licitação por valor:

> **Inciso I** — para obras e serviços de engenharia ou de manutenção de veículos automotores, no limite de até **R$ 130.984,20** (valores vigentes em 2026).
>
> **Inciso II** — para outros serviços e compras, no limite de até **R$ 65.492,11** (valores vigentes em 2026).

**Art. 75, §1º** — Fracionamento:

> "As contratações de que trata este artigo não poderão ser utilizadas para fragmentação de objeto único visando se enquadrar nos limites previstos nos incisos I e II do caput deste artigo."

### Decreto 12.807/2025 — Valores vigentes a partir de 2026-01-01

Os limites do Art. 75 foram reajustados pelo Decreto 12.807/2025 via IPCA-E (Lei 14.133/2021, Art. 182).

Referência: https://www.gov.br/compras/pt-br/acesso-a-informacao/comunicados/2025/no-47-25-decreto-altera-valores-da-lei-14-133-para-compras-publicas

> **Atenção:** Os limites são reajustados anualmente em janeiro via IPCA-E. O código fonte possui `TODO(legal-constants)` de revisão anual em `legal-constants.ts`.

---

## 2. Padrão Detectado

O Fiscal de Licitações identifica dois padrões em diários oficiais municipais:

### Padrão A — Dispensa irregular por valor (Art. 75, I e II)

Uma dispensa de licitação é publicada com valor **acima** do limite legal estabelecido para o inciso aplicável:

- Obras e serviços de engenharia (inciso I): valor > R$ 130.984,20
- Demais serviços e compras (inciso II): valor > R$ 65.492,11

A classificação entre inciso I e inciso II é feita primariamente pelo campo `subtype` extraído pelo Haiku no `extract_entities` skill; quando `subtype` é nulo, aplica-se fallback por heurística de palavras-chave no texto do excerpt (obra, engenharia, reforma, construção, pavimentação).

### Padrão B — Fracionamento de contrato (Art. 75, §1º)

Múltiplas dispensas para o mesmo CNPJ dentro de uma janela de 12 meses, cuja soma total supera o limite do Art. 75 inciso II.

Requer **ao menos 1 dispensa anterior** para o mesmo CNPJ/cidade dentro da janela para emitir alerta.

---

## 3. Exemplo que DISPARA o alerta (Padrão A — inciso II)

```
DISPENSA DE LICITAÇÃO n° 012/2026. Objeto: contratação de serviços de consultoria em
tecnologia da informação. Valor: R$ 80.000,00. Base Legal: Lei 14.133/2021, Art. 75, II.
Contratada: Tech Solutions LTDA, CNPJ: 12.345.678/0001-90.
Secretaria Municipal de Administração.
```

**Por que dispara:** R$ 80.000,00 > R$ 65.492,11 (limite inciso II).
Tipo de Finding: `dispensa_irregular`, legalBasis: `"Lei 14.133/2021, Art. 75, II"`.

---

## 4. Exemplo que NÃO DISPARA o alerta (Padrão A — inciso II)

```
DISPENSA DE LICITAÇÃO n° 007/2026. Objeto: contratação de serviços de manutenção
de equipamentos. Valor: R$ 30.000,00. Base Legal: Lei 14.133/2021, Art. 75, II.
Contratada: Manutenções Brasil LTDA, CNPJ: 22.333.444/0001-55.
Secretaria Municipal de Saúde.
```

**Por que NÃO dispara:** R$ 30.000,00 ≤ R$ 65.492,11 (dentro do limite inciso II).

### Exemplo que NÃO DISPARA (inciso I — obra abaixo do teto)

```
DISPENSA DE LICITAÇÃO n° 025/2026. Objeto: obra de pavimentação da rua XV de Novembro.
Valor: R$ 125.000,00. Base Legal: Lei 14.133/2021, Art. 75, I.
Contratada: Pavimenta Sul LTDA, CNPJ: 66.777.888/0001-99.
Secretaria Municipal de Obras.
```

**Por que NÃO dispara:** palavra-chave "pavimentação" classifica como inciso I (obras).
R$ 125.000,00 ≤ R$ 130.984,20 (dentro do limite inciso I).
Mesmo que R$ 125.000,00 > limite inciso II (R$ 65.492,11), a classificação correta é inciso I.

---

## Filtros de exclusão pré-LLM (ADR-001 — patch 2026-05-10)

Após o patch P2 Licitações (precisão Ciclo 1 viciada 88,9% → Ciclo 2 definitiva
37,4% sobre n=150), o Fiscal aplica 2 grupos de filtros:

### Vazamento de escopo (roteia para outro Fiscal)

| Padrão | Roteamento | GS |
|---|---|---|
| `locação de imóvel` | FiscalLocação (Art. 74 III, sem teto) | GS-077, 081 |
| `Termo Aditivo / aditamento / prorrogação / apostilamento` | FiscalContratos (Art. 125) | C2 |
| `DESIGNA Fiscal de Contrato` | skip (não é nova contratação) | GS-081 |

### Hipóteses sem teto da Lei 14.133 Art. 75 (pular dispensa_irregular)

| Inciso | Padrão | GS |
|---|---|---|
| III "a" | "fornecedor exclusivo", "única fornecedora", "notória especialização", "exclusividade comprovada" | C2 |
| IV | "emergência", "calamidade pública", "urgência declarada/sanitária", "estado de emergência" | GS-074 |
| VIII | "medicamento", "insumo médico/hospitalar/farmacêutico", "órtese/prótese", "vacina" | GS-074 |
| IX | "Art. 75 IX", "contratação entre entes da administração" | C2 |
| XV | "Art. 75 XV", "universidade pública/estadual/federal", "fundação de apoio/pesquisa" | C2 |

Vocabulário OBRA expandido (Art. 75 I, teto R$ 100k):
`obra|reforma|engenharia|construção|pavimentação|edificação|drenagem|terraplenagem|recuperação estrutural`.

---

## 5. Limitações Conhecidas

### 5.1. Classificação inciso I vs II via LLM (MIT-01)

A classificação entre inciso I (obras/engenharia) e inciso II (demais serviços) agora é feita em duas camadas:

1. **Primária — campo `subtype` do `extract_entities` (Haiku):** o LLM classifica o objeto da contratação como `obra_engenharia`, `servico`, `compra` ou `null`. Quando presente, esse valor determina o inciso diretamente.
2. **Fallback — heurística regex (`OBRA_RE`):** aplicada apenas quando `subtype` é `null` (Haiku não classificou ou texto ambíguo). Detecta palavras-chave: obra, engenharia, reforma, construção, pavimentação.

**Falso negativo resolvido (MIT-01):**

- "Dispensa para reforma de equipamento de informática, R$ 80.000,00" — **Antes do MIT-01:** "reforma" disparava OBRA_RE → inciso I (teto R$ 130.984,20) → valor abaixo do teto → **nenhum alerta gerado** (falso negativo). **Agora:** Haiku classifica como `compra` → inciso II (teto R$ 65.492,11) → R$ 80k excede o teto → **dispara `dispensa_irregular` corretamente**.

Caso ainda ambíguo documentado:

- "Locação de equipamentos para obras" — pode ser classificado como `obra_engenharia` pelo Haiku quando é serviço. Monitorar via feedback loop de falsos positivos.

### 5.2. Dispensas por emergência (Art. 75, inciso VIII)

Dispensas emergenciais com valores acima do teto dos incisos I/II são legalmente válidas (Art. 75, VIII). O Fiscal atualmente não distingue o fundamento da dispensa, podendo gerar falso positivo para emergências. **TODO:** filtrar por `legalBasis` quando incisar "VIII" após extração LLM.

### 5.3. Fracionamento — somente inciso II como referência

O fracionamento é atualmente verificado apenas em relação ao teto inciso II (R$ 65.492,11), mesmo para obras. **TODO:** verificar fracionamento por inciso I para CNPJs de empresas de engenharia.

### 5.4. Dependência de `queryAlertsByCnpj`

Em produção, a detecção de fracionamento depende do GSI2-cnpj-date da tabela `fiscal-digital-alerts-prod`. Se o contexto não injetar `queryAlertsByCnpj`, o fracionamento não é detectado (não gera erro, apenas não detecta).

---

## 6. Como Reportar Falso Positivo

1. Abra uma issue em https://github.com/fiscal-digital/fiscal-digital com label `falso-positivo`.
2. Inclua:
   - Link para o diário oficial original (Querido Diário)
   - O Finding ID gerado
   - Razão pela qual o alerta é incorreto (ex: dispensa emergencial Art. 75, VIII)
3. O finding será revisado, e se confirmado falso positivo, uma correção será publicada no mesmo canal com o mesmo alcance do alerta original (política de retratação pública).
