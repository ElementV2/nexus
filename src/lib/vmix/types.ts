export interface VmixText {
  index: number;
  name: string;
  value: string;
}

export interface VmixDynamic {
  input1: string;
  input2: string;
  input3: string;
  input4: string;
  value1: string;
  value2: string;
  value3: string;
  value4: string;
}

export interface VmixTransition {
  number: number;       // 1-4
  effect: string;       // "Fade", "Merge", "Wipe", "CubeZoom", etc.
  duration: number;     // ms
}

export interface VmixMix {
  number: number;      // 2, 3, 4 (matches Mix API index = number - 1)
  active: number;      // input number on program
  preview: number;     // input number on preview
}

export interface VmixOutput {
  type: string;        // "output" | "fullscreen"
  number: number;
  source: string;      // "Input" | "Output" | "MultiView" | etc.
  inputNumber?: number; // present when source === "Input"
  srt: boolean;
}

export interface VmixReplay {
  recording: boolean;
  live: boolean;
  channelMode: "A" | "B" | "AB";
  events: number;
  eventsA: number;
  eventsB: number;
  cameraA: number;
  cameraB: number;
  speed: number;
  speedA: number;
  speedB: number;
  timecode: string;
  timecodeA: string;
  timecodeB: string;
}

export interface VmixState {
  version: string;
  edition: string;
  inputs: VmixInput[];
  overlays: VmixOverlay[];
  transitions: VmixTransition[];
  outputs: VmixOutput[];
  mixes: VmixMix[];
  audio: VmixAudioMaster;
  audioBuses: VmixAudioBus[];
  activeInput: number;
  previewInput: number;
  recording: boolean;
  streaming: boolean;
  external: boolean;
  playList: boolean;
  multiCorder: boolean;
  fullscreen: boolean;
  preset: string;
  fadeToBlack: boolean;
  dynamic: VmixDynamic;
  replay: VmixReplay;
}

export interface VmixInput {
  key: string;
  number: number;
  type: string;
  title: string;
  shortTitle: string;
  state: "Running" | "Paused" | "Completed" | "";
  position: number;
  duration: number;
  loop: boolean;
  muted: boolean;
  volume: number;
  balance: number;
  gainDb: number;
  audioBusses: string;
  meterF1: number;
  meterF2: number;
  solo: boolean;
  hasAudio: boolean;
  cc: ColorCorrectionData;
  overlay?: VmixInputOverlay[];
  selectedIndex?: number;
  items?: VmixListItem[];
  texts?: VmixText[];
  callPassword?: string;
  callConnected?: boolean;
  callVideoSource?: string;
  callAudioSource?: string;
  replay?: VmixReplay;
}

export interface VmixListItem {
  source: string;
  selected: boolean;
}

export interface VmixInputOverlay {
  index: number;
  key: string;
}

export interface VmixOverlay {
  number: number;
  inputNumber: number;
}

export interface VmixAudioMaster {
  volume: number;
  muted: boolean;
  meterF1: number;
  meterF2: number;
  headphonesVolume: number;
}

export interface VmixAudioBus {
  name: string;       // "A", "B", etc.
  volume: number;
  muted: boolean;
  meterF1: number;
  meterF2: number;
  solo: boolean;
  sendToMaster: boolean;
}

export interface ColorCorrectionData {
  liftR: number;
  liftG: number;
  liftB: number;
  liftY: number;
  gammaR: number;
  gammaG: number;
  gammaB: number;
  gammaY: number;
  gainR: number;
  gainG: number;
  gainB: number;
  gainY: number;
  hue: number;
  saturation: number;
}

export interface AudioData {
  inputNumber: number;
  title: string;
  volume: number;
  muted: boolean;
  audioBusses: string[];
  meterF1: number;
  meterF2: number;
  solo: boolean;
}
