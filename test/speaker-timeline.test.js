import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/ui/speaker-timeline.js';

const { speakersForTrack, speakerAt, nextSpeaker, markerPositions, estimatedDuration, parseDuration } = globalThis.SpeakerTimeline;
const recording = { speakers: [
  { name: 'Second speaker', offset: 60, fileIndex: 0, durationSeconds: 20 },
  { name: 'Other track', offset: 10, fileIndex: 1 },
  { name: 'First speaker', offset: 15, fileIndex: 0, durationSeconds: 25 },
  { name: 'Last speaker', offset: 90, fileIndex: 0 }
] };

test('speaker box follows the current track and the audio timeline', () => {
  const speakers = speakersForTrack(recording, 0);
  assert.deepEqual(speakers.map(item => item.name), ['First speaker', 'Second speaker', 'Last speaker']);
  assert.equal(speakerAt(speakers, 0), null);
  assert.equal(nextSpeaker(speakers, 0).name, 'First speaker');
  assert.equal(speakerAt(speakers, 15).name, 'First speaker');
  assert.equal(speakerAt(speakers, 39).name, 'First speaker');
  assert.equal(speakerAt(speakers, 40), null);
  assert.equal(speakerAt(speakers, 60).name, 'Second speaker');
  assert.equal(speakerAt(speakers, 80), null);
  assert.equal(speakerAt(speakers, 90).name, 'Last speaker');
  assert.equal(speakersForTrack(recording, 1)[0].name, 'Other track');
});

test('speaker markers use track duration and discard out-of-range points', () => {
  const markers = markerPositions(speakersForTrack(recording, 0), 80);
  assert.deepEqual(markers.map(item => item.percent), [18.75, 75]);
  assert.deepEqual(markerPositions(recording.speakers, Infinity), []);
  assert.equal(estimatedDuration(speakersForTrack(recording, 0)), 80);
  assert.equal(estimatedDuration(speakersForTrack(recording, 1)), null);
  assert.equal(parseDuration('1:20:05'), 4805);
  assert.equal(parseDuration('12:34'), 754);
  assert.equal(parseDuration('unknown'), null);
});
