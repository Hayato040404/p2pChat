import './globals.css';
import { ReactNode } from 'react';

export const metadata = {
  title: 'p2pChat',
  description: 'P2P Chat (緑ベース)'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
      </body>
    </html>
  );
}
