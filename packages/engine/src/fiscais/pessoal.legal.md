# Base Legal — Fiscal de Pessoal

## Normas aplicáveis

### Lei das Eleições — Lei 9.504/97, Art. 73, V
Veda a nomeação, contratação ou admissão de pessoal para cargos em comissão
no período de 3 meses antes da eleição até a posse dos eleitos.
Exceções: vacância decorrente de falecimento, exoneração a pedido, aposentadoria.

> "Art. 73. São proibidas aos agentes públicos, servidores ou não, as seguintes condutas
> tendentes a afetar a igualdade de oportunidades entre candidatos nos pleitos eleitorais:
> V - nomear, contratar ou de qualquer forma admitir, demitir sem justa causa, suprimir
> ou readaptar vantagens ou por outros meios dificultar ou impedir o exercício funcional
> e, ao mesmo tempo, prejudicar candidato ou favorecer candidato de quem dependa ou
> com quem se relacione a autoridade responsável pelos atos, não se incluindo nessa
> vedação a nomeação ou demissão de cargos em comissão e designação ou dispensa de funções
> de confiança, desde que não destinadas ao favorecimento ou prejuízo de candidato."

### Constituição Federal, Art. 37, V
Define que cargos em comissão são de livre nomeação e exoneração, destinando-se
somente a atribuições de direção, chefia e assessoramento.

> "Art. 37, V — as funções de confiança, exercidas exclusivamente por servidores
> ocupantes de cargo efetivo, e os cargos em comissão, a serem preenchidos por
> servidores de carreira nos casos, condições e percentuais mínimos previstos em lei,
> destinam-se apenas às atribuições de direção, chefia e assessoramento."

Uso político de cargos em comissão para aparelhamento da máquina pública constitui
violação ao princípio da impessoalidade (CF, Art. 37, caput).

---

## Filtros de exclusão pré-LLM (ADR-001 — patch 2026-05-10)

Após o patch P2 Pessoal (precisão pré-patch 67,6% C2 → 36,9% C3 sobre n=572),
o Fiscal rejeita **antes** de contar atos os contextos identificados como FP
sistemático no
[`fiscal-digital-evaluations/analyses/fiscal-pessoal/ADR-001-regex-conjugacao.md`](https://github.com/fiscal-digital/evaluations/blob/main/analyses/fiscal-pessoal/ADR-001-regex-conjugacao.md):

| Categoria | Padrão | Ciclo |
|---|---|---|
| Comunicado de convocação | "COMUNICADO – NOMEAÇÃO SEM VÍNCULO EFETIVO", "comunicado de convocação" | C3 (GS-1289) |
| Vaga decorrente substituição individual | "Vaga decorrente da exoneração de X" | C3 (GS-1290) |
| Texto normativo | "VEDA A NOMEAÇÃO PELA ADMINISTRAÇÃO", "Lei Maria da Penha", "Código X veda nomeação" | C3 (GS-1291) |
| Ratificação retroativa | "ratificação retroativa", "ratificação a contar de DD/MM/AAAA" (>2 anos antes) | C1 (GS-071) |
| Lei Complementar criando quadro | "Lei Complementar nº X dispõe sobre quadro de servidores" | C3 |
| "Tornar sem efeito" em massa | "tornar sem efeito as nomeações constantes das Portarias" | C3 |
| FG / GIP | "cargo de Função Gratificada", "FG-3", "GIP" (não comissionado) | C3 |
| Concurso público regular | "Concurso Público nº X homologação", "nomeação em caráter efetivo" | C3 |
| Exoneração individual a pedido | "EXONERAR, a pedido, do servidor X" | C2 |

Exceção temporal: **janeiro de ano pós-eleição municipal** (2025, 2029, 2033)
dobra o threshold do `pico_nomeacoes` por volume legítimo de transição de mandato.

---

## Padrões detectados no MVP

### 1. Pico de nomeações em período eleitoral (`pico_nomeacoes`)

**Heurística:** contagem de atos de nomeação + exoneração + designação + cargo em comissão
**somados em toda a gazette** (não por excerpt isolado — calibração 2026-05-02 LRN-019).

**Threshold dinâmico por porte da cidade** (calibração 2026-05-06):

| Porte | População | Janela eleitoral | Fora da janela |
|---|---|---|---|
| **large**  | > 1M hab    | ≥ 10 atos | ≥ 20 atos |
| **medium** | 100k – 1M   | ≥ 5 atos  | ≥ 10 atos |
| **small**  | < 100k      | ≥ 3 atos  | ≥ 7 atos  |

**RiskScore base:** 70–100 (alto) em janela eleitoral; 45–60 (informativo) fora.

**Justificativa do threshold por porte:** capitais e grandes metrópoles publicam dezenas
de atos administrativos por dia em cadência normal. Aplicar o mesmo limiar absoluto que
em cidades pequenas gera ~50% ruído (auditoria de 296 findings em prod, 2026-05-06).
Cidades pequenas (<100k) têm administração enxuta — picos lá são proporcionalmente
muito mais raros, então mantemos limiar baixo para não perder sinais legítimos.

Mapeamento `cityId → população` em [`packages/engine/src/cities/populations.ts`](../cities/populations.ts).

**Janelas eleitorais municipais hardcoded (eleições de outubro de anos pares):**
- 2024: 01/07/2024 – 06/10/2024
- 2026: 01/07/2026 – 04/10/2026
- 2028: 01/07/2028 – 01/10/2028

**Exemplo positivo (dispara):**
```
PORTARIAS DE PESSOAL. NOMEIA Maria da Silva para cargo em comissão de Chefe de Divisão.
NOMEIA João de Oliveira para Diretor de Departamento. EXONERA Pedro Rodrigues do cargo
em comissão de Assessor Técnico. NOMEIA Ana Costa para Assessor Técnico.
DESIGNA Carlos Souza para responder pelo cargo de Diretor. EXONERA Luiza Ferreira.
NOMEIA Roberto Lima para Chefe de Seção.
```
Data da gazette: 15/08/2026 (janela eleitoral 2026) → 7 atos >= limiar 5 → `pico_nomeacoes`.

**Exemplo negativo (não dispara):**
```
NOMEIA Fernanda Castro para Diretora de Obras. EXONERA Sandra Mendes do cargo em comissão.
DESIGNA Fabio Martins para Assessor Sênior.
```
Data: 10/03/2026 (fora de janela) → 3 atos < limiar 10 → sem finding.

---

### 2. Rotatividade anormal de cargo comissionado (`rotatividade_anormal`)

**Heurística MVP (excerpt único):** presença simultânea de:
- Termo "cargo em comissão" (ou variante)
- Ao menos 1 ato de exoneração
- Ao menos 1 ato de nomeação
- Padrão sequencial exoneração → nomeação no mesmo excerpt (regex multiline)

Indica ao menos 2 titulares distintos em um único cargo no mesmo ato.

**Exemplo positivo (dispara):**
```
EXONERANDO o Sr. Antônio Rocha do cargo em comissão de Chefe da Divisão de Contratos,
e NOMEANDO a Sra. Bruna Tavares para o mesmo cargo em comissão de Chefe da Divisão
de Contratos junto à Secretaria Municipal de Administração.
```
→ `rotatividade_anormal`.

**Exemplo negativo (não dispara):**
```
PORTARIA n° 142/2026. O Prefeito Municipal NOMEIA o servidor João da Silva para o cargo
de Diretor de Departamento, junto à Secretaria Municipal de Administração.
```
Apenas nomeação, sem exoneração prévia → sem finding.

---

## Limitações MVP documentadas

1. **Comparação histórica real** — a detecção de pico comparando com a média mensal de
   nomeações por município/secretaria exige `lookupMemory` por `cityId` + janela mensal.
   Não implementado: requer schema de série histórica em DynamoDB.

2. **Rotatividade cross-gazette** — detectar o mesmo cargo com 3+ trocas em 12 meses
   em diferentes gazettes exige um schema de "personas" (cargo + titular + período)
   no DynamoDB. Não implementado no MVP.

3. **Janelas eleitorais hardcoded** — parametrizar via config ou DynamoDB quando
   cobertura se expandir para estados com eleições estaduais (anos ímpares).

4. **Falsos positivos fora de janela** — gazette de reestruturação administrativa legítima
   pode gerar múltiplos atos de uma vez. O limiar de 10 (fora de janela) é intencialmente
   alto para minimizar ruído informativo.

---

## PR de mudança nesta lógica exige

1. Referência legal (lei + artigo) para o novo padrão
2. Exemplo de gazette que dispara o alerta
3. Exemplo que NÃO deve disparar (falso positivo evitado)
4. Se alterar limiares: justificativa quantitativa (ex: análise de amostra de gazettes)
