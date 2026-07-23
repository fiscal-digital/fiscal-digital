<!-- legal-verified: template com placeholders — não cita lei real; o campo "Defensibilidade legal" abaixo é preenchido por Fiscal com fonte do legal-corpus na avaliação real -->

# `<fiscal-id>` — Ficha de Avaliação (`.eval.md`)

> **Template (EVO-004).** Copie para `docs/fiscais/<fiscal-id>.eval.md` (ex.:
> `fiscal-licitacoes.eval.md`) e preencha. Uma ficha por Fiscal, atualizada a
> cada ciclo de avaliação.
>
> **Fonte da metodologia:** as 5 dimensões abaixo seguem a
> [METHODOLOGY.md do `fiscal-digital-evaluations`](https://github.com/fiscal-digital/fiscal-digital-evaluations/blob/main/METHODOLOGY.md).
> O golden set rotulado e os baselines numéricos vivem lá; esta ficha é o
> **resumo por Fiscal no repo da engine**, ligando código ↔ avaliação.
>
> **Só amostras reais** (findings que dispararam em `alerts-prod` sobre diários
> oficiais reais). Sem casos sintéticos — evita viés de criador.

---

## Cabeçalho

| Campo | Valor |
|---|---|
| **Fiscal** | `<fiscal-id>` (ex.: `fiscal-licitacoes`) |
| **Tipos emitidos** | `<type_1>`, `<type_2>` (ver `FindingType` em `@fiscal-digital/contracts`) |
| **Arquivo do código** | `packages/engine/src/fiscais/<arquivo>.ts` |
| **Versão da engine avaliada** | `vX.Y.Z` |
| **Ciclo / data** | `Ciclo N — AAAA-MM-DD` |
| **Amostra (n)** | `N findings` (fonte: `alerts-prod`) |
| **Status SSM** | `ligado` / `desligado` (threshold de publicação) |

---

## 1. Precisão

> % de findings publicados que são TP. Amostragem manual sobre `alerts-prod`.
> **Piso alvo do projeto: ≥ 85%** (e o gate operacional ≥ 5 TP / ≤ 1 FP na janela).

| Métrica | Valor |
|---|---|
| TP | `—` |
| FP | `—` |
| Borderline | `—` |
| **Precisão** (TP / (TP+FP)) | `—%` |
| Atinge o piso? | `sim / não` |

**Padrões de FP identificados:** _(liste; cada um deve virar filtro/ADR)_
- `—`

---

## 2. Recall

> % de irregularidades reais detectadas. Amostragem de gazettes históricas com
> casos conhecidos. Fiscais sem findings em prod entram como **gap de recall**
> (ver `GAP_REPORT.md` do evaluations), não como FN sintéticos.

| Métrica | Valor |
|---|---|
| Casos conhecidos na amostra | `—` |
| Detectados | `—` |
| **Recall** estimado | `—%` |
| Gap de detecção conhecido? | `descreva ou "nenhum"` |

---

## 3. Calibração de score

> `riskScore` reflete a probabilidade real? Histograma de findings por bucket.
> Um Fiscal bem calibrado tem TP concentrados no topo e FP na base.

| Bucket de `riskScore` | # findings | % TP no bucket |
|---|---|---|
| 90–100 | `—` | `—%` |
| 75–89 | `—` | `—%` |
| 60–74 | `—` | `—%` |
| < 60 (não publica) | `—` | `—%` |

**Threshold de publicação (SSM):** risco ≥ `—`, confiança ≥ `—`.
**Leitura:** _(o score separa TP de FP? há inversão? sugestão de recalibração?)_

---

## 4. Robustez de evidência

> Citação correta da fonte, sem misattribution. Auditoria de
> `evidence[0].source` vs conteúdo do `excerpt`.

| Verificação | Resultado |
|---|---|
| `evidence[0].source` é URL válida do Querido Diário | `—` |
| O `excerpt` corresponde ao que o finding afirma | `—` |
| Findings sem fonte estável (não deveriam existir — TEC-ANL-001) | `—` |
| Link do finding abre o diário correto | `—` |

**Achados:** `—`

---

## 5. Defensibilidade legal

> Base jurídica sólida, artigo correto. Revisão de `legalBasis` vs texto da lei
> real. **Toda citação deve mapear para o `legal-corpus`** — nunca afirmar
> artigo/inciso sem ter lido a fonte (ver "Citação jurídica" no CLAUDE.md).

| Verificação | Resultado |
|---|---|
| `legalBasis` cita lei + artigo existentes | `—` |
| O artigo citado de fato fundamenta o tipo de achado | `—` |
| Exceções legais tratadas (o Fiscal não acusa o que a lei permite) | `—` |
| Fonte no `legal-corpus` | `packages/engine/src/legal-corpus/<...>` |

**Achados:** `—`

---

## Veredito do ciclo

| | |
|---|---|
| **Recomendação SSM** | `manter ligado / desligar / reativar após fix` |
| **Bloqueios para reativação** | `IDs de card / ADR` |
| **ADRs abertos por este ciclo** | `analyses/<fiscal>/ADR-NNN-*.md` |
| **Próxima reavaliação** | `AAAA-MM-DD ou condição` |
