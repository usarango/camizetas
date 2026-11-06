# Camizetas

Plataforma de lojas independentes de roupas e acessórios, com vitrine pública, templates visuais e painel de operação. Site em português; contas próprias por e-mail/senha via Supabase Auth, sem exigir uma conta ChatGPT dos visitantes.

## Funcionalidades

- Criação de múltiplas lojas, endereço exclusivo e publicação controlada pelo proprietário.
- Espaço criativo dentro da loja com oito templates: Atelier, Subsolo, Amplify, Pixel Club, Essência, Botânica, Movimento e Pop.
- Cores, fontes, capa e logo, avisos, cartões, grade e ordem das seções, com prévia do catálogo real em celular/computador.
- Rascunhos privados na conta, recuperação local, desfazer/refazer e aplicação explícita do visual publicado.
- Catálogo de produtos, preço em centavos, fotos e variantes por tamanho/cor/SKU.
- Estoque por variante e ajustes com motivo, autor e histórico.
- Loja pública com catálogo real, sacola e envio de pedido com endereço de entrega.
- Fila: Novo → Confirmado → Em separação → Enviado → Concluído. Cancelamento antes do envio restaura o estoque uma vez.
- Baixa de estoque, valores e snapshots do pedido calculados atomicamente no banco. Repetir um envio com a mesma chave não cria outro pedido.
- Isolamento entre lojas por RLS; clientes acessam somente seus próprios pedidos.

O envio de pedido não cobra cartão/Pix nem calcula frete. Pagamento e entrega são combinados com a loja. Integração de IA está em espera e não aparece no fluxo ativo.

## Rodar e verificar

Requer Node 24 e npm.

```sh
npm ci
npm run check
npm test
npm run build
```

Sirva a pasta `dist/` com um servidor estático. `npm run build` gera os módulos do painel e das lojas; o restante do front-end está em `dist/`.

## Supabase

Use um projeto exclusivo da Camizetas, em uma organização Free para a fase inicial. O projeto informado para configuração é `hbajyggnlsijqrwhsedn`. Não aplicar este schema aos bancos do Rango ou do Harvian.

1. Inspecione o projeto vazio e aplique as migrações em `supabase/migrations/`, quando disponíveis, ou os arquivos `database/schema.sql` e `database/storage.sql`, nessa ordem.
2. Mantenha o schema `private` fora da lista de schemas expostos pela Data API.
3. Defina a URL do site e callbacks do Supabase Auth para a origem publicada, incluindo `/painel.html` e `/painel.html?recovery=1`. Sem SMTP próprio, os limites de e-mail do Supabase se aplicam; configure um remetente antes de abrir cadastro em escala.
4. Configure somente a URL e a **chave publicável** em `.openai/app-public.json`, ou as variáveis `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` no build. As duas são públicas por definição. Nunca usar `service_role` ou `sb_secret_` no navegador.
5. Recompile, publique e execute os testes de integração no projeto.

O acesso administrativo ao projeto depende da organização estar autorizada na conexão Supabase usada para implantar. O código funciona sem essa conexão após o banco e a chave publicável serem configurados.

## Estrutura

- `src/data.js`: cliente Supabase, Auth, consultas e RPCs.
- `src/painel.js`: gestão da loja e compras do cliente.
- `src/storefront.js`, `src/shops.js`: catálogo público e checkout.
- `src/customizer.js`, `src/design.js` e `src/store-layout.js`: espaço criativo e renderização compartilhada entre editor e loja pública.
- `dist/editor.js`: prévias antigas mantidas por compatibilidade com links já existentes.
- `database/`: schema transacional, RLS, Storage e contrato das RPCs.
- `tests/`: testes de PostgreSQL/PLpgSQL/RLS e interações de DOM.
- `scripts/build.mjs`: build estático; rejeita chaves secretas no bundle.
- `.openai/hosting.json`: identidade e hospedagem no Sites, preservadas nas atualizações.

## Validação

O schema foi executado em PostgreSQL via PGlite, com testes reais de RLS, autorização, preços, estoque, rollback, idempotência, snapshots e cancelamento. As interações do painel e checkout foram verificadas em DOM. Esses testes não substituem a validação no Supabase hospedado, os advisors ou um teste com sessões concorrentes em PostgreSQL nativo.

A verificação visual em navegador depende da disponibilidade do executor de QA do ambiente. Fotos e marcas das prévias antigas são ilustrativas; veja `dist/assets/credits.txt`.

## Referência funcional

O fluxo operacional se inspira no Rango, com adaptação para peças, tamanhos e cores. Nenhum código ou banco operacional do Rango ou do Harvian é modificado pela Camizetas.

## Espaço criativo

Abra **Painel → Espaço criativo**, ou **Personalizar minha loja** na vitrine enquanto estiver conectado como proprietário. As alterações viram rascunhos privados; somente **Aplicar na loja** atualiza o que os clientes veem. O estado de publicação da loja é mantido. O editor também está disponível como demonstração na landing, com importação explícita do rascunho após criar a loja.

Projetos já existentes devem aplicar somente `database/design.sql` para habilitar o novo campo e os rascunhos. `database/setup.sql` já inclui essa atualização para projetos novos. Veja [a configuração](docs/CONFIGURACAO.md).
