import { describe, it, expect } from 'bun:test';
import {
  areLikelySamePhysicalAudioDevice,
  isEchoCancelSourceName,
  parseMacAudioDevices,
  selectPreferredLinuxInputDevice,
} from '../src/transport/local.js';

describe('parseMacAudioDevices', () => {
  it('extracts input/output inventories and defaults from system_profiler output', () => {
    const sample = `
Audio:

    Devices:

        Brio 500:

          Input Channels: 2
          Manufacturer: Unknown Manufacturer
          Current SampleRate: 48000
          Transport: USB
          Input Source: Default

        MacBook Pro Microphone:

          Default Input Device: Yes
          Input Channels: 1
          Manufacturer: Apple Inc.
          Current SampleRate: 48000
          Transport: Built-in
          Input Source: MacBook Pro Microphone

        MacBook Pro Speakers:

          Default Output Device: Yes
          Default System Output Device: Yes
          Manufacturer: Apple Inc.
          Output Channels: 2
          Current SampleRate: 48000
          Transport: Built-in
          Output Source: MacBook Pro Speakers
`;

    const parsed = parseMacAudioDevices(sample);
    expect(parsed.inputDevices).toEqual(['Brio 500', 'MacBook Pro Microphone']);
    expect(parsed.outputDevices).toEqual(['MacBook Pro Speakers']);
    expect(parsed.defaultInputDevice).toBe('MacBook Pro Microphone');
    expect(parsed.defaultOutputDevice).toBe('MacBook Pro Speakers');
  });
});

describe('selectPreferredLinuxInputDevice', () => {
  const inventory = {
    inputDevices: [
      'alsa_input.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo',
      'echo_cancel.source',
    ],
    outputDevices: ['alsa_output.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo'],
    defaultInputDevice: 'alsa_input.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo',
    defaultOutputDevice: 'alsa_output.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo',
  };

  it('prefers echo-cancel source when requested input is default', () => {
    const selected = selectPreferredLinuxInputDevice({
      requestedInputDevice: 'default',
      inventory,
      preferEchoCancelSource: true,
    });

    expect(selected).toBe('echo_cancel.source');
  });

  it('keeps explicit input device selection', () => {
    const selected = selectPreferredLinuxInputDevice({
      requestedInputDevice: 'alsa_input.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo',
      inventory,
      preferEchoCancelSource: true,
    });

    expect(selected).toBe('alsa_input.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo');
  });
});

describe('local routing heuristics', () => {
  it('detects echo-cancel source names', () => {
    expect(isEchoCancelSourceName('echo_cancel.source')).toBe(true);
    expect(isEchoCancelSourceName('webrtc-aec-source')).toBe(true);
    expect(isEchoCancelSourceName('alsa_input.usb-jabra')).toBe(false);
  });

  it('identifies matching physical source/sink names', () => {
    const sameDevice = areLikelySamePhysicalAudioDevice(
      'alsa_input.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo',
      'alsa_output.usb-0b0e_Jabra_Speak2_55_MS-00.analog-stereo'
    );
    const differentDevice = areLikelySamePhysicalAudioDevice(
      'alsa_input.usb-046d_Brio_500-00.analog-stereo',
      'alsa_output.pci-0000_03_00.1.hdmi-stereo'
    );

    expect(sameDevice).toBe(true);
    expect(differentDevice).toBe(false);
  });
});
