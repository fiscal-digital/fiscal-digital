# Backlog de Fiscais — Refinamento e Roadmap

> Status canônico de cada Fiscal: existente, em desenvolvimento, planejado.
> Toda mudança passa por [GOVERNANCA.md](GOVERNANCA.md) — 4 etapas obrigatórias.

---

## Fiscais Existentes (Sprint 1-2)

### 1. FiscalLicitacoes — `fiscal-licitacoes`
- **Status:** ✅ em prod, bug fixed em 2026-05-02 (NULL cnpj GSI)
- **Detecta:**
  - Dispensa irregular: valor > teto Lei 14.133/2021 Art. 75 I/II
  - Fracionamento: múltiplas dispensas mesmo CNPJ ultrapassando teto
- **Base legal:** Lei 14.133/2021, Art. 75 + §1º
- **Findings hist.:** 4 (Caxias SMED + Curitiba SGM)
- **Próximas calibrações:**
  - Threshold de fracionamento (12 meses, mesmo CNPJ + secretaria)
  - Edge: dispensa com valor "estimado" vs "homologado"
  - Inexigibilidade Art. 74 (fora de escopo MVP, sub-tipo distinto)

### 2. FiscalContratos — `fiscal-contratos`
- **Status:** ✅ em prod, bug fixed em 2026-05-02 (NULL cnpj GSI)
- **Detecta:**
  - Aditivo abusivo: > 25% do valor original (50% para reformas)
  - Prorrogação excessiva: > 10 anos vigência total (Art. 107)
- **Base legal:** Lei 14.133/2021, Art. 125 §1º + Art. 107
- **Findings hist.:** 0 (após fix, ainda re-analisar histórico)
- **Pendências:**
  - Validação de prorrogação requer histórico do contrato original (depende de MIT-02 suppliers schema)
  - Reforma vs obra normal: classificação via `subtype` extraído pela Nova Lite

### 3. FiscalFornecedores — `fiscal-fornecedores`
- **Status:** ⚠️ em prod com throttling (3% Bedrock errors), Etapa 2-3 pendentes
- **Detecta:**
  - CNPJ jovem: empresa < 6 meses no momento do contrato
  - Concentração: > 40% dos contratos de uma secretaria com mesmo CNPJ
- **Base legal:** indícios — Lei 14.133/2021 não proíbe explicitamente, mas justifica investigação
- **Findings hist.:** 0
- **Pendências:**
  - Throttle Bedrock: adicionar retry-with-backoff em `extract_entities.ts`
  - validateCNPJ via BrasilAPI (skill já existe; integração com Fiscal não confirmada)
  - check_sanctions CGU CEIS/CNEP (skill existe; integração pendente)

### 4. FiscalPessoal — `fiscal-pessoal`
- **Status:** ⚠️ código OK (12 unit tests passando) mas **threshold alto demais → nunca dispara**
- **Detecta:**
  - Pico de nomeações: ≥ **5 atos por excerpt** em janela eleitoral, ≥ **10 fora**
  - Rotatividade: exoneração+nomeação no mesmo excerpt
- **Auditoria 2026-05-02:**
  - Excerpts são windows de 300 chars — raramente cabem 5 nomeações
  - Probabilidade de trigger ≈ 0% em prática
  - Janela eleitoral 2024 já passou; 2026 começa jul/2026
- **Calibração proposta (UH-23):**
  - Mudar de "atos por excerpt" para "atos por gazette" (somar todos os excerpts)
  - Limiar 3+ atos por gazette em janela eleitoral
  - Cross-gazette: contar atos do mesmo cargo em N dias
- **Bloqueio:** schema de personas em DynamoDB (não implementado) para cross-gazette

### 5. FiscalGeral — `fiscal-geral`
- **Status:** ⚠️ design gap — funciona em isolamento mas **nunca dispara em prod**
- **Função:**
  - Consolida findings dos 4 Fiscais especializados (mesmo gazette)
  - Detecta `padrao_recorrente`: ≥ 3 findings mesmo CNPJ → meta-finding riskScore 90+
- **Auditoria 2026-05-02:**
  - **Design gap:** `consolidar()` recebe findings de UM gazette, não cross-gazette
  - 1 gazette típica gera 0-2 findings, raramente 3+ no mesmo CNPJ
  - Resultado: meta-finding nunca emite
- **Fix arquitetural proposto (UH-24):**
  - Modo histórico: `consolidar()` chama `queryAlertsByCnpj` para cada CNPJ visto
  - Cross-gazette padrão_recorrente: ≥ 3 findings mesmo CNPJ em janela 12 meses
  - Move parte da lógica para um Lambda periódico (não inline no analyzer)
- **Custo computacional:** baixo (Query GSI por CNPJ é barato)

---

## Fiscais Planejados (Sprint 7+)

### A. FiscalConvenios — `fiscal-convenios`
- **Detectaria:**
  - Convênios > R$ X firmados sem licitação prévia OU procedimento simplificado
  - Repasses recorrentes ao mesmo OSC sem renovação contratual formal
- **Base legal:** Lei 13.019/2014 (Marco Regulatório das OSCs), Decreto 8.726/2016
- **Skills necessárias:** extractEntities (já existe), regex extra para `convênio`/`termo de fomento`
- **Estimativa:** M (1-2 dias)
- **Bloqueia:** UH-22 Phase 2 deployed ✅ (cache + state tracking funciona)

### B. FiscalNepotismo — `fiscal-nepotismo`
- **Detectaria:**
  - Nomeação de cônjuge/parente até 3º grau de servidor já no quadro
  - Cargos em comissão para parentes do alto escalão (alcaide, secretários)
- **Base legal:** STF Súmula Vinculante 13, CF Art. 37
- **Skills necessárias:**
  - extractEntities (já existe) — extrai nome do nomeado
  - **NOVA skill:** `lookup_kinship` — cruzar nome com TSE (ficha eleitoral) ou Receita Federal CPF
- **Bloqueio externo:** acesso a dados de parentesco — possível via TSE; sem TSE = heurística por sobrenome (alta taxa de FP)
- **Estimativa:** L (3-5 dias) — depende de fonte de parentesco
- **Risco:** alto risco reputacional (acusação errada). Threshold de confiança elevado (>= 0.95) obrigatório.

### C. FiscalPublicidade — `fiscal-publicidade`
- **Detectaria:**
  - Gastos de publicidade institucional 3 meses antes de eleição (proibido)
  - Inserções pagas em mídia que mencionem nome do alcaide
- **Base legal:** Lei 9.504/97 Art. 73 (Lei das Eleições)
- **Skills necessárias:**
  - Calendário eleitoral (constante: outubro de cada 2 anos para municipais)
  - extractEntities + regex `publicidade institucional` / `propaganda`
- **Estimativa:** S-M (1-2 dias)
- **Janela ativa:** julho-outubro de anos eleitorais (2026, 2028, 2030...)

### D. FiscalLocacao — `fiscal-locacao`
- **Detectaria:**
  - Locação de imóvel pelo município com valor > 30% acima do m²/região
  - Locação a empresa do quadro (conflito de interesse)
- **Base legal:** Lei 14.133/2021 Art. 74 III (locação inexigível requer justificativa)
- **Skills necessárias:**
  - **NOVA skill:** `lookup_imovel_iptu` — cruzar com base IPTU (se município publicar)
  - extractEntities + regex `locação` / `aluguel` / `m²`
- **Estimativa:** L (5+ dias) — depende de dado IPTU disponível
- **Cidades MVP:** Caxias do Sul tem IPTU aberto? a verificar

### E. FiscalDiarias — `fiscal-diarias`
- **Detectaria:**
  - Pagamento de diárias em finais de semana / feriados sem justificativa
  - Diárias em destinos turísticos > limite legal
  - Servidor com > N diárias/mês
- **Base legal:** Lei 8.112/90 Art. 58 (servidores fed., aplicável análoga municipal)
- **Skills necessárias:**
  - Calendário de feriados nacionais + estaduais
  - extractEntities + regex `diária` / `viagem`
- **Estimativa:** M (2-3 dias)
- **Volume esperado:** alto — Fiscal precisa de threshold rigoroso para evitar spam

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
