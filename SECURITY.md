# Política de Segurança — Fiscal Digital

## Reportar uma vulnerabilidade

**Não abra uma Issue pública para vulnerabilidades de segurança.**

Envie um email para: lineu@fiscaldigital.org

Inclua:
- Descrição da vulnerabilidade
- Passos para reproduzir
- Impacto potencial
- Versão/componente afetado

Respondemos em até 72 horas. Após análise e correção, publicamos um advisory público.

## Escopo

Este projeto processa **dados públicos** e não armazena dados pessoais de cidadãos.
O escopo de segurança inclui:

- Injeção via dados do Querido Diário (prompt injection no LLM)
- Acesso não autorizado aos secrets AWS
- Publicação de alertas falsos por manipulação do pipeline
- Exposição de credenciais de API

## O que não está no escopo

- Vulnerabilidades em serviços de terceiros (AWS, Anthropic, X, Reddit)
- Issues de performance sem impacto de segurança
