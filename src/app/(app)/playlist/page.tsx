"use client";

import { useMemo } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { ListItemCard } from "@/components/playlist/list-item-card";
import { TopBar, Section } from "@/components/sw";

export default function PlaylistPage() {
  const vmixState = useVmixStore((s) => s.vmixState);
  const connected = useVmixStore((s) => s.connected);

  const listInputs = useMemo(
    () =>
      vmixState?.inputs.filter((i) => i.items && i.items.length > 0) ?? [],
    [vmixState?.inputs]
  );

  if (!connected || !vmixState) {
    return (
      <div className="flex flex-col">
        <TopBar status="offline" num="05" label="Transport" title="Playlist" sub="no vmix" />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {!connected ? "Connect to vMix to use playlists." : "Loading…"}
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <TopBar
        status="live"
        num="05"
        label="Playlist"
        title={
          <>
            {listInputs.length}{" "}
            <span className="text-sw-muted font-light">Lists.</span>
          </>
        }
        sub="transport · routing"
      />

      {listInputs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 border-b-[1.5px] border-sw-line-2">
          {listInputs.map((input) => (
            <ListItemCard key={input.key} input={input} />
          ))}
        </div>
      ) : (
        <Section>
          <div className="text-[13px] text-sw-muted py-16 text-center">
            No list inputs found.
          </div>
        </Section>
      )}
    </div>
  );
}
