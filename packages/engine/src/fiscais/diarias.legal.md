# Base Legal — Fiscal de Diárias

## Normas aplicáveis

### Lei 8.112/90, Art. 58 — Diárias (servidores federais)

Aplicada por analogia em municípios que não possuam regulamentação específica.
Estabelece que diária é compensação por deslocamento em serviço, devendo cobrir
despesas de pousada, alimentação e locomoção urbana.

> "Art. 58. O servidor que, a serviço, afastar-se da sede em caráter eventual ou
> transitório para outro ponto do território nacional ou para o exterior fará jus
> a passagens e diárias destinadas a indenizar as parcelas de despesas extraordinária
> com pousada, alimentação e locomoção urbana, conforme dispuser em regulamento.
>
> § 1º A diária será concedida por dia de afastamento, sendo devida pela metade
> quando o deslocamento não exigir pernoite fora da sede, ou quando a União
> custear, por meio diverso, as despesas extraordinárias cobertas por diárias.
>
> § 2º Nos casos em que o deslocamento da sede constituir exigência permanente
> do cargo, o servidor não fará jus a diárias.
>
> § 3º Também não fará jus a diárias o servidor que se deslocar dentro da mesma
> região metropolitana, aglomeração urbana ou microrregião, constituídas por
> municípios limítrofes e regularmente instituídas, ou em áreas de controle
> integrado mantidas com países limítrofes, cuja jurisdição e competência dos
> órgãos, entidades e servidores brasileiros considera-se estendida, salvo se
> houver pernoite fora da sede, hipóteses em que as diárias pagas serão sempre
> as fixadas para os afastamentos dentro do território nacional."

### Regulamentações municipais

Cada município define seus próprios valores e regras via Decreto Municipal.
Caxias do Sul, Porto Alegre e demais cidades cobertas terão limites distintos.
Quando catalogados, devem alimentar a constante `DIARIA_VALOR_LIMITE` por cidade.

### Princípio: deslocamento exige fato gerador

> Diária é **compensação por deslocamento** — não pode haver concessão sem
> deslocamento efetivo. Pagamento em data não útil (FdS / feriado) sem
> justificativa expressa configura indício de irregularidade.

---

## Filtros de exclusão pré-LLM (ADR-001 — patch 2026-05-10)

Após o patch P0 Diárias (precisão pré-patch 0% sobre n=37 amostras / universo
esgotado), o Fiscal rejeita **antes** de chamar a Camada 2 (Nova Lite) os
seguintes contextos identificados como FP sistemático no
[`fiscal-digital-evaluations/analyses/fiscal-diarias/ADR-001-overmatch.md`](https://github.com/fiscal-digital/fiscal-digital-evaluations/blob/main/analyses/fiscal-diarias/ADR-001-overmatch.md):

| Categoria | Padrão | Exemplo (GS) |
|---|---|---|
| Trigger restrito | Apenas `\bdi[áa]rias?\b` (removido `viagem`/`deslocamento`) | "Boa Viagem" não dispara |
| Advérbio com quebra de linha | `diaria-\nmente` | GS-090 |
| ARP / Pregão para hospedagem | ATA RP, Pregão Eletrônico, hotel, apartamento, pernoite | GS-015, GS-048 |
| Locação de veículo | "locação de veículo", "valor global da diária do contrato" | GS-047 |
| Unidade de medida | `Unid./diária`, `m²/diária` | tarifa unitária |
| Dotação orçamentária | `3.3.90.14`, "crédito suplementar", "dotação orçamentária" | GS-093 |
| Polissemia "diária" | Divisão de Diárias e Passagens, jornada/multa/publicação/circulação/sessões/alimentação diária | C2 novos |

Além disso, exige verbo de autorização explícita (`concede`, `paga`, `autoriza`,
`reembolsa`, `ressarci`, `empenho`) — ato meramente descritivo é rejeitado.

## Padrões detectados no MVP

### 1. Diária em fim de semana / feriado sem justificativa (`diaria_irregular`)

**Heurística:**

- Data extraída do excerpt (regex `DD/MM/YYYY`); fallback para `gazette.date`
- Se data == sábado, domingo ou feriado nacional → indício
- Reduz risco se houver termos como "justificativa", "emergência", "plantão",
  "urgência" ou "inadiável"

**Calendário de feriados nacionais (hardcoded 2024–2028):**

- Confraternização Universal (1º jan)
- Carnaval (segunda + terça — variável)
- Sexta da Paixão (variável)
- Tiradentes (21 abr)
- Dia do Trabalho (1º mai)
- Corpus Christi (variável)
- Independência (7 set)
- N. Sra. Aparecida (12 out)
- Finados (2 nov)
- Proclamação da República (15 nov)
- Consciência Negra (20 nov — Lei 14.759/2023)
- Natal (25 dez)

**riskScore base:** 65 (FdS) / 75 (feriado), composto com fator de ausência de
justificativa (peso 0.4, valor 60) → resultado típico ~62–68.

**Exemplo positivo (dispara):**

```
CONCEDE diária a Maria dos Santos no valor de R$ 400,00 para
deslocamento em 09/05/2026 (sábado) à cidade de Gramado.
```

`2026-05-09` = sábado, sem termos de justificativa → `diaria_irregular`.

**Exemplo negativo (não dispara):**

```
CONCEDE diária a servidor de plantão da Secretaria de Saúde no valor de
R$ 400,00, em regime de plantão emergencial em 09/05/2026.
```

Sábado mas com "plantão emergencial" presente → suprime finding.

---

### 2. Valor acima do limite indiciário (`diaria_irregular`)

**Heurística:** maior valor monetário (R$) extraído do excerpt comparado contra
`DIARIA_VALOR_LIMITE` (atualmente R$ 1.500,00 — indicativo, ajustável por cidade).

**riskScore base:** 60 + fator de excesso percentual → 70+ tipicamente.
Se a data de referência também for FdS/feriado, fator agravante de 80 (peso 0.3).

**Exemplo positivo (dispara):**

```
CONCEDE diária no valor de R$ 2.000,00 para deslocamento em 13/05/2026
a Florianópolis.
```

R$ 2.000 > R$ 1.500 → finding com narrativa de excesso.

**Exemplo negativo (não dispara):**

```
CONCEDE diária no valor de R$ 350,00 para deslocamento em 13/05/2026
a Porto Alegre.
```

Valor abaixo do limite e dia útil → sem finding.

---

## Edge cases conhecidos

1. **Data ausente no excerpt** — fallback para `gazette.date`. Confidence cai para 0.6.
2. **Data ambígua / múltiplas datas** — usamos a primeira data extraída; outras
   ficam como ruído documentado em [`diarias.validation.md`](TODO).
3. **Plantão de FdS legítimo** — termos de justificativa suprimem o finding,
   mas a heurística é simples (pode ter falsos negativos quando justificativa
   é redigida com sinônimos não cobertos).
4. **Reembolso vs. diária** — Lei 8.112/90 distingue diária de ressarcimento de
   passagens; o Fiscal MVP trata ambos de forma uniforme. TODO: separar
   `subtype` quando Nova Lite passar a classificar.
5. **Decreto municipal mais permissivo** — limite indiciário R$ 1.500 pode estar
   abaixo do regulamento local. Por design, o Fiscal apenas sinaliza — verificação
   final cabe ao destinatário do alerta.
6. **Concentração por servidor** (servidor com > N diárias/mês) — listada no
   backlog do Fiscal mas não implementada no MVP. Requer schema de personas em
   DynamoDB (mesmo bloqueio do Fiscal de Pessoal).

---

## Limitações MVP documentadas

1. **Calendário de feriados estaduais e municipais** — apenas feriados nacionais.
   Caxias do Sul (RS) tem 20 de setembro como Revolução Farroupilha; ainda não
   coberto. TODO: tabela paralela `FERIADOS_POR_TERRITORY_ID`.

2. **Análise de destino turístico** — listada no escopo do Fiscal mas não
   implementada (exige catálogo de destinos turísticos vs. cidades-sede de
   atividades governamentais legítimas). MVP foca em data e valor.

3. **Cross-gazette por servidor** — concentração de diárias requer schema de
   personas. Bloqueio compartilhado com FiscalPessoal.

4. **Anos fora de 2024–2028** — calendário hardcoded. Requer atualização anual.
   TODO: gerar dinamicamente a partir da data da Páscoa (algoritmo de Gauss)
   ou migrar para tabela versionada.

---

## PR de mudança nesta lógica exige

1. Referência legal (Lei 8.112/90 ou Decreto Municipal específico)
2. Exemplo de gazette que dispara o alerta
3. Exemplo que NÃO deve disparar (falso positivo evitado)
4. Se alterar `DIARIA_VALOR_LIMITE`: justificativa por cidade ou amostra
5. Se ampliar calendário: tabela completa por ano + fonte oficial (gov.br)
