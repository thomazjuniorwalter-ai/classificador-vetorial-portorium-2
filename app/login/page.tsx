import Image from "next/image";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "../lib/auth";

type LoginPageProps = { searchParams: Promise<{ erro?: string }> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await getAuthenticatedUser()) redirect("/");
  const { erro } = await searchParams;

  return (
    <main className="loginPage">
      <section className="loginCard">
        <Image src="/grupo-portorium.png" alt="Grupo Portorium" width={230} height={78} priority />
        <span className="loginEyebrow">ACESSO RESTRITO</span>
        <h1>Classificador <i>Vetorial</i></h1>
        <p>Entre com suas credenciais individuais para acessar a plataforma.</p>
        {erro && <div className="loginError" role="alert">{erro === "configuracao" ? "O acesso ainda não foi configurado pelo administrador." : "Usuário ou senha inválidos."}</div>}
        <form action="/api/auth/login" method="post">
          <label htmlFor="username">Usuário</label>
          <input id="username" name="username" autoComplete="username" required autoFocus />
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit">Entrar</button>
        </form>
        <small>Uso exclusivo de colaboradores autorizados pela Portorium.</small>
      </section>
    </main>
  );
}
