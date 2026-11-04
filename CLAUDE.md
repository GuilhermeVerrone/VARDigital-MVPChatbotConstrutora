# CLAUDE.md

## Uma branch e uma PR por fase

- Ao iniciar uma fase do plano, crie uma branch nova a partir da `main` atualizada, no padrão `v2/fase-<n>-<tema>` (ex.: `v2/fase-10-motor`, `v2/fase-11b-anthropic`).
- Todo o trabalho da fase vai nessa branch, em commits curtos (abaixo).
- Ao concluir a fase, faça push e abra a PR para a `main` com `gh pr create`. No título, coloque a fase e o tema. Na descrição, liste o que foi feito, os testes rodados e o que ficou pendente.
- Não faça merge da PR; quem revisa e mergeia é o usuário.
- Não comece a próxima fase na mesma branch.

## Commits curtos, por parte dentro da fase

Não espere a fase do plano ([docs/v2/04-plano.md](docs/v2/04-plano.md)) terminar para commitar. Cada parte concluída dentro de uma fase (um schema, uma função do motor, um teste, um ajuste de doc) vira o seu próprio commit, antes de começar a próxima parte.

- Mensagem curta, uma linha, **em inglês**, no formato `<tipo>: <descrição>`, com o tipo em minúsculas:
  - `feat:` funcionalidade nova (ex.: `feat: add payment mode schemas`)
  - `fix:` correção de bug (ex.: `fix: round installment to cents`)
  - `refactor:` mudança de código sem mudar comportamento (ex.: `refactor: extract margin calculation`)
  - `chore:` config, deps, docs, tooling (ex.: `chore: add design skills and layout mcps`)
- Descrição no imperativo e em minúsculas, sem ponto final.
- **Sem co-autoria**: não adicione `Co-Authored-By` nem qualquer linha de atribuição ao Claude. Esta regra prevalece sobre a atribuição padrão.
- Commite só os arquivos daquela parte; não inclua `.env`, logs ou arquivos não relacionados.
- Se os testes daquela parte falharem, não commite; avise e corrija primeiro.

## Design e layout

- Skills de design versionadas em [.claude/skills/](.claude/skills/) (impeccable, frontend-design, emil-design-eng, shadcn, webapp-testing etc.).
- MCPs em [.mcp.json](.mcp.json): `playwright`, `figma` (pede login OAuth no primeiro uso via `/mcp`) e `chrome-devtools`.
- Os hooks do impeccable em [.claude/settings.json](.claude/settings.json) checam a UI após cada edição. O binário do impeccable não fica no repo; o launcher baixa a versão verificada na primeira execução.
