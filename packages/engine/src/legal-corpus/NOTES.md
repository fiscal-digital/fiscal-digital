# legal-corpus

Base local de textos integrais de normas usadas pelos Fiscais. Sincronizada de fontes oficiais (planalto.gov.br, stf.jus.br) via `sync.mjs`.

## Por quê

Permite que o agente cite normas com texto verificado, não inferido. Aplica o Princípio Inegociável "Sempre citar a fonte" ao próprio output.

## Estrutura

```
legal-corpus/
├── NOTES.md              (este arquivo)
├── sync-manifest.json    (URLs canônicas + artigos a extrair)
├── sync.mjs              (script de download + parse + persist)
├── index.ts              (API: lookup, validateCitation)
├── _meta.json            (timestamps + checksums por norma)
└── <norma-slug>/
    ├── _index.json       (mapa: artigo → arquivo)
    └── <art-NN>.md       (texto integral + metadata frontmatter)
```

## Como usar

### Atualizar a base
```bash
node packages/engine/src/legal-corpus/sync.mjs            # todas as normas
node packages/engine/src/legal-corpus/sync.mjs lei-14133  # uma norma
```

### Em código TypeScript
```ts
import { lookup, validateCitation } from './legal-corpus'

const texto = lookup('Lei 14.133/2021, Art. 75, II')
// → { norma, artigo, incisos, texto, urlFonte, syncEm }

const check = validateCitation('Lei 14.133/2021, Art. 75, II — limite R$ 65.492,11')
// → { ok: true, source: { ... } }
```

### Bypass do hook check-legal-citation
Citações verificadas contra esta base ganham bypass automático via marca `[legal-verified: legal-corpus/<norma>/<arquivo>]` injetada pelo `validateCitation`.

## Política de atualização

- Reajustes anuais (decretos de IPCA): rodar sync em janeiro.
- Alteração legislativa: rodar sync quando publicada no DOU.
- Checksum: `_meta.json` registra hash do texto baixado; mudança aciona revisão de prompts/regras que dependem do dispositivo.

## Escopo

Apenas dispositivos efetivamente citados pelos Fiscais (mapeados em `sync-manifest.json`). Quando um Fiscal novo for adicionado, expandir o manifesto + rodar sync.
