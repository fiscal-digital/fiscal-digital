# Fiscal de Convênios — Documentação Legal

## 1. Base Legal

### Lei 13.019/2014 — Marco Regulatório das Organizações da Sociedade Civil (MROSC)

Disciplina parcerias entre a Administração Pública e Organizações da Sociedade Civil
(OSC), instituídas por meio de **termo de fomento**, **termo de colaboração** ou
**acordo de cooperação**.

**Art. 24, caput** — Chamamento público é regra geral:

> "Exceto nas hipóteses previstas nesta Lei, a celebração de termo de colaboração
> ou de termo de fomento será precedida de chamamento público voltado a selecionar
> organizações da sociedade civil que tornem mais eficaz a execução do objeto."

**Art. 29** — Dispensa de chamamento público (rol taxativo):

> Casos de urgência (até 180 dias), guerra, calamidade pública, programas de proteção
> a pessoas ameaçadas, atividades de educação, saúde e assistência social.

**Art. 30** — Inexigibilidade de chamamento público:

> Inviabilidade de competição entre OSCs em razão da natureza singular do objeto da
> parceria, ou quando as metas só puderem ser atingidas por entidade específica.

**Art. 33 e Art. 35** — Requisitos de habilitação e celebração formal renovada por
parceria; repasses sucessivos a uma mesma OSC sem nova celebração formal podem
caracterizar continuidade fática fora do instrumento jurídico.

### Decreto Federal 8.726/2016

Regulamenta a Lei 13.019/2014 no âmbito federal. Municípios usualmente adotam por
analogia ou editam decreto local com regras equivalentes.

### Limiar de Valor

A Lei 13.019 não fixa teto rígido para celebração; a obrigatoriedade de chamamento
não depende do valor. Adotamos **R$ 600.000,00** como limiar prático de risco
elevado, observado em decretos municipais (RS, SP, MG) — calibrar por município
quando piso local for diferente.

> **Atenção:** o piso é heurística para focar a fiscalização em parcerias de maior
> impacto financeiro. **Convênios abaixo do limiar não estão isentos da regra de
> chamamento** — apenas ficam fora do escopo deste alerta automático.

---

## 2. Padrão Detectado

### Padrão A — Convênio sem chamamento público

Termo de fomento ou termo de colaboração com OSC publicado com:

- valor extraído **acima** de R$ 600.000,00
- **sem** menção a chamamento público, dispensa fundamentada (Art. 29) ou
  inexigibilidade (Art. 30) no excerpt do diário

Tipo de Finding: `convenio_sem_chamamento`
Base legal: `"Lei 13.019/2014, Art. 24"`

### Padrão B — Repasse recorrente ao mesmo OSC

3+ convênios para o mesmo CNPJ (OSC) na mesma cidade dentro de janela de 12
meses, sem evidência de nova celebração formal.

Tipo de Finding: `repasse_recorrente_osc`
Base legal: `"Lei 13.019/2014, Art. 33 e 35"`

### Fora de escopo

- **Acordo de cooperação puro** (Art. 2º, VIII-A da Lei 13.019/2014) — não envolve
  repasse financeiro; o Fiscal não emite finding por valor.
- **Chamamento público com convênio celebrado** — quando o excerpt cita explicitamente
  "chamamento público nº X" ou "Edital de chamamento", presume-se regularidade.

---

## 3. Exemplos que DISPARAM o alerta

### Exemplo 3.1 — Termo de fomento R$ 800k sem chamamento

```
TERMO DE FOMENTO n° 005/2026. Celebração entre o Município e a Organização da
Sociedade Civil Instituto Apoio Caxias. Valor: R$ 800.000,00. Objeto: programa
de assistência social. Contratada: Instituto Apoio Caxias, CNPJ:
12.345.678/0001-90. Secretaria Municipal de Assistência Social.
```

**Por que dispara:** R$ 800.000,00 > limiar de R$ 600.000,00 (Art. 24); o excerpt
não menciona chamamento público, Art. 29 ou Art. 30. Tipo: `convenio_sem_chamamento`.

### Exemplo 3.2 — Termo de colaboração R$ 1.2 mi sem fundamento legal explícito

```
TERMO DE COLABORAÇÃO n° 015/2026. Celebra-se parceria entre o Município e a OSCIP
Educar Sul. Valor: R$ 1.200.000,00. Objeto: oficinas pedagógicas em escolas da
rede municipal. Contratada: Educar Sul OSCIP, CNPJ: 22.333.444/0001-55.
```

**Por que dispara:** valor muito acima do limiar; ausência total de menção a
chamamento, dispensa ou inexigibilidade. Risco elevado por valor.

### Exemplo 3.3 — Repasse recorrente ao mesmo OSC

Sequência de 3 termos de fomento ao mesmo CNPJ em 12 meses:

```
2025-12-10: TERMO DE FOMENTO n° 050/2025 — OSC Parceira (CNPJ 12.345.678/0001-90)
            — Valor R$ 200.000,00
2026-02-10: TERMO DE FOMENTO n° 010/2026 — OSC Parceira (mesmo CNPJ)
            — Valor R$ 200.000,00
2026-04-10: TERMO DE FOMENTO n° 040/2026 — OSC Parceira (mesmo CNPJ)
            — Valor R$ 200.000,00
```

**Por que dispara:** 3 repasses ao mesmo CNPJ em 12 meses, total R$ 600.000,00.
Tipo: `repasse_recorrente_osc`, base Art. 33 e 35.

---

## 4. Exemplos que NÃO DISPARAM

### Exemplo 4.1 — Convênio com chamamento público

```
TERMO DE COLABORAÇÃO n° 011/2026. Após chamamento público nº 003/2026 (Edital
publicado em 15/02/2026), celebra-se parceria com a OSC Educar Caxias.
Valor: R$ 750.000,00. CNPJ: 88.999.000/0001-11.
```

**Por que NÃO dispara:** mesmo com valor > limiar, há evidência textual de
chamamento público — `CHAMAMENTO_RE` casa "chamamento público nº 003/2026".

### Exemplo 4.2 — Convênio com inexigibilidade Art. 30 fundamentada

```
TERMO DE COLABORAÇÃO n° 030/2026. Inexigibilidade de chamamento público com
fundamento no Art. 30 da Lei 13.019/2014, dada a singularidade do objeto.
Parceria com OSC Centro Cultural Histórico Caxias. Valor: R$ 900.000,00.
```

**Por que NÃO dispara:** o excerpt explicita "Art. 30 da Lei 13.019/2014" e
"inexigibilidade de chamamento" — `INEXIGIBILIDADE_ART30_RE` aplica.

### Exemplo 4.3 — Acordo de cooperação sem repasse

```
ACORDO DE COOPERAÇÃO n° 008/2026. Entre o Município e a OSC Saúde Solidária
para desenvolvimento de atividades educativas em saúde, sem repasse de
recursos financeiros.
```

**Por que NÃO dispara:** acordo de cooperação **puro** (sem termo de fomento ou
colaboração) está fora de escopo (Lei 13.019, Art. 2º, VIII-A — não envolve
repasse). O Fiscal interrompe o processamento antes de chamar o LLM.

---

## 5. Limitações Conhecidas

### 5.1 Limiar único versus piso municipal

O limiar de R$ 600.000,00 é heurística prática. Municípios podem fixar piso próprio
em decreto local (ex.: Caxias do Sul pode ter referência distinta de Porto Alegre).
**TODO:** evoluir para `Map<cityId, threshold>` quando coletarmos decretos por cidade.

### 5.2 Detecção de chamamento via regex

A regex `CHAMAMENTO_RE` reconhece "chamamento público" — variações como
"processo seletivo de OSC" ou "edital de credenciamento" podem escapar e gerar
falso positivo. Calibrar conforme aparecerem casos.

### 5.3 Repasse recorrente depende de `queryAlertsByCnpj`

Em produção, a detecção de Padrão B requer GSI2-cnpj-date populado em
`fiscal-digital-alerts-prod`. Sem o injetável, o Padrão B não é detectado
(não gera erro — apenas não detecta).

### 5.4 Calamidade pública e urgência (Art. 29)

Dispensa por urgência (Art. 29, I — até 180 dias) e calamidade são legalmente
válidas. A regex `DISPENSA_ART29_RE` reconhece menção explícita ao Art. 29 ou
"dispensa de chamamento" — quando o fundamento estiver em outro instrumento
(decreto de calamidade citado por número, sem mencionar Art. 29), pode haver
falso positivo. Threshold de confidence (>= 0.70) e riskScore (>= 60) na
publicação reduz spam.

### 5.5 OSCs credenciadas por lei

Algumas OSCs (Pronon, Pronas/PCD, Sistema S local) podem ser credenciadas por
lei específica e dispensadas de chamamento independentemente do Art. 29/30.
**TODO:** manter denylist de CNPJs com credenciamento legal para suprimir alerta.

---

## 6. Como Reportar Falso Positivo

1. Abra issue em https://github.com/fiscal-digital/fiscal-digital com label
   `falso-positivo`.
2. Inclua:
   - Link para o diário oficial original (Querido Diário)
   - O Finding ID gerado
   - Razão (ex: chamamento ocorrido em diário anterior; inexigibilidade
     fundamentada em decreto de calamidade não citado por número de Art.)
3. O finding será revisado e, se confirmado falso positivo, retratação pública
   no mesmo canal e alcance do alerta original.
