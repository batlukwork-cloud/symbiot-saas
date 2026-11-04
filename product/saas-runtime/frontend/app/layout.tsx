import "./styles.css";

export const metadata = {
  title: "Symbiot Runtime MVP",
  description: "G3 Core Integration Runtime GUI"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

