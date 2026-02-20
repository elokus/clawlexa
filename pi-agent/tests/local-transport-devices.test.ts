import { describe, it, expect } from 'bun:test';
import { parseMacAudioDevices } from '../src/transport/local.js';

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
