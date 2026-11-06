# Configuração e publicação

## Banco gratuito

O banco deve ser um projeto Supabase exclusivo da Camizetas, em organização Free e dentro dos limites gratuitos da conta. A organização Pro do Rango não deve receber novos projetos para esta implantação. Não restaurar nem copiar os bancos do Harvian.

O projeto informado é `hbajyggnlsijqrwhsedn`. A conexão administrativa precisa estar autorizada para a organização desse projeto. Um link de projeto não concede acesso por si só.

A URL e a chave publicável do projeto já estão configuradas em `.openai/app-public.json`. A API pública foi consultada: Auth está habilitado e `public.stores` ainda não está disponível.

Para preparar um projeto novo sem depender da conexão administrativa desta conversa, abra o [SQL Editor](https://supabase.com/dashboard/project/hbajyggnlsijqrwhsedn/sql/new), cole todo o conteúdo de [`database/setup.sql`](../database/setup.sql) e execute. Esse arquivo reúne as duas migrações em uma transação, sem apagar dados. Execute uma única vez; tabelas com os mesmos nomes fazem a operação ser revertida.

Antes de aplicar mudanças, listar as tabelas do projeto e confirmar que não há outro aplicativo usando o schema. Aplicar as migrações em ordem:

1. `*_camizetas_commerce.sql`: lojas, produtos, variantes, pedidos, histórico, RLS e RPCs.
2. `*_camizetas_product_images.sql`: bucket de imagens e suas políticas.

Os arquivos foram criados pelo Supabase CLI 2.81.2. Se usar outra versão, descobrir comandos e flags com `--help`, especialmente no CLI v3, que passou a usar o ambiente local por padrão.

Rodar os advisors de segurança após aplicar. Conferir que somente `public` (e schemas padrão autorizados) são expostos pela Data API; o schema `private` não deve ser exposto.

## Autenticação

No Supabase Auth, configurar:

- Site URL: `https://camizetas-primeira-versao.victortb12.chatgpt.site`
- Redirect URLs: a origem acima com `/painel.html`, `/painel.html?recovery=1` e `/loja.html` (quando necessário para confirmação do cadastro no checkout).
- Cadastro por e-mail/senha habilitado.
- Confirmação de e-mail conforme a política da operação; o painel trata confirmação pendente.

Configurar SMTP antes de cadastro em escala: o envio padrão do Supabase tem restrições e limites. Nunca desativar a confirmação só para contornar um erro de teste.

## Chave pública e build

A aplicação usa somente a URL e a chave **publicável**. Obter a chave em Settings → API Keys do projeto. Configurar `.openai/app-public.json` ou `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` no build. O script rejeita `sb_secret_` e JWT com role diferente de `anon`.

```sh
npm ci
npm run check
npm test
npm run build
```

Publicar o conteúdo de `dist/` no Site existente, preservando `.openai/hosting.json` e o acesso público. O backend continua no Supabase, portanto a hospedagem permanece estática. Não é necessário login ChatGPT; as áreas privadas usam Supabase Auth e RLS.

## Teste de aceitação

1. Cadastrar duas contas de lojistas e uma de comprador, com e-mails controlados pelos testadores.
2. Criar e publicar uma loja; cadastrar produto e variações com estoque inicial e foto.
3. Abrir a vitrine sem login e conferir a disponibilidade.
4. Entrar como comprador, enviar um pedido e anotar o número real retornado.
5. Conferir a baixa no estoque e o histórico no painel da loja; a outra loja não deve enxergar o pedido.
6. Avançar Novo → Confirmado → Em separação → Enviado → Concluído, com código de rastreamento quando aplicável.
7. Em outro pedido, cancelar antes do envio e confirmar a reposição uma única vez.
8. Repetir um envio de checkout com a mesma chave de idempotência e confirmar que não há duplicação.

O gateway de pagamentos, cálculo de frete e geração de fotos por IA não estão integrados. A tela deve sempre apresentar o envio como pedido sem cobrança automática.

## Atualização do Espaço criativo

Para lojas já existentes, execute somente [`database/design.sql`](../database/design.sql) no SQL Editor. A atualização adiciona o design publicado e rascunhos privados, preservando produtos, pedidos, estoque e os quatro valores legados de `template`. Os novos presets são guardados no JSON de design. Esse arquivo pode ser executado novamente sem apagar estilos ou rascunhos.

No painel, abra **Espaço criativo**. Escolha um dos oito pontos de partida, ajuste marca, fontes, capa, paleta e seções. As mudanças de rascunho são salvas na conta e no navegador. **Aplicar na loja** atualiza o visual público em uma operação; uma loja em rascunho continua em rascunho. Visitantes e outros lojistas não recebem acesso ao editor da sua loja.
