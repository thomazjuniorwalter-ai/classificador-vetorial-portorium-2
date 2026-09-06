# Convites pelo Microsoft 365

## Estado desta alteração
Transporte de e-mail preparado para os dois programas, ainda sem rota pública e sem envio real.
Este módulo não implementa o cadastro de usuários nem substitui a autorização de administrador.
Não publicar como solução completa de autenticação.

Remetente único e login administrativo confirmado: **thomaz@portorium.net**.
Não existe opção de remetente alternativo, SMTP, CC, BCC ou anexos.

## Configuração a autorizar
Registrar aplicativos de tenant único no Microsoft Entra, preferencialmente separados por programa e ambiente.
Autorizar somente **Application Mail.Send**, com Exchange Online Application RBAC limitado à caixa
`thomaz@portorium.net`. Não é necessário ler a caixa nem acessar calendário, contatos ou OneDrive.

As permissões RBAC e as concedidas no Entra são aditivas: uma concessão global de Mail.Send no Entra
anularia na prática a restrição pretendida. O administrador Microsoft deve verificar as concessões
existentes e testar o escopo antes da ativação. Não modificar permissões de outros aplicativos.

Testar a autorização com `Test-ServicePrincipalAuthorization` para a caixa autorizada e para outra
caixa de teste: apenas a primeira deve estar no escopo. Identificar o objeto de aplicativo empresarial
correto ao registrar o service principal no Exchange; não confundir com o objeto do registro do app.

Credenciais novas exigem aprovação de Walter e inserção segura, sem colocá-las no chat, GitHub ou logs.
Cadastre inicialmente apenas no ambiente Preview do projeto correspondente:
- `PORTORIUM_MS_TENANT_ID`: ID do diretório Microsoft.
- `PORTORIUM_MS_CLIENT_ID`: ID do aplicativo autorizado.
- `PORTORIUM_MS_CLIENT_SECRET`: segredo do aplicativo, somente no servidor.
- `PORTORIUM_APP_URL`: origem HTTPS exata do ambiente de teste, sem caminho, query ou fragmento.
- `PORTORIUM_PRODUCT`: `rag` ou `classificador`, conforme o projeto.

Não usar a senha pessoal de Outlook. Não alterar OPENAI_API_KEY, prompts ou vector stores.
A importação do módulo não acessa credenciais; a criação do transporte ocorre sob demanda.

## Integração pendente com o serviço de convites
1. Autenticar a sessão e confirmar no servidor que o administrador é Walter.
2. Limitar tentativas e verificar CSRF/origem antes de qualquer alteração.
3. Persistir convite por programa/ambiente e destinatário, com hash de token aleatório de 32 bytes,
   prazo de expiração e estado. Nunca guardar o token original ou uma senha em texto puro.
4. Chamar `sendInvitation({ recipient, token })` exclusivamente a partir desse serviço.
5. Registrar envio aceito, rejeitado ou incerto. HTTP 202 significa aceitação pela Microsoft, não entrega.
   Não gerar novo convite automaticamente depois de timeout; oferecer reenvio controlado.
6. Implementar `/aceitar-convite`: ler o token do fragmento, removê-lo da barra e enviá-lo por POST,
   validar expiração e destinatário e consumi-lo atomicamente ao definir a senha.
   Sem analytics ou recursos externos nessa página; aplicar Referrer-Policy: no-referrer.
7. Armazenar senhas com derivação segura, revogar sessões ao bloquear/remover o usuário
   e impedir criação ou promoção de outros administradores.
8. Confirmar recebimento real antes de ativar produção. Um teste com resposta simulada não valida
   tenant, consentimento, configuração de caixa, entrega ou o fluxo completo de login.

## Testes sem credenciais
`node --test tests/invitation-mail.test.mjs`

As chamadas Microsoft são simuladas; nenhum e-mail é enviado pelos testes.
O workflow de validação também compila o aplicativo, sem expor segredos de produção.

## Fontes oficiais
- [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [Exchange Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
