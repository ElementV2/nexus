import { XMLParser } from "fast-xml-parser";
import { AUDIO_BUS_SENDS } from "./constants";
import type {
  VmixState,
  VmixInput,
  VmixText,
  VmixDynamic,
  VmixReplay,
  ColorCorrectionData,
  VmixListItem,
} from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (tagName) => ["input", "overlay", "item", "transition", "output", "mix", "text"].includes(tagName.toLowerCase()),
});

function parseCC(ccNode: Record<string, unknown> | undefined): ColorCorrectionData {
  if (!ccNode) {
    return {
      liftR: 0, liftG: 0, liftB: 0, liftY: 0,
      gammaR: 0, gammaG: 0, gammaB: 0, gammaY: 0,
      gainR: 1, gainG: 1, gainB: 1, gainY: 1,
      hue: 0, saturation: 0,
    };
  }
  return {
    liftR: parseFloat(String(ccNode["@_liftR"] ?? "0")),
    liftG: parseFloat(String(ccNode["@_liftG"] ?? "0")),
    liftB: parseFloat(String(ccNode["@_liftB"] ?? "0")),
    liftY: parseFloat(String(ccNode["@_liftY"] ?? "0")),
    gammaR: parseFloat(String(ccNode["@_gammaR"] ?? "0")),
    gammaG: parseFloat(String(ccNode["@_gammaG"] ?? "0")),
    gammaB: parseFloat(String(ccNode["@_gammaB"] ?? "0")),
    gammaY: parseFloat(String(ccNode["@_gammaY"] ?? "0")),
    gainR: parseFloat(String(ccNode["@_gainR"] ?? "1")),
    gainG: parseFloat(String(ccNode["@_gainG"] ?? "1")),
    gainB: parseFloat(String(ccNode["@_gainB"] ?? "1")),
    gainY: parseFloat(String(ccNode["@_gainY"] ?? "1")),
    hue: parseFloat(String(ccNode["@_hue"] ?? "0")),
    saturation: parseFloat(String(ccNode["@_saturation"] ?? "0")),
  };
}

function parseDynamic(dynNode: Record<string, unknown> | undefined): VmixDynamic {
  if (!dynNode) {
    return { input1: "", input2: "", input3: "", input4: "", value1: "", value2: "", value3: "", value4: "" };
  }
  return {
    input1: String(dynNode["input1"] ?? ""),
    input2: String(dynNode["input2"] ?? ""),
    input3: String(dynNode["input3"] ?? ""),
    input4: String(dynNode["input4"] ?? ""),
    value1: String(dynNode["value1"] ?? ""),
    value2: String(dynNode["value2"] ?? ""),
    value3: String(dynNode["value3"] ?? ""),
    value4: String(dynNode["value4"] ?? ""),
  };
}

const REPLAY_DEFAULTS: VmixReplay = {
  recording: false,
  live: false,
  channelMode: "AB",
  events: 0,
  eventsA: 0,
  eventsB: 0,
  cameraA: 1,
  cameraB: 1,
  speed: 1,
  speedA: 1,
  speedB: 1,
  timecode: "",
  timecodeA: "",
  timecodeB: "",
};

function parseReplay(replayNode: Record<string, unknown> | string | undefined): VmixReplay {
  if (!replayNode || typeof replayNode === "string") return { ...REPLAY_DEFAULTS };
  return {
    recording: String(replayNode["@_recording"]) === "True",
    live: String(replayNode["@_live"]) === "True",
    channelMode: (String(replayNode["@_channelMode"] ?? "AB") as VmixReplay["channelMode"]),
    events: Number(replayNode["@_events"] ?? 0),
    eventsA: Number(replayNode["@_eventsA"] ?? 0),
    eventsB: Number(replayNode["@_eventsB"] ?? 0),
    cameraA: Number(replayNode["@_cameraA"] ?? 1),
    cameraB: Number(replayNode["@_cameraB"] ?? 1),
    speed: parseFloat(String(replayNode["@_speed"] ?? "1")),
    speedA: parseFloat(String(replayNode["@_speedA"] ?? "1")),
    speedB: parseFloat(String(replayNode["@_speedB"] ?? "1")),
    // timecodes are child elements, not attributes
    timecode: String(replayNode["timecode"] ?? ""),
    timecodeA: String(replayNode["timecodeA"] ?? ""),
    timecodeB: String(replayNode["timecodeB"] ?? ""),
  };
}

function parseInput(node: Record<string, unknown>): VmixInput {
  const items: VmixListItem[] = [];
  const listNode = node["list"] as Record<string, unknown> | undefined;
  if (listNode) {
    const rawItems = listNode["item"] as Array<Record<string, unknown> | string> | undefined;
    if (rawItems) {
      rawItems.forEach((item) => {
        if (typeof item === "string") {
          items.push({ source: item, selected: false });
        } else {
          items.push({
            source: String(item["#text"] ?? ""),
            selected: String(item["@_selected"]) === "true",
          });
        }
      });
    }
  }

  // Parse <text> child elements (GT/Title inputs)
  const texts: VmixText[] = [];
  const rawTexts = node["text"] as Array<Record<string, unknown>> | undefined;
  if (rawTexts) {
    rawTexts.forEach((t) => {
      texts.push({
        index: Number(t["@_index"] ?? 0),
        name: String(t["@_name"] ?? ""),
        value: String(t["#text"] ?? ""),
      });
    });
  }

  const input: VmixInput = {
    key: String(node["@_key"] ?? ""),
    number: Number(node["@_number"] ?? 0),
    type: String(node["@_type"] ?? ""),
    title: String(node["@_title"] ?? ""),
    shortTitle: String(node["@_shortTitle"] ?? ""),
    state: (String(node["@_state"] ?? "") as VmixInput["state"]) || "",
    position: Number(node["@_position"] ?? 0),
    duration: Number(node["@_duration"] ?? 0),
    loop: String(node["@_loop"]) === "True",
    muted: String(node["@_muted"]) === "True",
    volume: Number(node["@_volume"] ?? 100),
    balance: parseFloat(String(node["@_balance"] ?? "0")),
    gainDb: parseFloat(String(node["@_gainDb"] ?? "0")),
    audioBusses: String(node["@_audiobusses"] ?? "M"),
    meterF1: parseFloat(String(node["@_meterF1"] ?? "0")),
    meterF2: parseFloat(String(node["@_meterF2"] ?? "0")),
    solo: String(node["@_solo"]) === "True",
    hasAudio: "@_muted" in node,
    cc: parseCC(node["cc"] as Record<string, unknown> | undefined),
    selectedIndex: node["@_selectedIndex"] ? Number(node["@_selectedIndex"]) : undefined,
    items: items.length > 0 ? items : undefined,
    texts: texts.length > 0 ? texts : undefined,
  };

  // VideoCall-specific fields (only present on VideoCall inputs)
  if (node["@_callPassword"] != null) input.callPassword = String(node["@_callPassword"]);
  if (node["@_callConnected"] != null) input.callConnected = String(node["@_callConnected"]) === "True";
  if (node["@_callVideoSource"] != null) input.callVideoSource = String(node["@_callVideoSource"]);
  if (node["@_callAudioSource"] != null) input.callAudioSource = String(node["@_callAudioSource"]);

  // Replay-specific: <replay> child element (only on type="Replay")
  const replayChild = node["replay"] as Record<string, unknown> | undefined;
  if (replayChild && typeof replayChild === "object") {
    input.replay = parseReplay(replayChild);
  }

  return input;
}

export function parseVmixXml(xml: string): VmixState {
  const result = parser.parse(xml);
  const vmix = result.vmix;

  if (!vmix) {
    throw new Error("Invalid vMix XML: missing root <vmix> element");
  }

  const inputsRaw = vmix.inputs?.input ?? [];
  const inputsArr = Array.isArray(inputsRaw) ? inputsRaw : [inputsRaw];

  const overlaysRaw = vmix.overlays?.overlay ?? [];
  const overlaysArr = Array.isArray(overlaysRaw) ? overlaysRaw : [overlaysRaw];

  const transitionsRaw = vmix.transitions?.transition ?? [];
  const transitionsArr = Array.isArray(transitionsRaw) ? transitionsRaw : [transitionsRaw];

  const outputsRaw = vmix.outputs?.output ?? [];
  const outputsArr = Array.isArray(outputsRaw) ? outputsRaw : [outputsRaw];

  const mixesRaw = vmix.mix ?? [];
  const mixesArr = Array.isArray(mixesRaw) ? mixesRaw : [mixesRaw];

  const inputs = inputsArr.map(parseInput);
  const replayInput = inputs.find((i: VmixInput) => i.type === "Replay");

  return {
    version: String(vmix["@_version"] ?? vmix.version ?? ""),
    edition: String(vmix["@_edition"] ?? vmix.edition ?? ""),
    inputs,
    overlays: overlaysArr
      .filter((o: Record<string, unknown>) => o["#text"] != null && String(o["#text"]).trim() !== "")
      .map((o: Record<string, unknown>) => ({
        number: Number(o["@_number"] ?? 0),
        inputNumber: Number(o["#text"]),
        // vMix tags an overlay staged on PREVIEW with @_preview="True";
        // live (program) overlays have no such attribute.
        preview: String(o["@_preview"]) === "True",
      })),
    transitions: transitionsArr
      .filter((t: Record<string, unknown>) => t["@_number"] != null)
      .map((t: Record<string, unknown>) => ({
        number: Number(t["@_number"]),
        effect: String(t["@_effect"] ?? "Fade"),
        duration: Number(t["@_duration"] ?? 500),
      })),
    outputs: outputsArr.map((o: Record<string, unknown>) => ({
      type: String(o["@_type"] ?? ""),
      number: Number(o["@_number"] ?? 0),
      source: String(o["@_source"] ?? ""),
      ...(o["@_inputNumber"] != null ? { inputNumber: Number(o["@_inputNumber"]) } : {}),
      srt: String(o["@_srt"]) === "True",
    })),
    mixes: mixesArr
      .filter((m: Record<string, unknown>) => m["@_number"] != null)
      .map((m: Record<string, unknown>) => ({
        number: Number(m["@_number"]),
        active: Number(m["active"] ?? 0),
        preview: Number(m["preview"] ?? 0),
      })),
    audio: {
      volume: Number(vmix.audio?.master?.["@_volume"] ?? 100),
      muted: String(vmix.audio?.master?.["@_muted"]) === "True",
      meterF1: parseFloat(String(vmix.audio?.master?.["@_meterF1"] ?? "0")),
      meterF2: parseFloat(String(vmix.audio?.master?.["@_meterF2"] ?? "0")),
      headphonesVolume: Number(vmix.audio?.master?.["@_headphonesVolume"] ?? 100),
    },
    audioBuses: AUDIO_BUS_SENDS
      .filter((letter) => vmix.audio?.[`bus${letter}`] != null)
      .map((letter) => {
        const bus = vmix.audio[`bus${letter}`];
        return {
          name: letter,
          volume: Number(bus["@_volume"] ?? 100),
          muted: String(bus["@_muted"]) === "True",
          meterF1: parseFloat(String(bus["@_meterF1"] ?? "0")),
          meterF2: parseFloat(String(bus["@_meterF2"] ?? "0")),
          solo: String(bus["@_solo"]) === "True",
          sendToMaster: String(bus["@_sendToMaster"]) !== "False",
        };
      }),
    activeInput: Number(vmix.active ?? 0),
    previewInput: Number(vmix.preview ?? 0),
    recording: String(vmix.recording) === "True",
    streaming: String(vmix.streaming) === "True",
    external: String(vmix.external) === "True",
    playList: String(vmix.playList) === "True",
    multiCorder: String(vmix.multiCorder) === "True",
    fullscreen: String(vmix.fullscreen) === "True",
    preset: String(vmix.preset ?? ""),
    fadeToBlack: String(vmix.fadeToBlack) === "True",
    dynamic: parseDynamic(vmix.dynamic),
    replay: replayInput?.replay ?? { ...REPLAY_DEFAULTS },
  };
}
