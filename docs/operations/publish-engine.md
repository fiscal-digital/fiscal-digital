# Publicar `@fiscal-digital/engine` em GitHub Packages

Runbook para publicar o pacote npm privado `@fiscal-digital/engine` no GitHub
Packages, e instruções para consumi-lo a partir de outro repo (ex:
`fiscal-digital-collectors`).

## Quando publicar

Publique uma nova versão quando:

- Adicionar feature ao engine que outro repo Fiscal Digital precisará consumir.
- Corrigir bug em código compartilhado (skills, fiscais, regex, tipos).
- Atualizar contrato de tipos exportado em `packages/engine/src/index.ts`.

Não publique a cada commit em `main` — o engine é consumido também dentro
deste mesmo repo via npm workspace (`*`), sem precisar de publicação. A
publicação serve para consumidores externos.

## Como bumpar versão e disparar publicação por tag

A partir da raiz do repo:

```bash
cd packages/engine

# Escolha o bump apropriado:
npm version patch       # 0.1.0 -> 0.1.1 (bug fix)
npm version minor       # 0.1.0 -> 0.2.0 (feature compativel)
npm version major       # 0.1.0 -> 1.0.0 (breaking change)

# `npm version` cria um commit + tag local. Padronize a tag para
# o prefixo `engine-v<version>` (nao conflita com tags de release
# das Lambdas se aparecerem no futuro).
git tag -d v$(node -p "require('./package.json').version")
git tag engine-v$(node -p "require('./package.json').version")

# Push commit + tag:
git push origin HEAD --follow-tags
```

O push da tag `engine-v0.1.1` dispara `.github/workflows/publish-engine.yml`
automaticamente.

> Nota: `npm version` por padrão cria a tag como `v0.1.1`. O workflow só
> reage a tags `engine-v*`. Sempre renomeie a tag conforme o snippet acima
> ou rode `npm --no-git-tag-version version patch` e crie a tag manualmente.

## Como publicar manualmente (sem bump de versão)

Para republicar a versão atual (ex: após corrigir build) ou validar o
workflow sem mexer no git:

1. Abra `Actions > Publish Engine` no GitHub.
2. Clique em `Run workflow`.
3. Selecione branch `main` (ou outra branch para teste).
4. Confirme `Run workflow`.

> Nota: o GitHub Packages **não permite republicar a mesma versão**.
> Se a versão já foi publicada, o workflow falhará em `npm publish` com
> erro 409. Bumpe a versão antes.

## Como consumir o pacote em outro repo

### 1. `.npmrc` no consumer

Crie um `.npmrc` na raiz do repo consumidor:

```ini
@fiscal-digital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Esse arquivo **deve ser commitado** — não contém token, só usa a variável
de ambiente. Para autenticação local, ou rode:

```bash
gh auth setup-git
# ou explicitamente:
npm login --scope=@fiscal-digital --registry=https://npm.pkg.github.com
# username: seu user GitHub
# password: PAT com escopo `read:packages`
# email: seu email
```

### 2. `package.json` do consumer

```json
{
  "dependencies": {
    "@fiscal-digital/engine": "^0.1.0"
  }
}
```

### 3. CI do consumer

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: '24'
    registry-url: 'https://npm.pkg.github.com'
    scope: '@fiscal-digital'
    cache: 'npm'

- run: npm ci
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`secrets.GITHUB_TOKEN` é gerenciado automaticamente pelo Actions runner;
não precisa criar PAT. O token tem escopo `read:packages` por padrão se
o workflow tiver `permissions: packages: read`.

## Rollback

GitHub Packages permite `unpublish` apenas dentro de **30 dias** da publicação
e apenas para a versão exata:

```bash
npm unpublish @fiscal-digital/engine@0.1.1 \
  --registry=https://npm.pkg.github.com
```

Token: PAT com escopo `delete:packages`. Após 30 dias, a versão fica
imutável — o caminho é publicar `0.1.2` corrigindo o problema.

Para "deprecar" uma versão (sem unpublish):

```bash
npm deprecate @fiscal-digital/engine@0.1.1 "Use 0.1.2 — bug crítico em X" \
  --registry=https://npm.pkg.github.com
```

## Troubleshooting

| Erro | Causa provável | Resolução |
|---|---|---|
| `401 Unauthorized` no `npm publish` | `GITHUB_TOKEN` sem `packages:write` | Confirmar `permissions: packages: write` no workflow |
| `404 Not Found` no `npm publish` | Scope errado ou repo errado em `repository.url` | Confirmar `package.json` tem `repository.url` apontando para `fiscal-digital/fiscal-digital` |
| `403 Forbidden` no `npm publish` | Tarball excede 1 GB (improvável aqui) | `npm pack --dry-run` para inspecionar tamanho |
| `409 Conflict — Cannot publish over existing version` | Tentativa de republicar mesma versão | Bumpe a versão (`npm version patch`) |
| `npm ci` falha no consumer com `404` | `.npmrc` ausente ou `NODE_AUTH_TOKEN` não configurado | Verificar `.npmrc` no repo + `env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` no step |
| `Module @fiscal-digital/engine has no exported member X` | Consumer está usando versão antiga | `npm update @fiscal-digital/engine` ou bumpar versão em `package.json` |

## Conteúdo do tarball

O pacote publicado contém:

- `dist/**/*.js` e `dist/**/*.d.ts` — código compilado + tipos
- `dist/brand/{glossary.json, voice-tone.md, colors.json}` — brand pack
  sincronizado de `fiscal-digital-web` em build-time
- `dist/legal-corpus/**` — base local de textos legais (`.md` + `.json`)
  lidos em runtime via `readFileSync` por `lookup()` e `validateCitation()`
- `dist/fiscais/*.legal.md` — documentos de referência por Fiscal

**Não vai no tarball:** fonte TS (`src/`), tests (`__tests__/`, `*.test.*`),
sourcemaps `.js.map`, scripts de dev, `node_modules/`, configs.

Inspecione com `cd packages/engine && npm pack --dry-run`.
