import { redirect } from "next/navigation";
import Classificador from "./classificador";
import { getAuthenticatedUser } from "./lib/auth";

export default async function Home() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  return <Classificador displayName={user.name} initials={user.initials} />;
}
