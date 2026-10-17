(function (root) {
  function speakersForTrack(recording, trackIndex) {
    return (recording?.speakers || [])
      .filter(item => Number(item.fileIndex ?? 0) === trackIndex && Number.isFinite(Number(item.offset)) && Number(item.offset) >= 0 && item.name)
      .sort((a, b) => Number(a.offset) - Number(b.offset));
  }

  function speakerAt(speakers, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    let current = null;
    for (const speaker of speakers) {
      if (Number(speaker.offset) > seconds) break;
      current = speaker;
    }
    if (!current) return null;
    const length = Number(current.durationSeconds);
    return Number.isFinite(length) && length > 0 && seconds >= Number(current.offset) + length ? null : current;
  }

  function nextSpeaker(speakers, seconds) {
    return speakers.find(item => Number(item.offset) > seconds) || null;
  }

  function markerPositions(speakers, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return [];
    return speakers.filter(item => Number(item.offset) <= duration).map(item => ({ speaker: item, percent: Math.min(100, Math.max(0, Number(item.offset) / duration * 100)) }));
  }

  function estimatedDuration(speakers) {
    const ends = speakers.filter(item => Number(item.durationSeconds) > 0)
      .map(item => Number(item.offset) + Number(item.durationSeconds))
      .filter(value => Number.isFinite(value) && value > 0);
    return ends.length ? Math.max(...ends) : null;
  }

  function parseDuration(value) {
    const text = String(value || '').trim();
    const colon = text.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
    if (colon) return colon[3] === undefined ? Number(colon[1]) * 60 + Number(colon[2]) : Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
    return null;
  }

  root.SpeakerTimeline = { speakersForTrack, speakerAt, nextSpeaker, markerPositions, estimatedDuration, parseDuration };
})(typeof window === 'undefined' ? globalThis : window);
