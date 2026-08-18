/**
 * FilmRecorder: records the mission reel to a downloadable WebM.
 *
 * The reel's letterbox and captions live in the DOM, which a raw canvas
 * capture would miss — so while recording, every frame of the 3D canvas is
 * composited onto an offscreen canvas along with cinematic bars, the REPLAY
 * and REC tags, the beat counter, and the event caption. That composite is
 * captured at 30 fps, and when the ambient sound engine is unlocked the
 * master audio bus is muxed in, so the film carries the wind, the hum, and
 * the stingers. When the reel ends (or the user stops it) the recorder
 * finalizes and a `seed-reel-sol-N.webm` download fires. Everything happens
 * client-side via MediaRecorder; nothing leaves the machine. Renders nothing.
 */

'use client';

import { useEffect } from 'react';
import { useSimStore } from '@/store/useSimStore';
import { soundEngine } from '@/sound/engine';
import { CANVAS_REGISTRY } from '@/components/scene/canvasRegistry';

/** Pick the best WebM flavor the browser offers. */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return null;
}

/** Trigger a client-side download of the finished film. */
function downloadFilm(blob: Blob, sol: number): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `seed-reel-sol-${Math.floor(sol)}.webm`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Draw the reel's letterbox, tags, counter, and caption onto the composite frame. */
function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const store = useSimStore.getState();
  const beats = store.reelBeats;
  if (beats === null || store.reelIndex >= beats.length) {
    return;
  }
  const beat = beats[store.reelIndex];
  const unit = store.state.siteId === 'mars' ? 'SOL' : 'DAY';
  const barTop = Math.round(h * 0.07);
  const barBottom = Math.round(h * 0.12);
  const fontPx = Math.max(11, Math.round(h * 0.022));

  // Cinematic bars.
  ctx.fillStyle = '#010409';
  ctx.fillRect(0, 0, w, barTop);
  ctx.fillRect(0, h - barBottom, w, barBottom);

  // REPLAY + REC tags, with pulsing dots.
  const pulse = 0.55 + 0.45 * Math.sin(t * 4);
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  const tagY = Math.round(barTop * 0.55);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#3fd2ff';
  ctx.beginPath();
  ctx.arc(fontPx * 1.2, tagY, fontPx * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillText('R E P L A Y', fontPx * 2, tagY);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#ff3d8a';
  ctx.beginPath();
  ctx.arc(fontPx * 9.4, tagY, fontPx * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillText('R E C', fontPx * 10.2, tagY);

  // Beat counter and caption, centered in the bottom bar.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#3fd2ff';
  ctx.fillText(
    `MISSION REEL · ${unit} ${beat.sol} · ${store.reelIndex + 1}/${beats.length}`,
    w / 2,
    h - barBottom * 0.66,
  );
  ctx.fillStyle = '#b6e9d6';
  ctx.font = `${Math.round(fontPx * 1.15)}px ui-monospace, monospace`;
  ctx.fillText(beat.message, w / 2, h - barBottom * 0.28, w * 0.92);
  ctx.textAlign = 'left';
}

/** Mount once inside the app shell. */
export function FilmRecorder(): null {
  const recording = useSimStore((s) => s.reelBeats !== null && s.reelRecording);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const store = useSimStore.getState();
    const source = CANVAS_REGISTRY.el;
    const mimeType = pickMimeType();
    if (source === null || mimeType === null) {
      // No capturable canvas or no WebM support: run the reel unrecorded.
      store.setReelRecording(false);
      return;
    }
    const filmSol = store.state.sol;

    // Composite canvas: 3D frame + letterbox + captions, redrawn per frame.
    const composite = document.createElement('canvas');
    composite.width = source.width;
    composite.height = source.height;
    const ctx = composite.getContext('2d');
    if (ctx === null) {
      store.setReelRecording(false);
      return;
    }
    let raf = 0;
    const startedAt = performance.now();
    const paint = (): void => {
      // Track source size (window resizes mid-reel would skew the film).
      if (composite.width !== source.width || composite.height !== source.height) {
        composite.width = source.width;
        composite.height = source.height;
      }
      ctx.drawImage(source, 0, 0, composite.width, composite.height);
      drawOverlay(ctx, composite.width, composite.height, (performance.now() - startedAt) / 1000);
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);

    const video = composite.captureStream(30);
    // Sound is muxed only when the engine is unlocked (i.e. audio has been on).
    const audio = soundEngine.recordingStream();
    const tracks = [...video.getVideoTracks(), ...(audio !== null ? audio.getAudioTracks() : [])];
    const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      if (chunks.length > 0) {
        downloadFilm(new Blob(chunks, { type: mimeType }), filmSol);
      }
    };
    recorder.start(1000); // 1 s chunks keep memory bounded on long reels
    return () => {
      // Reel ended or was stopped: finalize and download.
      cancelAnimationFrame(raf);
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      for (const track of tracks) {
        if (track.kind === 'video') {
          track.stop();
        }
      }
    };
  }, [recording]);

  return null;
}
