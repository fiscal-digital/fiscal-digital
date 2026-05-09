# Backlog de Fiscais — Refinamento e Roadmap

> Status canônico de cada Fiscal: existente, em desenvolvimento, planejado.
> Toda mudança passa por [GOVERNANCA.md](GOVERNANCA.md) — 4 etapas obrigatórias.

---

## Fiscais em Produção (10 ativos)

### 1. FiscalLicitacoes — `fiscal-licitacoes`
- **Status:** ✅ em prod, calibrado 2026-05-02
- **Detecta:**
  - `dispensa_irregular`: valor > teto Lei 14.133/2021 Art. 75 I/II
  - `fracionamento`: múltiplas dispensas mesmo CNPJ ultrapassando teto
- **Base legal:** Lei 14.133/2021, Art. 75 + §1º
- **Próximas calibrações:**
  - Inexigibilidade Art. 74 (sub-tipo distinto, fora de escopo MVP)
  - Edge: dispensa com valor "estimado" vs "homologado"

### 2. FiscalContratos — `fiscal-contratos`
- **Status:** ✅ em prod
- **Detecta:**
  - `aditivo_abusivo`: > 25% do valor original (50% para reformas)
  - `prorrogacao_excessiva`: > 10 anos vigência total (Art. 107)
- **Base legal:** Lei 14.133/2021, Art. 125 §1º + Art. 107
- **Pendências:**
  - Validação de prorrogação requer histórico do contrato original (depende de MIT-02 suppliers schema)
  - Reforma vs obra normal: classificação via `subtype` extraído pela Nova Lite

### 3. FiscalFornecedores — `fiscal-fornecedores`
- **Status:** ✅ em prod, calibrado 2026-05-02 (threshold 12 meses + situação irregular + sancionado CGU)
- **Detecta:**
  - `cnpj_jovem`: empresa < 12 meses no momento do contrato
  - `concentracao_fornecedor`: > 40% dos contratos de uma secretaria com mesmo CNPJ
  - `cnpj_situacao_irregular`: situação cadastral suspensa/inapta/baixada/nula (RFB)
  - `fornecedor_sancionado`: empresa em CEIS/CNEP da CGU
- **Base legal:** Lei 14.133/2021 Art. 14 + decretos CGU
- **Skills:** validateCNPJ (BrasilAPI) + checkSanctions (CGU CEIS/CNEP)

### 4. FiscalPessoal — `fiscal-pessoal`
- **Status:** ✅ em prod, calibrado 2026-05-02 (threshold per-gazette: 3+ atos em janela eleitoral, 7+ fora)
- **Detecta:**
  - `pico_nomeacoes`: ≥ 3 atos por gazette em janela eleitoral, ≥ 7 fora
  - `rotatividade_anormal`: exoneração+nomeação no mesmo excerpt
- **Base legal:** Lei 9.504/97 (período eleitoral)
- **Pendências:**
  - Cross-gazette: contar atos do mesmo cargo em N dias (depende schema personas)

### 5. FiscalGeral — `fiscal-geral`
- **Status:** ✅ em prod com `consolidarAsync` (cross-gazette)
- **Detecta:**
  - `padrao_recorrente`: ≥ 3 findings mesmo CNPJ em janela 12 meses (`HISTORICO_JANELA_MESES`)
- **Função:** consolida findings dos 4 Fiscais especializados via `queryAlertsByCnpj`

### 6. FiscalConvenios — `fiscal-convenios`
- **Status:** ✅ em prod (entregue 2026-05-02)
- **Detecta:**
  - `convenio_sem_chamamento`: termo de fomento/colaboração sem chamamento público
  - `repasse_recorrente_osc`: repasses sucessivos ao mesmo OSC sem renovação formal
- **Base legal:** Lei 13.019/2014 (Marco Regulatório das OSCs), Decreto 8.726/2016

### 7. FiscalNepotismo — `fiscal-nepotismo`
- **Status:** ✅ em prod, conservador por design (alto risco reputacional)
- **Detecta:**
  - `nepotismo_indicio`: nomeação com sobrenome incomum coincidente + cargo em comissão
- **Base legal:** STF Súmula Vinculante 13, CF Art. 37
- **Notas:**
  - Threshold de confiança alto (>= 0.95) obrigatório
  - Skill `lookup_kinship` (cruzamento TSE/CPF) ainda não integrada — heurística por sobrenome

### 8. FiscalPublicidade — `fiscal-publicidade`
- **Status:** ✅ em prod, calibrado 2026-05-02 (regex expandida)
- **Detecta:**
  - `publicidade_eleitoral`: contratação publicitária na janela vedada (3 meses antes da eleição até 31/12)
- **Base legal:** Lei 9.504/97 Art. 73 VI "b" + VII
- **Janelas hardcoded:** 2024-07-06→2024-12-31, 2026-07-04→2026-12-31, 2028-07-01→2028-12-31

### 9. FiscalLocacao — `fiscal-locacao`
- **Status:** ✅ em prod (entregue 2026-05-02)
- **Detecta:**
  - `locacao_sem_justificativa`: locação inexigível citada sem fundamento
- **Base legal:** Lei 14.133/2021 Art. 74 III
- **Pendências:**
  - Skill `lookup_imovel_iptu` (cruzar com base IPTU) — pendente cidade publicar dado

### 10. FiscalDiarias — `fiscal-diarias`
- **Status:** ✅ em prod, calibrado 2026-05-02 (threshold R$ 800 + feriados nacionais via BrasilAPI)
- **Detecta:**
  - `diaria_irregular`: pagamento em final de semana / feriado sem justificativa
  - Valor > limite legal (R$ 800)
- **Base legal:** Lei 8.112/90 Art. 58 (servidores fed., aplicável análoga municipal)
- **Skills:** BrasilAPI feriados nacionais com cache em memória

---

## Princípios de Refinamento

1. **Etapa 3 obrigatória antes de promote** — toda mudança roda contra Caxias+PA
2. **Versão por mudança comportamental** — novo threshold = nova versão (Phase 3 UH-22)
3. **Documentação dupla por Fiscal:** `<fiscal>.legal.md` (regra) + `<fiscal>.validation.md` (evidências)
4. **Custo zero re-análise** após UH-22 completo: cache + state tracking + reanalyze.mjs

---

## Compatibilidade Futura

- **CNPJ alfanumérico (Lei 14.973/2024 — jul/2026):** TODO em GOVERNANCA.md. Afeta regex CNPJ + validação BrasilAPI em todos os Fiscais que usam CNPJ.
- **Lei 14.133/2021 reajustes anuais:** valores em `legal-constants.ts` já têm TODO de revisão anual via decreto IPCA-E.

---

## Próximos passos (não-Fiscais)

- **Cache S3 PDFs do Querido Diário** — bucket `fiscal-digital-gazettes-cache-prod` + CloudFront `gazettes.fiscaldigital.org`. Resolve PDF inline + resiliência + reprocessamento gratuito.
- **Idempotência de findings** — adicionar dedup no `saveMemory` para evitar duplicates em reanalyze (pattern descoberto 2026-05-02).
- **Lookup de parentesco TSE/CPF** — desbloqueia FiscalNepotismo de heurística para evidência forte.
- **Lookup IPTU** — desbloqueia FiscalLocacao para preço justo de mercado.
