import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SEED — self-replicating factory simulator',
  description:
    'How fast can machines build the machines that build civilization? A first-principles simulator of a self-replicating factory seed on Earth or Mars.',
};

/** Root layout: dark industrial shell, full-viewport app. */
export default function RootLayout({ children }: LayoutProps<'/'>): React.ReactElement {
  return (
    <html lang='en' className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className='h-full'>{children}</body>
    </html>
  );
}
