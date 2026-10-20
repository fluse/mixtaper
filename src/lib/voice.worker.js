import { transformVoice } from './voiceshift';

self.onmessage = (e) => {
  const { id, data, sampleRate, settings } = e.data;
  try {
    const out = transformVoice(data, sampleRate, settings);
    self.postMessage({ id, data: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
