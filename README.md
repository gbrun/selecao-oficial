# Seleção Oficial

Filmes premiados e indicados em Cannes, Veneza, Berlim, Oscar, Globo de Ouro, Sundance e Toronto que estão disponíveis na Netflix, Prime Video, Disney+, HBO Max, Apple TV e Google TV no Brasil.

Um robô roda todo dia às **05:47 (Brasília)** no GitHub Actions. Ele consulta Wikidata, TMDB e OMDb com as suas chaves, que ficam guardadas em Secrets, e publica uma página estática no GitHub Pages. O site é público, mas as chaves não aparecem em lugar nenhum.

## Instalação (uns 10 minutos)

1. **Crie um repositório público** no GitHub, por exemplo `selecao-oficial`, e suba estes arquivos:
   ```bash
   cd selecao-oficial
   git init -b main && git add . && git commit -m "Seleção Oficial"
   git remote add origin git@github.com:SEU-USUARIO/selecao-oficial.git
   git push -u origin main
   ```
2. **Cadastre as chaves**: Settings → Secrets and variables → Actions → *New repository secret*.
   - `TMDB_KEY`: chave v3 ou token de leitura v4 de https://www.themoviedb.org/settings/api
   - `OMDB_KEY`: chave de https://www.omdbapi.com/apikey.aspx (opcional; sem ela, aparece a nota do TMDB)
3. **Ative o Pages**: Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
4. **Permita que o robô faça commit**: Settings → Actions → General → *Workflow permissions* → **Read and write permissions**.
5. **Rode a primeira vez**: aba Actions → *Atualizar catálogo* → **Run workflow**. A primeira coleta leva de 10 a 20 minutos.
6. O site fica em `https://SEU-USUARIO.github.io/selecao-oficial/`.

## Como funciona

| Etapa | Fonte | Observação |
|---|---|---|
| Prêmios e indicações, título em inglês, diretores, ID da Netflix | Wikidata | Consultas pequenas, por prêmio. Se falhar, usa a cópia do dia anterior (`data/wikidata.json`). |
| Streaming no Brasil, capa, sinopse em português, gênero | TMDB (dados da JustWatch) | Todos os filmes, todo dia. |
| Filmografia dos 100 diretores com mais prêmios | TMDB | Inclui filmes fora de festivais. |
| IMDb e Rotten Tomatoes | OMDb | Até 950 consultas por dia: primeiro os filmes sem nota, depois as notas com mais de 30 dias. O catálogo completo leva alguns dias para ter todas as notas. |

Travas de segurança: se a coleta trouxer menos da metade dos filmes do dia anterior, o robô para e mantém o site como estava.

## Ajustes

- **Horário**: altere o `cron` em `.github/workflows/atualizar.yml` (o horário é em UTC; Brasília = UTC−3).
- **Quantidade de diretores**: variável `TOP_DIRECTORS` no passo "Coletar" do workflow.
- **Rodar localmente**: `TMDB_KEY=... OMDB_KEY=... node scripts/build.mjs`, depois sirva a pasta `public/` (por exemplo, `npx serve public`).

## Limitações

- Só a Netflix abre o filme direto, quando o Wikidata tem o ID dele. Os outros serviços abrem a busca já com o título brasileiro.
- A cobertura de prêmios depende do Wikidata: Oscar e Cannes são bem documentados, as seleções sem prêmio nem sempre.
- Em repositório público, o GitHub desativa agendamentos depois de 60 dias sem atividade. O commit diário dos dados conta como atividade. Se o site parar de atualizar, confira a aba Actions.
