Diagnóstico — 2026-08-26

O deployment com commit 5634184 está READY, e o repositório contém o campo "Pesquisar estilo" e o botão "Analisar estilo e ritmo" em admin-music-upload.js, dentro do cartão criado após a seleção do áudio. A tela /admin.html redireciona para index.html quando não há sessão autenticada de administrador, comportamento esperado.

A ficha de edição em admin.js também contém os campos de estilo, ritmo, BPM, energia e dança. Como o usuário confirmou que a ficha aparece, mas os novos controles não aparecem, a hipótese operacional mais provável é cache de scripts locais: admin.html carrega admin.js, admin-music-upload.js e music-analyzer.js sem query string de versão. A correção será adicionar versionamento explícito nos scripts para forçar o navegador/CDN a buscar o código atualizado.
