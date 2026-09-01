'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTriggeringMidiNote, parseMidiBytes } = require('./midi-map.cjs');

test('note-on with velocity fires, note-off does not', () => {
  assert.equal(isTriggeringMidiNote('note_on', 127, 127), true);
  assert.equal(isTriggeringMidiNote('note_on', 0, 0), false);
  assert.equal(isTriggeringMidiNote('note_off', 0, 0), false);
});

test('parses note-on and treats zero velocity as note-off', () => {
  assert.deepEqual(parseMidiBytes(0x90, 36, 127), {
    midiType: 'note_on',
    channel: 0,
    data1: 36,
    data2: 127,
    note: 36,
    velocity: 127,
  });
  assert.equal(parseMidiBytes(0x90, 36, 0).midiType, 'note_off');
});
