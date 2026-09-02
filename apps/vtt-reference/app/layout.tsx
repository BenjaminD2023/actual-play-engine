import './globals.css';
import type { ReactNode } from 'react';
import { Nav } from '../components/Nav';

export const metadata = { title: 'Actual Play VTT' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Nav />
          {children}
        </div>
      </body>
    </html>
  );
}
