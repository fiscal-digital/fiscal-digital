# Base Legal — Fiscal de Publicidade

## Normas aplicáveis

### Lei das Eleições — Lei 9.504/97, Art. 73, VI, "b"

Veda a publicidade institucional dos atos, programas, obras, serviços e
campanhas dos órgãos públicos federais, estaduais ou municipais nos 3 (três)
meses que antecedem o pleito.

> "Art. 73. São proibidas aos agentes públicos, servidores ou não, as seguintes
> condutas tendentes a afetar a igualdade de oportunidades entre candidatos nos
> pleitos eleitorais:
>
> VI — nos três meses que antecedem o pleito:
>
> b) com exceção da propaganda de produtos e serviços que tenham concorrência
> no mercado, autorizar publicidade institucional dos atos, programas, obras,
> serviços e campanhas dos órgãos públicos federais, estaduais ou municipais,
> ou das respectivas entidades da administração indireta, salvo em caso de
> grave e urgente necessidade pública, assim reconhecida pela Justiça Eleitoral."

### Lei das Eleições — Lei 9.504/97, Art. 73, VII

Veda o uso promocional em favor de candidato, partido político ou coligação,
de distribuição gratuita de bens e serviços de caráter social custeados pelo
poder público — inclui inserções pagas em mídia que mencionem nome do alcaide
ou candidato.

> "VII — realizar, no primeiro semestre do ano de eleição, despesas com
> publicidade dos órgãos públicos federais, estaduais ou municipais, ou das
> respectivas entidades da administração indireta, que excedam a média dos
> gastos no primeiro semestre dos três últimos anos que antecedem o pleito."

(Art. 73, V, sobre nomeação no período eleitoral, é tratado pelo
**Fiscal de Pessoal** — não é escopo deste Fiscal.)

---

## Padrão detectado no MVP

### `publicidade_eleitoral`

**Heurística (4 etapas):**

1. **Filtro regex** — excerpt contém termo de publicidade institucional,
   propaganda, divulgação, inserção, mídia, anúncio ou veiculação.
2. **Filtro temporal** — gazette dentro da janela vedada
   (3 meses antes da eleição até 31/12 do ano eleitoral).
3. **Filtro de contratação** — excerpt contém termo de contratação onerosa
   (contrato, empenho, dispensa, inexigibilidade, pagamento, despesa).
4. **Extração de valor** — usa o maior valor (`R$ X`) mencionado no excerpt.
   Se ausente, finding ainda é emitido com `confidence` reduzida.

**riskScore esperado:** 75–95 (alta gravidade — vedação absoluta no período).

**confidence:**
- `0.80` quando valor monetário foi identificado no excerpt.
- `0.72` quando valor não foi identificado (ainda dispara — vedação é absoluta).

### Janelas vedadas hardcoded (eleições municipais — outubro de anos pares)

| Eleição | Início janela | Fim janela |
|---|---|---|
| 06/10/2024 | 06/07/2024 | 31/12/2024 |
| 04/10/2026 | 04/07/2026 | 31/12/2026 |
| 01/10/2028 | 01/07/2028 | 31/12/2028 |

O fim em 31/12 cobre 2º turno (final de outubro) e período de transição
até a posse em 1º de janeiro do ano seguinte.

### Threshold de valor

`VALOR_MINIMO_PUBLICIDADE = R$ 1,00` — efetivamente "qualquer contratação
onerosa". Calibração intencional: a vedação é absoluta dentro da janela
(salvo grave e urgente necessidade pública autorizada pela Justiça Eleitoral,
que não é detectável por regex).

A defesa contra falsos positivos recai no filtro `CONTRATACAO_RE`
(exige termo de contratação) e no filtro temporal (janela vedada),
não no valor.

### Agravante: menção ao alcaide / prefeito

Quando o excerpt menciona "prefeito", "prefeita", "alcaide" ou "gestão
municipal", o `legalBasis` inclui também o inciso VII (uso promocional em
favor de candidato), e a narrativa registra o detalhe — sinaliza investigação
de autopromoção.

---

## Exemplo positivo (dispara)

```
EXTRATO DE CONTRATO n° 145/2026. Objeto: contratação de serviços de publicidade
institucional para divulgação de atos do governo municipal.
Contratada: Agência Mídia Brasil LTDA, CNPJ: 11.222.333/0001-44.
Valor: R$ 850.000,00. Secretaria Municipal de Comunicação.
```

Data da gazette: 15/08/2026 (dentro da janela vedada 04/07/2026 – 31/12/2026)
→ `publicidade_eleitoral` com riskScore ~85.

## Exemplo positivo (com agravante)

```
CONTRATO de inserção publicitária em mídia televisiva e digital, com veiculação
de propaganda institucional sobre as obras da gestão do Prefeito Municipal.
Empenho: R$ 320.000,00.
```

Data: 10/09/2024 → janela vedada 2024 + menção ao prefeito → `publicidade_eleitoral`
com `legalBasis: 'Lei 9.504/97, Art. 73, VI, "b" e VII'`.

## Exemplo negativo (não dispara — fora da janela)

```
EXTRATO DE CONTRATO. Objeto: serviços de publicidade institucional
para campanha de saúde pública. Valor: R$ 200.000,00.
```

Data: 12/03/2026 (fora da janela vedada — antes de 04/07/2026)
→ sem finding. Publicidade institucional fora do período eleitoral é permitida.

## Exemplo negativo (não dispara — sem contratação)

```
O Secretário Municipal participou de evento sobre publicidade institucional
e divulgação de boas práticas de comunicação pública na região serrana.
```

Data: 20/08/2026 (dentro da janela) mas sem termo de contratação onerosa
→ filtro etapa 3 descarta. Reduz falso positivo de menções incidentais.

---

## Limitações MVP documentadas

1. **Exceção de "grave e urgente necessidade pública"** — Lei 9.504/97 Art. 73
   VI permite publicidade em janela vedada quando a Justiça Eleitoral autoriza.
   Detecção textual dessa autorização não está implementada (exigiria
   Nova Lite + busca cross-document). Falso positivo possível neste caso.

2. **Comparação com média dos 3 últimos anos (Art. 73, VII, parte 2)** —
   exige histórico anual de gastos publicitários por município, não disponível
   no MVP. Não detectamos excesso sobre média histórica — apenas vedação
   por janela.

3. **Janelas hardcoded** — parametrizar via config quando cobrir eleições
   estaduais (anos ímpares), eleições gerais, ou outros municípios fora do RS.

4. **Mídia paga vs gratuita** — não distinguimos veiculação paga de matéria
   editorial. Heurística atual exige termo de contratação onerosa
   (`CONTRATACAO_RE`) para mitigar.

5. **Valor por excerpt vs valor por contrato** — quando o excerpt cita
   múltiplos valores, usamos o maior. Não é o valor empenhado real do
   contrato — apenas indicador para riskScore.

---

## PR de mudança nesta lógica exige

1. Referência legal (lei + artigo) para o novo padrão
2. Exemplo de gazette que dispara o alerta
3. Exemplo que NÃO deve disparar (falso positivo evitado)
4. Se alterar limiares: justificativa quantitativa (ex: análise de amostra de gazettes)
5. Se alterar janelas: confirmação com calendário oficial do TSE
