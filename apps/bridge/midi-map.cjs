'use strict';

function isTriggeringMidiNote(midiType, velocity, data2) {
  if (midiType !== 'note_on') return false;
  const value = typeof velocity === 'number' ? velocity : typeof data2 === 'number' ? data2 : 0;
  return value > 0;
}

function parseMidiBytes(status, data1, data2) {
  const command = status & 0xf0;
  const channel = status & 0x0f;
  if (command === 0x90) {
    return {
      midiType: data2 > 0 ? 'note_on' : 'note_off',
      channel,
      data1,
      data2,
      note: data1,
      velocity: data2,
    };
  }
  if (command === 0x80) {
    return { midiType: 'note_off', channel, data1, data2, note: data1, velocity: data2 };
  }
  if (command === 0xb0) {
    return { midiType: 'cc', channel, data1, data2, velocity: data2 };
  }
  return { midiType: 'other', channel, data1, data2, velocity: data2 };
}

module.exports = { isTriggeringMidiNote, parseMidiBytes };
