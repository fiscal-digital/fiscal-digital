<!-- legal-verified: fontes em fiscais/*.legal.md lidas nesta sessão (licitacoes, locacao, convenios, pessoal, publicidade, contratos, diarias) -->
# Avaliação do Ciclo 4 — relatório (ANL-FSC-003, 2026-07-19)

**Analista:** papel Opus (SDD) — item ANL-FSC-003
**Janela de observação original:** 2026-05-11 → 2026-06-10 (venceu SEM medição por pausa do projeto)
**Data da avaliação:** 2026-07-19 (retroativa)
**Escopo:** leitura read-only de `fiscal-digital-alerts-prod` (us-east-1). NENHUMA escrita em prod, SSM, flag ou código.

## TL;DR

- **793 findings** ativos em prod (FINDING#), dos quais **72 são publicáveis** (risk ≥ 60 **e** confidence ≥ 0.70). O número bate com o "~72 ativos" esperado.
- **Nenhum Fiscal atinge o gate ≥ 5 TP + ≤ 1 FP na janela.** Ou por amostra insuficiente, ou por FP acima do teto, ou por bug estrutural.
- O ciclo autônomo **quase não produziu findings pós-janela** (2 no total até 2026-07-19): a indexação do Querido Diário está estagnada (LRN-20260505-003), logo estender a observação **não** acumularia amostra nova.
- **Recomendação SSM:** **não reativar** os thresholds de publicação. Manter desligados os Fiscais já desligados (locação, convênios). Corrigir BUG-FSC-002 (licitações) e um bug novo de janela temporal (publicidade) **antes** de qualquer reativação.
- **Recomendação FiscalFornecedoresV2:** **manter OFF.** 0 findings de fornecedores em prod; não há sinal empírico que justifique ativar.

---

## 1. Método

1. Scan projetado (leve) de `FINDING#*` em `fiscal-digital-alerts-prod` → 793 itens. Campos pesados (`narrative`, `evidence`) excluídos do scan de contagem.
2. Bucketização por Fiscal e por período via `createdAt`:
   - **Janela:** `createdAt` 2026-05-11 → 2026-06-10.
   - **Pós-janela:** 2026-06-11 → 2026-07-19.
3. **Publicável** = `riskScore ≥ 60` **e** `confidence ≥ 0.70` (regra de publicação da CLAUDE.md). É a população relevante para a decisão de threshold SSM.
4. Classificação TP / FP / BORDERLINE lendo `narrative` + `evidence[].excerpt` + URL do Querido Diário, cruzando com os critérios de FP dos ADRs do `fiscal-digital-evaluations` (licitações, locação, pessoal, convênios).
5. Fetch completo (BatchGetItem, 84 itens) dos **72 publicáveis** + **15 fracionamento** + amostra de 12 locação não-publicáveis.

**Nota de escopo:** dado o volume (444 locação, 144 licitações, 118 pessoal), a classificação TP/FP foi feita sobre o **conjunto publicável** (72), que é o que a decisão SSM afeta. Findings não-publicáveis foram amostrados para caracterizar precisão, não classificados um a um. Ver Limitações (§7).

---

## 2. Distribuição por Fiscal e período

| Fiscal | Total | Janela | Pós-janela | Publicáveis | Faixa `createdAt` |
|---|---:|---:|---:|---:|---|
| fiscal-locacao | 444 | 443 | 1 | 2 | 2026-05-13 .. 2026-06-29 |
| fiscal-licitacoes | 144 | 144 | 0 | 39 | 2026-05-24 .. 2026-05-31 |
| fiscal-pessoal | 118 | 117 | 1 | 8 | 2026-05-13 .. 2026-07-06 |
| fiscal-convenios | 66 | 66 | 0 | 3 | 2026-05-13 .. 2026-05-14 |
| fiscal-publicidade | 13 | 13 | 0 | 13 | 2026-05-13 .. 2026-05-14 |
| fiscal-contratos | 3 | 3 | 0 | 3 | 2026-05-25 |
| fiscal-diarias | 3 | 3 | 0 | 2 | 2026-05-13 .. 2026-05-14 |
| fiscal-geral | 2 | 1 | 0 | 2 | 2026-05-02 .. 2026-05-24 |
| fiscal-fornecedores | 0 | 0 | 0 | 0 | — |
| fiscal-nepotismo | 0 | 0 | 0 | 0 | — |
| **Total** | **793** | **790** | **2** | **72** | |

Observações estruturais:
- Quase tudo tem `createdAt` na janela porque o **reanalyze v1.7.0 (2026-05-13/14)** recriou os findings; a "janela" contém a batelada do reanalyze, não emissões diárias. Isso é esperado, mas significa que a janela mede o **estado do reanalyze**, não 30 dias de operação autônoma.
- **licitações foi regenerada depois** (2026-05-24 → 05-31), fora da batelada principal.
- **Pós-janela = 2 findings** (locação 1, pessoal 1). O ciclo autônomo praticamente parou: sem gazettes novas do QD, não há amostra fresca. Isso invalida a premissa de "observação de 30 dias" como fonte de evidência.
- O campo `published` está **ausente** em todos os 793 itens.

---

## 3. Gate por Fiscal (avaliação sobre o conjunto publicável)

TP = verdadeiro positivo (irregularidade plausível, fonte confere). FP = falso positivo (vazamento de contexto, exceção legal, agregado orçamentário, polaridade negativa). BORDERLINE = evidência insuficiente para decidir (listado para o Diego em §5).

| Fiscal | Publicáveis | TP | FP | Borderline | Atinge gate (≥5 TP, ≤1 FP)? | Recomendação SSM |
|---|---:|---:|---:|---:|---|---|
| fiscal-licitacoes | 39 | ~12 (dispensa) | ≥3 + camada de fracionamento com bug | ~6 | **NÃO** (FP > 1 + BUG-FSC-002) | **Esperar** fix BUG-FSC-002 + verificar filtros ADR-001 |
| fiscal-publicidade | 13 | 1 | ~11 | 1 | **NÃO** (precisão ~8%) | **Manter OFF** — patch de janela temporal + vazamento |
| fiscal-pessoal | 8 | 6 (pico) | 1–2 (rotatividade) | 2 | **BORDERLINE** | Manter threshold; **desativar subtipo `rotatividade_anormal`** |
| fiscal-convenios | 3 | 3 | 0 | 0 | **NÃO** (amostra insuficiente: 3 < 5) | Aprovação condicional / manter OFF |
| fiscal-locacao | 2 | 2 | 0 (pub) / maioria FP (não-pub) | 0 | **NÃO** (amostra insuficiente: 2 < 5) | **Manter OFF** |
| fiscal-contratos | 3 | 0–1 | 2 | 1 | **NÃO** (amostra insuficiente + FP) | Manter threshold; revisar detecção de valor |
| fiscal-diarias | 2 | 0 | 2 | 0 | **NÃO** | **Manter OFF** — patch valor-por-diária |
| fiscal-geral | 1 (janela) | borderline | — | 1 | **NÃO** (amostra insuficiente: 1 < 5) | Depende do fix de licitações |
| fiscal-fornecedores | 0 | 0 | 0 | 0 | **NÃO** (0 findings) | **Manter V2 OFF** |
| fiscal-nepotismo | 0 | 0 | 0 | 0 | **NÃO** (0 findings) | Manter (conservador por design) |

**Conclusão geral: nenhum Fiscal passa limpo.** A base empírica para reativar os thresholds SSM (`publishRiskThreshold` / `publishConfidenceThreshold`, TEC-ENG-002) não existe.

---

## 4. Achados por Fiscal

### 4.1 fiscal-licitacoes — BUG-FSC-002 residual CONFIRMADO (bloqueia decisão SSM)

**39 publicáveis = 24 `dispensa_irregular` + 15 `fracionamento`.**

**Camada dispensa_irregular (plausível, mas com cauda de FP).** As dispensas de valor elevado são o objetivo legítimo do Fiscal e as narrativas são factuais e não-acusatórias ("recomenda-se análise"). ~12 são TP plausível (reforma UBS R$ 1,25M; concreto SLOMP R$ 549k — que é TP do golden set; tubos R$ 676k; transporte escolar; ração canil R$ 179k; pavimentação R$ 407k). Mas há **≥ 3 FP por exceção legal visível no excerpt** que o patch ADR-001 deveria ter capturado e não capturou:
- máscaras PFF2 N95 "em caráter emergencial" (2021, COVID — hipótese de emergência sanitária);
- CODECA, empresa pública municipal, manutenção de áreas (contratação de ente público);
- FEPESA, "contratação de instituição" de ensino/pesquisa (hipótese de instituição sem fins lucrativos).

Já com ≥ 3 FP, a camada dispensa **não atinge ≤ 1 FP**.

**Camada fracionamento — bug estrutural (BUG-FSC-002 residual).** Confirmado no código deployado (`packages/engine/src/fiscais/licitacoes.ts`, "Etapa 8"):

1. **Emissão por gazette, não por (CNPJ, janela).** O bloco de fracionamento roda dentro do loop por gazette; cada gazette em que o mesmo CNPJ aparece emite um **novo** finding de fracionamento. Resultado medido: **15 findings de fracionamento colapsam em apenas 6 padrões distintos de CNPJ** (VIAÇÃO GIRATUR 4×, SGANZERLA 3×, ROSSI/MERCASERRA/PASQUALI/CODECA 2× cada). Inflação de ~2,5×.
2. **Inclusão de contratos isentos na soma.** O par CODECA soma "2 dispensas = R$ 24.446.000,58", em que um componente é um "Termo de contrato" de **R$ 23,34M fundamentado no Art. 75, inciso IX** (contratação de ente público, sem teto) — indevidamente somado como se fosse dispensa fracionada. Um "fracionamento" de R$ 24M é FP-por-inflação.
3. **Leitura dual `valor ?? value`** (linha 280: `item.valor ?? item.value ?? 0`). É o mismatch de campo documentado em BUG-FSC-002 (Camada B): os registros históricos gravam o montante em `value` (linha 240), mas o código lê `item.valor` primeiro. A soma depende do fallback; qualquer registro com `valor` divergente entra na conta errado.
4. **Sobreposição com dispensa:** **8 dos 15** findings de fracionamento compartilham a mesma gazette-excerpt de um finding `dispensa_irregular` — o mesmo ato é publicado duas vezes (ex.: GIRATUR 2022-08-16 R$ 923k é dispensa **e** fracionamento; CODECA 2023-02-02; ROSSI 2021-06-02).

**Quantificação:** dos 15 fracionamento, ≥ 1 é FP claro por inflação (CODECA R$ 24M), 8 são duplicatas de dispensas já contadas, e o conjunto todo está inflado ~2,5×.

**Recomendação:** a decisão SSM de licitações **deve esperar** o fix de BUG-FSC-002 (deduplicar fracionamento por CNPJ/janela; excluir Art. 75 IX e demais hipóteses sem teto da soma; unificar o campo de valor) **e** a verificação de que os filtros de exceção legal do ADR-001 (emergência/ente público/instituição) estão de fato deployados — os dados mostram que não estão surtindo efeito.

### 4.2 fiscal-publicidade — bug de janela temporal (NOVO — nunca foi patchado no Ciclo 4)

Publicidade **não** estava na lista de patches do Ciclo 4 (P0 diárias, P0 pessoal, P1 contratos, P2 licitações), mas **todos os seus 13 findings são publicáveis** e estariam publicando. Precisão ~8%:

- **1 TP plausível:** São Paulo, aditivo de R$ 6,018M ao contrato de publicidade (Mídia Pull) em 30/08/2024, dentro dos 3 meses antes do pleito de 06/10/2024.
- **~11 FP por vazamento de contexto:** "divulgação" em sumário/índice de diário; designação de fiscal de contrato; linha orçamentária ("Publicidade Oficial"); seleção de agentes de saúde (SESA/SGTES); concessão de jogos/"marketing"; área cultural.
- **Bug temporal:** vários findings têm data de gazette em **nov/dez 2024 — depois** da eleição (06/10/2024) — porém rotulados "dentro da janela vedada de 3 meses antes da eleição". A checagem de janela não valida que a data da gazette é anterior ao pleito.

**Recomendação:** manter sem publicação e **abrir patch** (validar `data_gazette < data_eleição` dentro da janela de 3 meses; filtrar sumário/índice, designação de fiscal e linha orçamentária). Prioridade alta porque publica hoje.

### 4.3 fiscal-pessoal — pico_nomeacoes OK; rotatividade_anormal com FP

8 publicáveis: **6 `pico_nomeacoes`** (5–6 atos distintos de exoneração/nomeação em cargos comissionados na janela eleitoral de 2024 — Nova Iguaçu, Natal, João Pessoa, Vila Velha) são **TP plausível**. **2 `rotatividade_anormal`** são fracos: um descreve exoneração+nomeação da **mesma pessoa para o mesmo cargo, por continuidade** (explicitamente benigno no texto) e cai em janeiro de 2025 (transição de mandato — exceção do ADR-001); a própria narrativa admite "análise de rotatividade... em desenvolvimento".

**Recomendação:** manter o threshold do `pico_nomeacoes` (que sozinho atinge ~6 TP, 0 FP). **Desativar / não publicar o subtipo `rotatividade_anormal`** enquanto a análise cross-gazette está incompleta e gera FP.

### 4.4 fiscal-convenios — patch funcionou, mas amostra insuficiente

Só 3 publicáveis, todos **TP plausível**: Termos de Fomento/Colaboração reais com OSC sem chamamento (Associação Quintal Mágico R$ 3M; Assoc. Virvi Ramos R$ 1,22M; Comissão da Festa da Uva R$ 1,4M). O patch ADR-001 (excluir Contrato de Repasse federal, universidades, decreto orçamentário) parece ter funcionado — os FP antigos sumiram. Mas **3 TP < 5** → não bate o gate.

**Recomendação:** encorajador (3 TP, 0 FP), porém abaixo do gate. Como a observação não vai acumular mais (QD estagnado), a escolha é do Diego: aprovação condicional com confirmação manual dos 3 TP, ou manter OFF até QD voltar.

### 4.5 fiscal-locacao — manter OFF

2 publicáveis (conf 0.85) são TP plausível (locação por inexigibilidade sem justificativa: ZWAP R$ 2,19M; prédio EMEF R$ 522k). Mas **os 442 restantes (conf 0.65) não publicam e continuam majoritariamente FP** — a amostra de 12 mostra exatamente os padrões que o ADR-001 mandava filtrar e que **ainda disparam**: designação de gestor/fiscal de contrato; programa social (Cadastro Único); renúncia fiscal de IPTU; documentos de união estável que citam "contrato de locação". Precisão da camada não-publicável coerente com o baseline de 16%.

**Recomendação:** **manter OFF.** 2 TP publicáveis < 5 (amostra insuficiente) e o conjunto subjacente segue com precisão baixa — os filtros do ADR-001 não estão surtindo efeito no engine deployado.

### 4.6 fiscal-contratos — amostra insuficiente + FP

3 publicáveis: um aditivo de R$ 7,26M (Guarulhos) cujo excerpt mistura valor de aditivo com comunicado de licença ambiental (**borderline** — falta o valor do contrato-base para checar o percentual do Art. 125); um "aditivo" que é só **prorrogação de prazo de 12 meses** (não é acréscimo de valor — FP provável); e um aditivo em **contrato de financiamento com a Caixa (FINISA, R$ 50M)** alterando prazo de utilização de crédito (operação de crédito, fora do escopo de aditivo abusivo — FP provável).

**Recomendação:** manter threshold; revisar a detecção para exigir acréscimo de **valor** > 25%/50% e excluir prorrogação de prazo e contratos de financiamento. 3 < 5 (amostra insuficiente).

### 4.7 fiscal-diarias — manter OFF

2 publicáveis, **ambos FP**: R$ 5,14M "diária" é na verdade um **agregado orçamentário** do Fundo Municipal de Saúde ("despesas com diárias, serviços e contratos administrativos"); R$ 10.000 "diária" é uma **linha de natureza de despesa** cujo texto diz explicitamente "quando **não** houver pagamento de diárias" (polaridade negativa). O patch P0 reduziu 37 → 3, mas os 2 sobreviventes ainda são FP.

**Recomendação:** manter OFF; patch para validar valor por diária individual (não agregado) e polaridade negativa.

### 4.8 fiscal-geral — depende do fix de licitações

2 findings `padrao_recorrente` (mesmo CNPJ GIRATUR), sendo 1 pré-janela preservado do reanalyze e 1 na janela. Consolida as ocorrências de licitações — logo herda a inflação do fracionamento ("4 ocorrências" para GIRATUR está inflado pelo bug de emissão-por-gazette). A concentração de fornecedor **pode** ser TP real (várias dispensas de transporte escolar ao mesmo CNPJ), mas a **contagem** não é confiável até o fix. 1 na janela < 5.

### 4.9 fiscal-fornecedores / fiscal-nepotismo — 0 findings

Nenhum finding em prod. Nepotismo é conservador por design (confidence ≥ 0.95). Fornecedores: ver §6.

---

## 5. Borderlines para o Diego decidir

Não classifiquei os itens abaixo — a evidência do excerpt não basta; precisam do PDF no Querido Diário ou de dado externo.

1. **licitações — T&F Construções, R$ 103.964,50 (2026-05-30, Bertioga/2910800).** Fundamento Art. 75, I. R$ 103,9k está **abaixo** do teto de obras (R$ 130.984,20/2026); se o objeto for obra, pode ser FP por classificação de inciso. Ver `.../2910800/2026-05-30/8232f71905b16727f4e3626e15dde2796356c209.pdf`.
2. **licitações — FEPESE R$ 3,37M (Florianópolis) e FEPESA R$ 1,86M (Maceió).** Fundações de apoio ao ensino/pesquisa — possível hipótese sem teto (instituição sem fins lucrativos). Confirmar objeto.
3. **licitações — aquisição de imóvel Unimed-SC, R$ 9,5M (Joinville).** Aquisição de imóvel tem regime próprio (Art. 74) — provável vazamento de escopo para Locação, não dispensa por valor.
4. **licitações — material médico-hospitalar R$ 93k e fraldas para rede de saúde R$ 207k (Caxias).** Possível hipótese de insumos de saúde (Art. 75, VIII). Confirmar.
5. **licitações — máscaras COVID R$ 230k (2021) vs. papel toalha "emergencial" R$ 101k (2025), ambas Caxias.** A emergência da máscara em 2021 é plausivelmente legal; "papel toalha emergencial" em 2025 é suspeito. Julgamento humano.
6. **contratos — aditivo Guarulhos R$ 7,26M (2021-12-23).** Falta o valor do contrato-base para calcular o percentual do Art. 125 (25%/50%).
7. **fiscal-geral — padrao_recorrente GIRATUR.** Concentração real de fornecedor ou artefato da duplicação de fracionamento? Depende do fix de BUG-FSC-002.
8. **convênios — os 3 TP (Quintal Mágico, Virvi Ramos, Festa da Uva).** Antes de reativar, confirmar no PDF completo que não houve chamamento (o patch reduz confidence se "chamamento" aparecer em qualquer página).

---

## 6. FiscalFornecedoresV2 — manter OFF

- **Sinal empírico atual = 0 findings de fornecedores** (v1) em prod. Não há nada que valide ou invalide V2 com dados reais.
- V2 está dormente atrás de feature flag desde PR #90 (2026-06-07), com `GSI2_ConcentracaoSecretaria` provisionado em suppliers-prod (PR #89). A infra está pronta, mas **falta o insumo**: sem um collector populando `fiscal-digital-suppliers-prod` (RFB/CGU) e sem golden set de fornecedores no `fiscal-digital-evaluations` atingindo os ≥ 85% de precisão, ativar V2 seria publicar sem baseline.
- **Recomendação:** **manter V2 OFF.** Pré-condições para reavaliar: (a) collector de fornecedores efetivamente gravando em suppliers-prod; (b) golden set de fornecedores rotulado com precisão medida; (c) decisão SSM geral desbloqueada (hoje nenhum Fiscal passa o gate).

---

## 7. Limitações do método

1. **A janela não mediu operação autônoma.** `createdAt` reflete o reanalyze de 2026-05-13/14, não 30 dias de ciclo diário. Só 2 findings são genuinamente pós-janela. A premissa original de "observação de 30 dias" não se realizou — a avaliação é do **estado do reanalyze**, não de comportamento sob operação.
2. **QD estagnado (LRN-20260505-003):** sem gazettes novas (Caxias parou em 2025-12-15, POA em 2025-10-31), estender a observação não gera amostra. O gate de 30 dias é inatingível pela via temporal enquanto o collector estiver em MON-only.
3. **Classificação TP/FP sobre o conjunto publicável (72), não sobre os 793.** Locação (444), pessoal (118) e dispensas não-publicáveis de licitações foram amostradas, não classificadas item a item. FP na cauda não-publicável não afeta a decisão SSM (não publica), mas afeta a qualidade do site/API.
4. **Sem abrir os PDFs completos do QD.** A classificação usou `narrative` + `evidence[].excerpt`. Exceções legais (Art. 75 III/IV/VIII/IX/XV) que só aparecem fora do excerpt podem ter sido perdidas — daí a lista de borderlines.
5. **Não confirmei a versão de código deployada por Fiscal.** A inferência "filtros ADR-001 não surtiram efeito" vem do padrão dos findings (FPs que os patches deveriam remover ainda disparam), não de um diff da Lambda em prod. Vale um check de versão antes de agir.
6. **TP "plausível" ≠ TP confirmado.** Sem contraditório do órgão, um TP é "irregularidade aparente que merece análise" — coerente com a linguagem indiciária e não-acusatória do projeto.

---

## 8. Próximos passos sugeridos (decisão do Diego)

1. **Não reativar thresholds SSM** globalmente — sem base empírica.
2. **Corrigir BUG-FSC-002** (fracionamento de licitações) — bloqueia a decisão SSM de licitações.
3. **Abrir patch de publicidade** (validação de janela temporal + vazamento de contexto) — publica FP hoje; prioridade alta.
4. **Desativar subtipo `rotatividade_anormal`** do fiscal-pessoal.
5. **Manter OFF:** locação, convênios, diárias, FiscalFornecedoresV2.
6. **Revalidar quando o QD voltar a indexar** — só então uma janela real de observação faz sentido.
