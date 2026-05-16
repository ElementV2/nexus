"use client";

import { TopBar, Section, Eyebrow } from "@/components/sw";

export default function LivePreviewPage() {
  return (
    <div className="flex flex-col">
      <TopBar
        status="offline"
        num="13"
        label="Preview"
        title={<>Stub.</>}
        sub="srt → hls transcoder"
      />
      <Section>
        <Eyebrow tone="muted" className="mb-3">Implementation</Eyebrow>
        <p className="text-[13px] text-sw-text-dim leading-relaxed max-w-xl">
          Live preview needs FFmpeg SRT → HLS transcoding. Configure vMix to
          publish an SRT stream, then convert it to HLS for browser playback
          with hls.js. The floating player (sidebar &gt; Stream) already
          handles the SRT side.
        </p>
      </Section>
    </div>
  );
}
