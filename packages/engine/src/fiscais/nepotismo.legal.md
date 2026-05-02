# Base Legal — Fiscal de Nepotismo

> **Risco reputacional CRÍTICO.** Este Fiscal NUNCA afirma parentesco —
> apenas indica coincidência estatística que recomenda verificação manual.
> Erro publicado = retratação pública obrigatória.

---

## Normas aplicáveis

### STF — Súmula Vinculante 13

> "A nomeação de cônjuge, companheiro ou parente em linha reta, colateral
> ou por afinidade, até o terceiro grau, inclusive, da autoridade
> nomeante ou de servidor da mesma pessoa jurídica investido em cargo
> de direção, chefia ou assessoramento, para o exercício de cargo em
> comissão ou de confiança ou, ainda, de função gratificada na
> administração pública direta e indireta em qualquer dos Poderes da
> União, dos Estados, do Distrito Federal e dos Municípios, compreendido
> o ajuste mediante designações recíprocas, viola a Constituição Federal."

Aprovada pelo STF em 21/08/2008, é vinculante a todos os entes da
federação. Veda nepotismo direto (parente nomeado pela autoridade) e
nepotismo cruzado (designações recíprocas entre autoridades).

### Constituição Federal — Art. 37

> "A administração pública direta e indireta de qualquer dos Poderes
> da União, dos Estados, do Distrito Federal e dos Municípios obedecerá
> aos princípios de **legalidade, impessoalidade, moralidade**,
> publicidade e eficiência [...]"

Nepotismo viola diretamente os princípios da impessoalidade e moralidade.

---

## Padrão detectado no MVP

### `nepotismo_indicio` — coincidência de sobrenome incomum

**Heurística MVP (conservadora):**

1. **Filtro etapa 1:** excerpt deve conter ato de nomeação/designação
   E referência a cargo em comissão (ou função gratificada / DAS / CC).
2. **Extração:** captura nomes completos após verbo `NOMEIA` / `DESIGNA`
   via regex de NLP simples.
3. **Sobrenome final:** extrai último token capitalizado do nome
   (ignora conectivos `da`, `de`, `do`, `dos`, `e`, etc.).
4. **Blocklist top 50 IBGE:** descarta sobrenomes mais comuns do Brasil
   (Silva, Santos, Oliveira, Souza, Pereira, Lima, Costa, ...).
   Coincidência de sobrenomes comuns é estatisticamente esperada e
   NÃO é evidência de parentesco.
5. **Threshold:** ≥ 3 nomeações com mesmo sobrenome incomum em uma
   única gazette. Threshold conservador — duas pessoas com mesmo
   sobrenome ainda é coincidência plausível.
6. **Confidence:** sempre ≥ 0.95 (constraint crítico — abaixo NÃO emite).
   Cap em 0.97 — nunca afirma com certeza absoluta sem fonte oficial.
7. **riskScore:** moderado (50–60). É indício, não acusação.

### Top 50 sobrenomes brasileiros (blocklist)

Hardcoded em `nepotismo.ts` (estatística IBGE):
Silva, Santos, Oliveira, Souza, Pereira, Lima, Costa, Ferreira, Almeida,
Carvalho, Rodrigues, Gomes, Martins, Araújo, Ribeiro, Alves, Barbosa,
Nascimento, Cardoso, Rocha, Dias, Castro, Mendes, Cruz, Reis, Ramos,
Torres, Cavalcanti, Correia, Moreira, Pinto, Freitas, Marques, Borges,
Teixeira, Andrade, Vieira, Monteiro, Cunha, Lopes, Mello, Sales, Macedo,
Vasconcelos, Bezerra, Maia, Aragão, Bastos, Caldeira, Cabral.

---

## Linguagem obrigatória da narrativa

A narrativa **DEVE** usar:

- "Identificamos coincidência de sobrenome incomum"
- "Trata-se de indício que recomenda verificação manual"
- "Sem qualquer afirmação prévia [de parentesco]"

A narrativa **NÃO PODE** conter:

- "É parente de..."
- "É irmão/filho/esposa/cônjuge de..."
- "Nepotismo confirmado/comprovado/configurado"
- Qualquer termo acusatório (fraudou, desviou, corrupção, ilícito)

---

## Exemplos

### Positivo (dispara `nepotismo_indicio`)

```
PORTARIAS DE PESSOAL — Secretaria Municipal de Administração.
NOMEIA Carlos Albuquerque para o cargo em comissão de Chefe de Divisão.
NOMEIA Beatriz Albuquerque para Diretora de Departamento, cargo em comissão.
NOMEIA Roberto Albuquerque para Assessor Especial, cargo em comissão.
```

→ 3 ocorrências do sobrenome "Albuquerque" (fora do top 50 IBGE) em
nomeações para cargos em comissão na mesma gazette → indício.

### Negativo — sobrenome comum (NÃO dispara)

```
NOMEIA Maria da Silva, João Silva, Ana Silva, Pedro Silva e Carla Silva
para cargos em comissão.
```

→ "Silva" é o sobrenome mais comum do Brasil → blocklist → 0 findings.

### Negativo — abaixo do limiar (NÃO dispara)

```
NOMEIA Carlos Albuquerque e Beatriz Albuquerque para cargos em comissão.
```

→ Apenas 2 ocorrências → abaixo do threshold conservador (3) → 0 findings.

### Negativo — cargo efetivo (NÃO dispara)

```
NOMEIA Carlos Albuquerque para cargo efetivo de Analista, conforme
aprovação em concurso público.
```

→ Súmula 13 aplica-se apenas a cargos em comissão / função de confiança /
gratificada. Cargo efetivo provém de concurso → fora de escopo.

---

## Limitações MVP documentadas

1. **Sem fonte oficial de parentesco.** TSE (ficha eleitoral) e Receita
   Federal (CPF + sócios) não estão integrados. Sem cruzamento com base
   oficial, todo finding é INDÍCIO — recomenda verificação manual.

2. **Falsos positivos por homônimos.** Pessoas sem relação familiar
   podem compartilhar sobrenome incomum — especialmente em municípios
   colonizados por imigrantes (RS, SC) onde sobrenomes germânicos /
   italianos são localmente comuns mas raros nacionalmente.

3. **Falsos negativos por sobrenome diferente.** Cônjuge que adota
   sobrenome do esposo / esposa, parentes por afinidade, primos com
   sobrenomes maternos diferentes — todos passam batido.

4. **Threshold por gazette, não cross-gazette.** Padrão detectado
   apenas se 3+ ocorrências aparecem na mesma publicação. Nomeações
   espalhadas em múltiplas gazettes ao longo de meses não consolidam
   no MVP (exigiria schema de personas em DynamoDB).

5. **Sem validação de "alto escalão".** O ideal seria detectar apenas
   sobrenomes que coincidam com o do prefeito, vice ou secretários.
   MVP não tem essa lista — qualquer 3+ ocorrências de sobrenome
   incomum dispara.

---

## Roadmap (pós-MVP)

- **TSE integration:** cruzar nome do nomeado com candidatos
  registrados em campanhas municipais (resgata grau de parentesco
  declarado em ficha eleitoral).
- **CPF + Receita Federal:** se CPF estiver em gazette, consultar
  sócios da empresa familiar (heurística de parentesco indireto).
- **Lista de alto escalão:** seed manual de prefeito + secretários
  de cada cidade — disparar apenas quando sobrenome coincidir com
  alguém da lista.

---

## PR de mudança nesta lógica exige

1. Referência legal (Súmula 13, CF Art. 37, jurisprudência STJ/TCU)
2. Exemplo positivo de gazette
3. Exemplo negativo (falso positivo evitado) — particularmente
   importante neste Fiscal pelo risco reputacional
4. Justificativa quantitativa para qualquer mudança em threshold
   (3 ocorrências, 0.95 confidence, top 50 blocklist)
5. Aprovação explícita de Diego — Fiscal de risco reputacional alto
