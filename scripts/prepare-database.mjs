import {readFile,writeFile} from 'node:fs/promises';
const stripTransactions=sql=>sql.replace(/^\s*(?:begin|commit);\s*$/gmi,'').trim();
const parts=await Promise.all(['database/schema.sql','database/storage.sql','database/design.sql','database/collections.sql','database/product-pages.sql'].map(async name=>stripTransactions(await readFile(name,'utf8'))));
await writeFile('database/setup.sql','-- Camizetas: configuração inicial para um projeto Supabase novo.\n-- Execute uma única vez no SQL Editor do projeto da Camizetas.\n-- Não apaga dados. Se já houver tabelas com estes nomes, a transação será revertida.\nbegin;\n\n'+parts.join('\n\n')+"\n\nnotify pgrst, 'reload schema';\ncommit;\n");
console.log('Prepared database/setup.sql');
