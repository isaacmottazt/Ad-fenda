# Especificação do redesign do painel Admin

## Direção visual

O painel passará de uma interface mobile-first com navegação inferior para um **workspace administrativo responsivo**, com sidebar persistente em telas largas e drawer recolhível no celular. A linguagem será escura, editorial e musical, usando azul-noite quase preto, superfícies grafite azuladas, lavanda elétrica como cor de ação e ciano suave para estados de saúde e atividade. A interface terá camadas de profundidade com gradientes discretos, bordas suaves e sombras amplas, evitando excesso de roxo saturado e reduzindo a sensação de cartões soltos.

A tipografia será hierárquica: títulos fortes e compactos, metadados menores com alto contraste e números de métricas em destaque. O movimento será curto e funcional, com transições de 160–220 ms, feedback imediato em botões, skeletons de carregamento e respeito a `prefers-reduced-motion`.

## Arquitetura de informação

| Área | Função | Atalho |
|---|---|---|
| Visão geral | Resumo operacional, pendências, atividade recente e ações rápidas | `G` e `H` |
| Usuários | Lista, busca, exclusão e visão rápida de cadastro | `U` |
| Privacidade | Consentimentos e dados autorizados, com busca e detalhes protegidos | `P` |
| Catálogo | Músicas, busca, filtro por gênero/estilo e ações de edição | `M` |
| Artistas | Artistas cadastrados, busca e manutenção | `A` |
| Submissões | Fila de músicas enviadas por usuários, aprovação e recusa | `S` |
| Notificações | Histórico de comunicados, filtro por tipo/status e novo envio | `N` |
| Podcasts | Biblioteca, upload, edição e remoção | `O` |

A página inicial será uma nova aba de visão geral que não substitui nenhuma função existente. Ela reunirá métricas carregadas dos mesmos dados já consultados pelo Admin: total de usuários, total de músicas, artistas, podcasts, notificações recentes e submissões pendentes. Os valores serão apresentados como indicadores operacionais, não como dados inventados ou estimativas.

## Interações planejadas

O cabeçalho terá busca global acionável por `Ctrl/Cmd + K`, permitindo localizar rapidamente músicas, artistas, usuários e navegar para módulos. A busca não criará uma nova fonte de dados: ela usará os arrays carregados pelos módulos e mostrará atalhos de navegação quando não houver correspondência.

Cada módulo terá toolbar própria com busca local, filtros contextuais, contador, botão de atualização e ação principal. A lista de músicas ganhará visualização compacta e cards com capa, gênero, estilo, BPM e status de análise. Notificações terão filtros por tipo e status, além de um botão de detalhes em drawer/modal em vez do alerta simples atual.

O painel terá atalhos de criação no dashboard, navegação por teclado, item ativo persistido na URL/hash e último módulo salvo em `localStorage`. A área de sessões e estados vazios exibirá instruções claras. Operações destrutivas continuarão exigindo confirmação explícita.

## Guardrails de implementação

A alteração ficará concentrada no repositório `Ad-fenda`. Os IDs usados pelos scripts atuais, como `usersList`, `musicsList`, `messagesList`, `subsList`, `privacyList`, `podcastsList`, `genericModal` e os botões de criação, serão preservados ou receberão aliases compatíveis. O fluxo de Supabase, autorização administrativa, upload, catalogação, submissões e notificações não será reescrito sem necessidade.

O redesign será implementado primeiro em `admin.html`, criando classes e containers de layout; em seguida serão adicionados pequenos hooks em `admin.js` para dashboard, busca global, filtros e navegação. Os módulos existentes continuarão responsáveis pelos dados e pelas ações específicas. Após a implementação serão executados `node --check`, `git diff --check` e validação visual em produção após deploy.


## Validação visual local

A prévia local carregou a nova sidebar persistente, o dashboard com métricas reais de usuários, músicas e artistas, cards de atividade, fila de revisão e atalhos rápidos. A busca global abriu uma paleta central com ações de adicionar música, enviar aviso e navegação para todas as áreas. O layout foi validado no viewport desktop do navegador; a CSS inclui breakpoint para drawer lateral e sheet de modal no celular.


A busca global também foi testada com o termo `Oceano`: a paleta localizou a faixa no catálogo e, ao selecionar o resultado, fechou a paleta, atualizou o hash para `#musics` e abriu a seção Músicas com a busca e os cards carregados.


No modal de avisos, o template `Nova música disponível` foi selecionado e os campos `Oceano` e `Djavan` foram preenchidos. O corpo atualizou automaticamente para `Olá {user_name}! Uma nova música chegou: Oceano de Djavan`, sem envio real. Isso remove a etapa confusa de digitar manualmente o corpo obrigatório.
