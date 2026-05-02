# Fiscal de Locação — Documentação Legal

## 1. Base Legal

### Lei 14.133/2021 — Nova Lei de Licitações

**Art. 74, III** — É inexigível a licitação quando inviável a competição, em especial nos
casos de:

> **III** — para a contratação dos seguintes serviços técnicos especializados de natureza
> predominantemente intelectual com profissionais ou empresas de notória especialização,
> vedada a inexigibilidade para serviços de publicidade e divulgação:
>
> [...]
>
> **Art. 74, §5º** — Nas contratações com fundamento no inciso III deste artigo, é
> vedada a subcontratação de empresas ou a atuação de profissionais distintos daqueles
> que tenham justificado a inexigibilidade.

E, especificamente para locação ou aquisição de imóvel:

> **Art. 74, III (consolidado pela jurisprudência TCU/Acórdão 1.800/2018-Plenário)** — A
> contratação direta de locação ou aquisição de imóvel por inexigibilidade exige:
>
> 1. **Justificativa formal da escolha** do imóvel específico (necessidades de instalação
>    e localização que tornem o imóvel singular para a Administração).
> 2. **Avaliação prévia** do valor de mercado (laudo técnico de avaliação imobiliária).
> 3. **Razões da escolha do locador** demonstrando a singularidade da contratação.

> **Atenção:** o Fiscal de Locação é **indiciário**. A simples ausência de menção a
> laudo de avaliação no excerpt do diário oficial não comprova ilegalidade, mas
> caracteriza padrão a investigar — o ato precisa observar Art. 74, III.

---

## 2. Padrão Detectado

### Padrão A — Locação inexigível sem evidência de justificativa/laudo

Inexigibilidade de licitação para locação ou aluguel de imóvel municipal **sem menção
explícita** no excerpt a:

- "laudo de avaliação"
- "valor de mercado"
- "justificativa" (de escolha)
- "razão da escolha" (do locador)

A ausência destes termos no excerpt levanta indício de descumprimento do Art. 74, III.
O excerpt completo do diário ainda pode conter a justificativa em parágrafo não capturado
pela janela de 300 chars — por isso o Fiscal opera em faixa **indiciária** (riskScore
55-70 quando valor é normal; 60-85 quando valor excede piso de referência).

### Padrão B — Locação a empresa do quadro político (futuro)

Conflito de interesse — locação a empresa cuja sociedade inclui agente público da
mesma cidade. **Fora do escopo MVP.** Requer integração com base de declarações de
patrimônio (TSE) e Receita Federal (sócios CNPJ).

---

## 3. Threshold de Valor (heurística)

O Fiscal aplica um piso de referência apenas para calibrar a severidade do alerta —
não há teto legal de locação na Lei 14.133/2021.

| Valor estimado anual | Faixa riskScore | Observação |
|---|---|---|
| ≤ R$ 240.000/ano | 55-70 | Indício leve — ausência de termos de validação |
| > R$ 240.000/ano | 60-85 | Indício relevante — valor + ausência de validação |
| Sem valor extraído | 55-70 | Confidence reduzida (≤ 0.65) |

O piso de R$ 240.000/ano (≈ R$ 20.000/mês) é heurístico. Será calibrado por município
quando coletarmos média de m²/região via cruzamento com IPTU. **Não cruzamos com IPTU
no MVP** — escopo futuro (depende de cidade publicar base IPTU).

Quando o excerpt indica explicitamente periodicidade mensal (ex.: "valor mensal de
R$ X", "R$ X mensais", "R$ X/mês"), o Fiscal estima o valor anual como `mensal × 12`
para comparar contra o piso.

---

## 4. Exemplo que DISPARA o alerta

```
INEXIGIBILIDADE DE LICITAÇÃO n° 008/2026. Objeto: locação de imóvel destinado ao
funcionamento da Secretaria Municipal de Cultura. Valor mensal: R$ 18.000,00.
Locador: Imobiliária Centro LTDA, CNPJ: 12.345.678/0001-90.
Base Legal: Lei 14.133/2021, Art. 74, III.
```

**Por que dispara:** o excerpt cita locação de imóvel por inexigibilidade (Art. 74, III)
mas **não menciona** laudo de avaliação, valor de mercado, justificativa nem razão da
escolha do locador.

**Finding gerado:** `locacao_sem_justificativa`, legalBasis: `"Lei 14.133/2021, Art. 74, III"`.

---

## 5. Exemplo que NÃO DISPARA o alerta

### 5.1. Locação com laudo de avaliação e justificativa

```
INEXIGIBILIDADE DE LICITAÇÃO n° 009/2026. Objeto: locação de imóvel para a Secretaria
Municipal de Saúde. Valor mensal: R$ 12.000,00. Laudo de avaliação prévia anexo.
Justificativa da escolha: única edificação na região com acesso PNE.
Locador: Imobiliária Sul LTDA, CNPJ: 22.333.444/0001-55.
Base Legal: Lei 14.133/2021, Art. 74, III.
```

**Por que NÃO dispara:** o excerpt menciona "laudo de avaliação" e "justificativa da
escolha" — termos exigidos pelo Art. 74, III estão presentes.

### 5.2. Locação que cita "valor de mercado"

```
INEXIGIBILIDADE n° 014/2026. Objeto: locação de imóvel para arquivo central. Valor
mensal: R$ 10.000,00, compatível com valor de mercado da região.
```

**Por que NÃO dispara:** menção a "valor de mercado" indica observância do Art. 74, III.

### 5.3. Locação de equipamento (não é imóvel)

```
CONTRATAÇÃO n° 050/2026. Objeto: locação de equipamentos de informática para nova
unidade escolar.
```

**Por que NÃO dispara:** o filtro etapa 1 exige `locação` + (`imóvel` ou `Art. 74` ou
`inexigibilidade...locação`). Locação de equipamento sem qualquer destes termos é
ignorada.

---

## 6. Limitações Conhecidas

### 6.1. Janela do excerpt (300 chars)

O excerpt é uma janela de aproximadamente 300 caracteres do diário oficial. A
justificativa formal pode estar em parágrafo subsequente não capturado, gerando
falso positivo. **Mitigação:** faixa indiciária (riskScore 55-70) e confidence
≤ 0.85, indicando ao revisor humano que o ato precisa de verificação.

**TODO:** ampliar janela do collector para incluir N parágrafos após termo-chave de
locação.

### 6.2. Sem cruzamento com IPTU (MVP)

O piso de R$ 240.000/ano é heurístico — não há comparação com média de m²/região.
**TODO:** integrar com base IPTU municipal quando disponível (Caxias do Sul tem IPTU
aberto? a verificar). Skill futura: `lookup_imovel_iptu`.

### 6.3. Conflito de interesse (sócio = agente público)

Detecção de locação a empresa cujo sócio é agente público da mesma cidade requer
integração com base TSE (declaração de bens) e Receita Federal (quadro societário).
**Fora do MVP.**

### 6.4. Locação por dispensa (Art. 75 vs Art. 74)

A locação tipicamente segue Art. 74, III (inexigibilidade). Locações por dispensa
emergencial (Art. 75, VIII) ou outros incisos do Art. 75 não são detectadas por este
Fiscal — caem no `FiscalLicitacoes`. **Esperado:** sem sobreposição, pois o filtro
exige termo `locação` + contexto de imóvel.

### 6.5. Subcontratação e renovação tácita

O Art. 74, §5º veda subcontratação. A detecção de subcontratação tácita exige
histórico de aditivos com mudança de locador — **TODO:** cobertura via `FiscalContratos`
quando lookup histórico de locações estiver completo.

---

## 7. Como Reportar Falso Positivo

1. Abra uma issue em https://github.com/fiscal-digital/fiscal-digital com label
   `falso-positivo`.
2. Inclua:
   - Link para o diário oficial original (Querido Diário)
   - O Finding ID gerado
   - Razão pela qual o alerta é incorreto (ex: justificativa em parágrafo
     subsequente, laudo anexo não citado no excerpt)
3. O finding será revisado, e se confirmado falso positivo, uma correção será
   publicada no mesmo canal com o mesmo alcance do alerta original (política de
   retratação pública — ver `CLAUDE.md`, seção "Governança Open Source").
