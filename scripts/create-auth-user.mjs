import { pbkdf2Sync, randomBytes } from "node:crypto";

const [username, name, password] = process.argv.slice(2);
if (!username || !name || !password) {
  console.error('Uso: node scripts/create-auth-user.mjs "usuario" "Nome completo" "senha"');
  process.exit(1);
}
if (password.length < 12) {
  console.error("A senha deve possuir pelo menos 12 caracteres.");
  process.exit(1);
}

const salt = randomBytes(16).toString("base64url");
const hash = pbkdf2Sync(password, salt, 210_000, 32, "sha256").toString("base64url");
console.log(JSON.stringify({ username: username.trim().toLowerCase(), name: name.trim(), salt, hash, active: true }));
