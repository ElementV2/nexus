// Type-safe vMix command builders

export interface VmixCommand {
  Function: string;
  Input?: string;
  Value?: string;
  Mix?: string;
  Duration?: string;
  SelectedIndex?: string;
  SelectedName?: string;
}

// Audio
export function setVolume(input: number | string, value: number): VmixCommand {
  return { Function: "SetVolume", Input: String(input), Value: String(Math.round(value)) };
}

export function audioOn(input: number | string): VmixCommand {
  return { Function: "AudioOn", Input: String(input) };
}

export function audioOff(input: number | string): VmixCommand {
  return { Function: "AudioOff", Input: String(input) };
}

export function audioBusOn(input: number | string, bus: string): VmixCommand {
  return { Function: "AudioBusOn", Input: String(input), Value: bus };
}

export function audioBusOff(input: number | string, bus: string): VmixCommand {
  return { Function: "AudioBusOff", Input: String(input), Value: bus };
}

// Bus-level audio
export function setBusVolume(bus: string, value: number): VmixCommand {
  return { Function: `SetBus${bus}Volume`, Value: String(Math.round(value)) };
}

// Mute / unmute an entire bus output (any letter A-G or M for Master).
// The literal function name is "BusXAudioOn" / "BusXAudioOff" — the X
// is part of the name, NOT a placeholder. The target bus is passed as
// Value. (BusAAudio* and BusBAudio* also exist as legacy aliases but
// have no equivalent for C-G, hence the X-style call here.)
export function busAudioOn(bus: string): VmixCommand {
  return { Function: "BusXAudioOn", Value: bus };
}

export function busAudioOff(bus: string): VmixCommand {
  return { Function: "BusXAudioOff", Value: bus };
}

export function setMasterVolume(value: number): VmixCommand {
  return { Function: "SetMasterVolume", Value: String(Math.round(value)) };
}

export function masterAudioOn(): VmixCommand {
  return { Function: "MasterAudioOn" };
}

export function masterAudioOff(): VmixCommand {
  return { Function: "MasterAudioOff" };
}

// Colorimetry
export function setCCParam(
  wheel: "Lift" | "Gamma" | "Gain",
  channel: "R" | "G" | "B" | "Y",
  input: number | string,
  value: number
): VmixCommand {
  return {
    Function: `SetCC${wheel}${channel}`,
    Input: String(input),
    Value: value.toFixed(4),
  };
}

export function setCCHue(input: number | string, value: number): VmixCommand {
  return { Function: "SetCCHue", Input: String(input), Value: value.toFixed(4) };
}

export function setCCSaturation(input: number | string, value: number): VmixCommand {
  return { Function: "SetCCSaturation", Input: String(input), Value: value.toFixed(4) };
}

export function colourCorrectionReset(input: number | string): VmixCommand {
  return { Function: "ColourCorrectionReset", Input: String(input) };
}

// Playlist / Transport
export function play(input: number | string): VmixCommand {
  return { Function: "Play", Input: String(input) };
}

export function pause(input: number | string): VmixCommand {
  return { Function: "Pause", Input: String(input) };
}

export function restart(input: number | string): VmixCommand {
  return { Function: "Restart", Input: String(input) };
}

export function setPosition(input: number | string, ms: number): VmixCommand {
  return { Function: "SetPosition", Input: String(input), Value: String(Math.round(ms)) };
}

export function toggleLoop(input: number | string): VmixCommand {
  return { Function: "Loop", Input: String(input) };
}

export function selectIndex(input: number | string, index: number): VmixCommand {
  return { Function: "SelectIndex", Input: String(input), Value: String(index) };
}

export function nextItem(input: number | string): VmixCommand {
  return { Function: "NextItem", Input: String(input) };
}

export function previousItem(input: number | string): VmixCommand {
  return { Function: "PreviousItem", Input: String(input) };
}

export function listRemove(input: number | string, index: number): VmixCommand {
  return { Function: "ListRemove", Input: String(input), Value: String(index) };
}

// Output
export function setOutput(
  outputFn: string,
  input: string,
): VmixCommand {
  return { Function: outputFn, Input: input, Value: "Input" };
}

export function setOutputMix(
  outputFn: string,
  mix: number,
): VmixCommand {
  return { Function: outputFn, Value: "Output", Mix: String(mix) };
}

/**
 * Route a preset source (PGM / PVW / MultiView N) to an external
 * output. `outputFn` is one of SetOutput2/3/4, `source` is the Value
 * string vMix expects: "Output", "Preview", "MultiView", "MultiView2", ...
 */
export function setOutputSource(
  outputFn: string,
  source: string,
): VmixCommand {
  return { Function: outputFn, Value: source };
}

// Timers
export function setCountdown(input: number | string, value: string): VmixCommand {
  return { Function: "SetCountdown", Input: String(input), Value: value };
}

export function startCountdown(input: number | string): VmixCommand {
  return { Function: "StartCountdown", Input: String(input) };
}

export function pauseCountdown(input: number | string): VmixCommand {
  return { Function: "PauseCountdown", Input: String(input) };
}

export function stopCountdown(input: number | string): VmixCommand {
  return { Function: "StopCountdown", Input: String(input) };
}
export function adjustCountdown(input: number | string, seconds: number): VmixCommand {
  return { Function: "AdjustCountdown", Input: String(input), Value: String(seconds) };
}
export function changeCountdownDuration(input: number | string, duration: string): VmixCommand {
  return { Function: "ChangeCountdownDuration", Input: String(input), Value: duration };
}
export function setCountdownDuration(input: number | string, duration: string): VmixCommand {
  return { Function: "SetCountdownDuration", Input: String(input), Value: duration };
}

// Transitions (Cut/Fade/Transition1-4/Preview targeting a specific Mix)
export function transitionInput(
  fn: string,
  input: number | string,
  duration?: number,
  mix?: number,
): VmixCommand {
  const cmd: VmixCommand = { Function: fn, Input: String(input) };
  if (duration !== undefined) cmd.Duration = String(duration);
  if (mix !== undefined) cmd.Mix = String(mix);
  return cmd;
}

/** Execute the currently-active transition (PVW → PGM swap). */
export function takeTransition(mix?: number): VmixCommand {
  const cmd: VmixCommand = { Function: "Cut" };
  if (mix !== undefined) cmd.Mix = String(mix);
  return cmd;
}

/**
 * Swap PVW ↔ PGM using a named transition (no Input arg).
 * `fn` can be a built-in like "Cut", "Fade", "Wipe", "Zoom", "Merge",
 * or one of "Transition1".."Transition4" to fire a configured T-slot.
 */
export function pvwTransition(
  fn: string,
  duration?: number,
  mix?: number,
): VmixCommand {
  const cmd: VmixCommand = { Function: fn };
  if (duration !== undefined) cmd.Duration = String(duration);
  if (mix !== undefined) cmd.Mix = String(mix);
  return cmd;
}

/** Fade to / from black. */
export function fadeToBlack(): VmixCommand {
  return { Function: "FadeToBlack" };
}

/** Toggle vMix streaming (1st streaming target). */
export function startStreaming(): VmixCommand {
  return { Function: "StartStreaming" };
}
export function stopStreaming(): VmixCommand {
  return { Function: "StopStreaming" };
}

export function previewInput(input: number | string, mix?: number): VmixCommand {
  const cmd: VmixCommand = { Function: "PreviewInput", Input: String(input) };
  if (mix !== undefined) cmd.Mix = String(mix);
  return cmd;
}

// Overlay
export function overlayInput(overlayNumber: number, input: number | string): VmixCommand {
  return { Function: `OverlayInput${overlayNumber}`, Input: String(input) };
}

export function overlayInputOff(overlayNumber: number): VmixCommand {
  return { Function: `OverlayInput${overlayNumber}Off` };
}

// ── Replay ──

// Recording
export function replayStartRecording(): VmixCommand {
  return { Function: "ReplayStartRecording" };
}
export function replayStopRecording(): VmixCommand {
  return { Function: "ReplayStopRecording" };
}

// Transport
export function replayPlay(): VmixCommand {
  return { Function: "ReplayPlay" };
}
export function replayPause(): VmixCommand {
  return { Function: "ReplayPause" };
}
export function replayPlayPause(): VmixCommand {
  return { Function: "ReplayPlayPause" };
}
export function replayPlayForward(): VmixCommand {
  return { Function: "ReplayPlayForward" };
}
export function replayPlayBackward(): VmixCommand {
  return { Function: "ReplayPlayBackward" };
}
export function replayFastForward(speed: number): VmixCommand {
  return { Function: "ReplayFastForward", Value: String(speed) };
}
export function replayFastBackward(speed: number): VmixCommand {
  return { Function: "ReplayFastBackward", Value: String(speed) };
}
export function replayJumpToNow(): VmixCommand {
  return { Function: "ReplayJumpToNow" };
}
export function replayJumpFrames(frames: number): VmixCommand {
  return { Function: "ReplayJumpFrames", Value: String(frames) };
}
export function replayLive(): VmixCommand {
  return { Function: "ReplayLive" };
}
export function replayLiveToggle(): VmixCommand {
  return { Function: "ReplayLiveToggle" };
}
export function replayRecorded(): VmixCommand {
  return { Function: "ReplayRecorded" };
}
export function replayShowHide(): VmixCommand {
  return { Function: "ReplayShowHide" };
}

// Speed / Direction
export function replaySetSpeed(speed: number): VmixCommand {
  return { Function: "ReplaySetSpeed", Value: speed.toFixed(2) };
}
export function replayChangeSpeed(speed: number): VmixCommand {
  return { Function: "ReplayChangeSpeed", Value: String(speed) };
}
export function replaySetDirectionForward(): VmixCommand {
  return { Function: "ReplaySetDirectionForward" };
}
export function replaySetDirectionBackward(): VmixCommand {
  return { Function: "ReplaySetDirectionBackward" };
}
export function replayChangeDirection(): VmixCommand {
  return { Function: "ReplayChangeDirection" };
}

// Channel Selection
export function replaySelectChannelA(): VmixCommand {
  return { Function: "ReplaySelectChannelA" };
}
export function replaySelectChannelB(): VmixCommand {
  return { Function: "ReplaySelectChannelB" };
}
export function replaySelectChannelAB(): VmixCommand {
  return { Function: "ReplaySelectChannelAB" };
}
export function replaySwapChannels(): VmixCommand {
  return { Function: "ReplaySwapChannels" };
}
export function replaySetChannelAToBTimecodeAndCamera(): VmixCommand {
  return { Function: "ReplaySetChannelAToBTimecodeAndCamera" };
}
export function replaySetChannelBToATimecodeAndCamera(): VmixCommand {
  return { Function: "ReplaySetChannelBToATimecodeAndCamera" };
}

// Camera Selection
export function replayCamera(channel: string, camera: number): VmixCommand {
  return { Function: `Replay${channel}Camera${camera}` };
}
export function replayActiveCamera(camera: number): VmixCommand {
  return { Function: `ReplayCamera${camera}` };
}

// Mark In/Out
export function replayMarkIn(): VmixCommand {
  return { Function: "ReplayMarkIn" };
}
export function replayMarkOut(): VmixCommand {
  return { Function: "ReplayMarkOut" };
}
export function replayMarkCancel(): VmixCommand {
  return { Function: "ReplayMarkCancel" };
}
export function replayMarkInLive(): VmixCommand {
  return { Function: "ReplayMarkInLive" };
}
export function replayMarkInOut(seconds: number): VmixCommand {
  return { Function: "ReplayMarkInOut", Value: String(seconds) };
}
export function replayMarkInOutLive(seconds: number): VmixCommand {
  return { Function: "ReplayMarkInOutLive", Value: String(seconds) };
}
export function replayMarkInOutRecorded(seconds: number): VmixCommand {
  return { Function: "ReplayMarkInOutRecorded", Value: String(seconds) };
}
export function replayMarkInRecorded(): VmixCommand {
  return { Function: "ReplayMarkInRecorded" };
}
export function replayMarkInRecordedNow(): VmixCommand {
  return { Function: "ReplayMarkInRecordedNow" };
}

// Event Selection
export function replaySelectEvents(num: number): VmixCommand {
  return { Function: `ReplaySelectEvents${num}` };
}
export function replaySelectFirstEvent(): VmixCommand {
  return { Function: "ReplaySelectFirstEvent" };
}
export function replaySelectLastEvent(): VmixCommand {
  return { Function: "ReplaySelectLastEvent" };
}
export function replaySelectNextEvent(): VmixCommand {
  return { Function: "ReplaySelectNextEvent" };
}
export function replaySelectPreviousEvent(): VmixCommand {
  return { Function: "ReplaySelectPreviousEvent" };
}
export function replaySelectAllEvents(): VmixCommand {
  return { Function: "ReplaySelectAllEvents" };
}

// Event Playback
export function replayPlaySelectedEvent(): VmixCommand {
  return { Function: "ReplayPlaySelectedEvent" };
}
export function replayPlaySelectedEventToOutput(): VmixCommand {
  return { Function: "ReplayPlaySelectedEventToOutput" };
}
export function replayPlayLastEvent(): VmixCommand {
  return { Function: "ReplayPlayLastEvent" };
}
export function replayPlayLastEventToOutput(): VmixCommand {
  return { Function: "ReplayPlayLastEventToOutput" };
}
export function replayPlayEvent(eventNumber: number): VmixCommand {
  return { Function: "ReplayPlayEvent", Value: String(eventNumber) };
}
export function replayPlayEventToOutput(eventNumber: number): VmixCommand {
  return { Function: "ReplayPlayEventToOutput", Value: String(eventNumber) };
}
export function replayPlayEventsByID(ids: string): VmixCommand {
  return { Function: "ReplayPlayEventsByID", Value: ids };
}
export function replayPlayEventsByIDToOutput(ids: string): VmixCommand {
  return { Function: "ReplayPlayEventsByIDToOutput", Value: ids };
}
export function replayPlayAllEvents(): VmixCommand {
  return { Function: "ReplayPlayAllEvents" };
}
export function replayPlayAllEventsToOutput(): VmixCommand {
  return { Function: "ReplayPlayAllEventsToOutput" };
}
export function replayPlayNext(): VmixCommand {
  return { Function: "ReplayPlayNext" };
}
export function replayPlayPrevious(): VmixCommand {
  return { Function: "ReplayPlayPrevious" };
}
export function replayStopEvents(): VmixCommand {
  return { Function: "ReplayStopEvents" };
}

// In/Out Point Trimming
export function replayMoveSelectedInPoint(frames: number): VmixCommand {
  return { Function: "ReplayMoveSelectedInPoint", Value: String(frames) };
}
export function replayMoveSelectedOutPoint(frames: number): VmixCommand {
  return { Function: "ReplayMoveSelectedOutPoint", Value: String(frames) };
}
export function replayUpdateSelectedInPoint(): VmixCommand {
  return { Function: "ReplayUpdateSelectedInPoint" };
}
export function replayUpdateSelectedOutPoint(): VmixCommand {
  return { Function: "ReplayUpdateSelectedOutPoint" };
}
export function replayJumpToSelectedInPoint(): VmixCommand {
  return { Function: "ReplayJumpToSelectedInPoint" };
}
export function replayJumpToSelectedOutPoint(): VmixCommand {
  return { Function: "ReplayJumpToSelectedOutPoint" };
}

// Event Management
export function replayMoveSelectedEventUp(): VmixCommand {
  return { Function: "ReplayMoveSelectedEventUp" };
}
export function replayMoveSelectedEventDown(): VmixCommand {
  return { Function: "ReplayMoveSelectedEventDown" };
}
export function replayMoveLastEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayMoveLastEvent", Value: String(eventIndex) };
}
export function replayMoveSelectedEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayMoveSelectedEvent", Value: String(eventIndex) };
}
export function replayCopyLastEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayCopyLastEvent", Value: String(eventIndex) };
}
export function replayCopySelectedEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayCopySelectedEvent", Value: String(eventIndex) };
}
export function replayDeleteLastEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayDeleteLastEvent", Value: String(eventIndex) };
}
export function replayDeleteSelectedEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayDeleteSelectedEvent", Value: String(eventIndex) };
}
export function replayDuplicateLastEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayDuplicateLastEvent", Value: String(eventIndex) };
}
export function replayDuplicateSelectedEvent(eventIndex: number): VmixCommand {
  return { Function: "ReplayDuplicateSelectedEvent", Value: String(eventIndex) };
}
export function replayExportLastEvent(folder: string): VmixCommand {
  return { Function: "ReplayExportLastEvent", Value: folder };
}

// Event Text
export function replaySetSelectedEventText(text: string): VmixCommand {
  return { Function: "ReplaySetSelectedEventText", Value: text };
}
export function replaySetLastEventText(text: string): VmixCommand {
  return { Function: "ReplaySetLastEventText", Value: text };
}

// Event Camera Toggles
export function replayToggleSelectedEventCamera(camera: number): VmixCommand {
  return { Function: `ReplayToggleSelectedEventCamera${camera}` };
}
export function replayToggleLastEventCamera(camera: number): VmixCommand {
  return { Function: `ReplayToggleLastEventCamera${camera}` };
}

// Speed Update
export function replayUpdateSelectedSpeed(): VmixCommand {
  return { Function: "ReplayUpdateSelectedSpeed" };
}
export function replayUpdateSelectedSpeedDefault(): VmixCommand {
  return { Function: "ReplayUpdateSelectedSpeedDefault" };
}
export function replayUpdateSelectedSpeedFromValue(speed: number): VmixCommand {
  return { Function: "ReplayUpdateSelectedSpeedFromValue", Value: speed.toFixed(2) };
}

// Quad Mode
export function replayQuadModeOn(): VmixCommand {
  return { Function: "ReplayQuadModeOn" };
}
export function replayQuadModeOff(): VmixCommand {
  return { Function: "ReplayQuadModeOff" };
}
export function replayToggleQuadMode(): VmixCommand {
  return { Function: "ReplayToggleQuadMode" };
}

// Timecode Sync
export function replaySetTimecode(tc: string): VmixCommand {
  return { Function: "ReplaySetTimecode", Value: tc };
}
export function replaySetChannelAToBTimecode(): VmixCommand {
  return { Function: "ReplaySetChannelAToBTimecode" };
}
export function replaySetChannelBtoATimecode(): VmixCommand {
  return { Function: "ReplaySetChannelBtoATimecode" };
}

// Audio Source
export function replaySetAudioSource(source: string): VmixCommand {
  return { Function: "ReplaySetAudioSource", Value: source };
}

// Video Call
export function videoCallAudioSource(input: number | string, source: string): VmixCommand {
  return { Function: "VideoCallAudioSource", Input: String(input), Value: source };
}
export function videoCallVideoSource(input: number | string, source: string): VmixCommand {
  return { Function: "VideoCallVideoSource", Input: String(input), Value: source };
}

// Title / GT text
export function setText(input: number | string, value: string, selectedIndex: number): VmixCommand {
  return { Function: "SetText", Input: String(input), Value: value, SelectedIndex: String(selectedIndex) };
}
export function setTextByName(input: number | string, value: string, selectedName: string): VmixCommand {
  return { Function: "SetText", Input: String(input), Value: value, SelectedName: selectedName };
}
export function setTextColour(input: number | string, colour: string, selectedIndex: number): VmixCommand {
  return { Function: "SetTextColour", Input: String(input), Value: colour, SelectedIndex: String(selectedIndex) };
}
export function setTextVisibleOn(input: number | string, selectedIndex: number): VmixCommand {
  return { Function: "SetTextVisibleOn", Input: String(input), SelectedIndex: String(selectedIndex) };
}
export function setTextVisibleOff(input: number | string, selectedIndex: number): VmixCommand {
  return { Function: "SetTextVisibleOff", Input: String(input), SelectedIndex: String(selectedIndex) };
}
export function selectTitlePreset(input: number | string, presetIndex: number): VmixCommand {
  return { Function: "SelectTitlePreset", Input: String(input), Value: String(presetIndex) };
}
export function nextTitlePreset(input: number | string): VmixCommand {
  return { Function: "NextTitlePreset", Input: String(input) };
}
export function previousTitlePreset(input: number | string): VmixCommand {
  return { Function: "PreviousTitlePreset", Input: String(input) };
}
