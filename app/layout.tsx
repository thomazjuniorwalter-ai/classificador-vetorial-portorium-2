import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Classificador Vetorial Portorium",description:"Inteligência aplicada à classificação fiscal de mercadorias.",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="pt-BR"><body>{children}</body></html>}
