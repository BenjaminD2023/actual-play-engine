'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/director', 'Director'],
  ['/prepare', 'Prepare'],
  ['/player', 'Player'],
  ['/audience', 'Audience'],
  ['/broadcast', 'Broadcast'],
  ['/projector', 'Projector'],
  ['/overlay', 'Overlay'],
  ['/operator', 'Operator'],
  ['/replay', 'Replay'],
  ['/preflight', 'Preflight'],
  ['/rehearsal', 'Rehearsal'],
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="top">
      <strong>AP VTT</strong>
      <nav>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
            {label}
          </Link>
        ))}
        <Link href="/login">Login</Link>
      </nav>
    </header>
  );
}
