export const MAX_FILES = 10;
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_TOTAL_FILE_SIZE = 100 * 1024 * 1024;
// Each HTTP request stays below Vercel's 4.5 MB body limit.
export const UPLOAD_CHUNK_SIZE = 3 * 1024 * 1024;
export const MAX_DIRECT_FILE_SIZE = 50 * 1024 * 1024;
export const FILE_SEARCH_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md"]);
export const FILE_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", md: "text/markdown",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

export function fileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

export function validateDocument(file: { name: string; size: number }) {
  if (typeof file.name !== "string" || !file.name.length || file.name.length > 255 || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error("Selecione um documento válido, com conteúdo.");
  }
  const extension = fileExtension(file.name);
  if (!Object.hasOwn(FILE_MIME_TYPES, extension)) throw new Error(`O formato de ${file.name} não é compatível.`);
  if (file.size > MAX_FILE_SIZE) throw new Error(`O arquivo ${file.name} ultrapassa o limite de 100 MB.`);
  if (!FILE_SEARCH_EXTENSIONS.has(extension) && file.size >= MAX_DIRECT_FILE_SIZE) {
    throw new Error(`Para planilhas e imagens, use arquivos menores que 50 MB. Para documentos maiores, envie PDF, Word ou texto (até 100 MB).`);
  }
}

export function validateDocuments(files: { name: string; size: number }[]) {
  if (files.length > MAX_FILES) throw new Error("É possível anexar no máximo 10 documentos por análise.");
  files.forEach(validateDocument);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_FILE_SIZE) {
    throw new Error("O conjunto dos documentos deve ter no máximo 100 MB.");
  }
  if (files.filter(file => !FILE_SEARCH_EXTENSIONS.has(fileExtension(file.name))).reduce((total, file) => total + file.size, 0) >= MAX_DIRECT_FILE_SIZE) {
    throw new Error("As planilhas e imagens devem somar menos de 50 MB. Envie os documentos maiores em PDF, Word ou texto.");
  }
}
