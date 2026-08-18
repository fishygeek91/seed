/**
 * App shell: one screen. Top bar, left site panel, center 3D cutaway,
 * right ledgers, bottom time scrubber. Drawers and modals float above.
 */

'use client';

import dynamic from 'next/dynamic';
import { TopBar } from '@/components/TopBar';
import { LeftPanel } from '@/components/LeftPanel';
import { RightPanel } from '@/components/RightPanel';
import { BottomBar } from '@/components/BottomBar';
import { SourcesDrawer } from '@/components/SourcesDrawer';
import { NewGameModal } from '@/components/NewGameModal';
import { SimRunner } from '@/components/SimRunner';
import { SoundController } from '@/components/SoundController';

// R3F must never render on the server.
const SeedScene = dynamic(() => import('@/components/scene/SeedScene').then((m) => m.SeedScene), {
  ssr: false,
  loading: () => <div className='flex-1 flex items-center justify-center text-dim text-xs uppercase tracking-widest'>Deploying optics…</div>,
});

/** The one-screen SEED interface. */
export function App(): React.ReactElement {
  return (
    <div className='flex h-dvh flex-col bg-background text-foreground'>
      <SimRunner />
      <SoundController />
      <TopBar />
      <main className='flex flex-1 min-h-0'>
        <LeftPanel />
        <SeedScene />
        <RightPanel />
      </main>
      <BottomBar />
      <SourcesDrawer />
      <NewGameModal />
    </div>
  );
}
