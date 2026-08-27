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


## Publicação e validação em produção

O commit `b8055a3` foi enviado ao repositório `isaacmottazt/Ad-fenda` e o deploy correspondente do projeto Vercel `ad-fenda` ficou em estado `READY` com alvo de produção. A URL real `https://ad-fenda.vercel.app/admin.html` serviu a nova sidebar e o dashboard; os indicadores carregaram 15 usuários, 310 músicas e 165 artistas. O console do navegador não apresentou saída de erro durante a validação.


A validação em produção também confirmou o atalho `Ctrl/Cmd + K`: a paleta abriu imediatamente e a busca por `Oceano` encontrou o item do catálogo e o aviso de nova música na área de submissões e avisos.


## Separação de submissões e notificações

Na prévia local, a sidebar passou a mostrar dois destinos independentes: `Submissões` e `Notificações`. A tela de Submissões exibe apenas a fila de músicas, contador de pendências, busca por título/artista/remetente e atualização própria; o histórico de avisos não aparece nessa tela.


## Validação da separação e exclusão

Em produção, a aba `Notificações` ficou independente da aba `Submissões`. O histórico exibiu os avisos reais de nova música e testes anteriores, e cada card passou a apresentar o botão `Apagar`. Nenhuma mensagem foi excluída durante a validação, preservando o histórico existente.


## Login do Admin

A nova tela de login administrativa foi validada localmente em viewport desktop. O modo Entrar exibe a identidade Fenda Admin Console, selo de acesso restrito, campos administrativos e atalho para recuperação de senha. O modo Criar conta foi testado e atualiza o cabeçalho para `Crie seu acesso`, exibindo nome, e-mail, senha e confirmação sem alterar os IDs usados pela autenticação.


## Acesso administrativo e animação

A opção `Criar conta` foi removida do login do Admin, junto com os campos e handlers de cadastro. A tela agora oferece somente login por e-mail e senha, recuperação de senha e Google. O cartão `Ambiente protegido` recebeu flutuação suave, pulso do indicador de segurança, barras com variação de escala e uma linha de brilho que percorre o card. A animação respeita `prefers-reduced-motion`.


## Validação da correção de destinatário específico

Após a atualização da restrição do Supabase, foi repetido o envio real de um aviso para um único usuário selecionado no Admin. O erro `admin_notifications_target_check` não ocorreu: o painel exibiu `Notificação enviada para 1 usuário(s)!` e criou o card com status inicial `dispatching`. A confirmação do status final será consultada no Supabase.
