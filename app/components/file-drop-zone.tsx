"use client";

import { useRef, useState, type ReactNode, type DragEvent, type ClipboardEvent } from "react";

type Props = {
  accept: string;
  disabled?: boolean;
  multiple?: boolean;
  label: string;
  onFiles: (files: File[]) => void;
  onSelect?: () => void;
  onError: (message: string) => void;
  children: ReactNode;
};

export function acceptsFile(file: Pick<File, "name" | "type">, accept: string) {
  return accept.split(",").some((item) => {
    const rule = item.trim().toLowerCase();
    if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
    if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
    return file.type.toLowerCase() === rule;
  });
}

export default function FileDropZone({ accept, disabled = false, multiple = true, label, onFiles, onSelect, onError, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  function receive(files: File[]) {
    if (disabled || !files.length) return;
    if (!multiple && files.length > 1) { onError("Solte apenas um arquivo nesta área."); return; }
    const invalid = files.find((file) => !acceptsFile(file, accept));
    if (invalid) { onError(`O formato de ${invalid.name} não é aceito nesta área. Formatos: ${accept}.`); return; }
    const empty = files.find((file) => !file.size);
    if (empty) { onError(`O arquivo ${empty.name} está vazio. Selecione um documento com conteúdo.`); return; }
    onFiles(files);
  }
  function paste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return; // Preserva a colagem de texto.
    event.preventDefault(); event.stopPropagation(); receive(files);
  }
  return <div ref={root} className={`portoriumDropZone${dragging ? " isDragging" : ""}${disabled ? " isDisabled" : ""}`} role="group" aria-label={label} tabIndex={disabled ? -1 : 0}
    onDragEnter={(event) => { if (!hasFiles(event)) return; event.preventDefault(); depth.current += 1; if (!disabled) setDragging(true); }}
    onDragOver={(event) => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
    onDragLeave={(event) => { if (!hasFiles(event)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={(event) => { if (!hasFiles(event)) return; event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); receive(Array.from(event.dataTransfer.files)); }}
    onPaste={paste}>
    <button className="portoriumDropPrompt" type="button" disabled={disabled} onClick={() => onSelect ? onSelect() : root.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
      <strong>{dragging ? "Solte o arquivo aqui" : "Arraste seus arquivos aqui ou clique para selecionar"}</strong>
      <span>Para colar um arquivo, mantenha o foco nesta área e pressione Ctrl + V.</span>
    </button>
    {children}
  </div>;
}
