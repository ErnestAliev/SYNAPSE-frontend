import { apiClient } from './api';

interface TranscriptionResponse {
  text?: string;
}

interface TranscribeAudioBlobOptions {
  language?: string;
  filename?: string;
}

export async function transcribeAudioBlob(blob: Blob, options: TranscribeAudioBlobOptions = {}) {
  const language = (options.language || 'ru').trim() || 'ru';
  const contentType = blob.type || 'audio/webm';
  const fallbackExt = contentType.includes('ogg')
    ? 'ogg'
    : contentType.includes('mp4') || contentType.includes('m4a')
      ? 'm4a'
      : contentType.includes('wav')
        ? 'wav'
        : 'webm';
  const defaultName = `voice-input.${fallbackExt}`;
  const filename = (options.filename || defaultName).trim() || defaultName;

  try {
    const { data } = await apiClient.post<TranscriptionResponse>('/transcribe/file', blob, {
      headers: {
        'Content-Type': contentType,
        'X-Audio-Language': language,
        'X-Audio-Filename': filename,
      },
      timeout: 180_000,
    });

    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    return text;
  } catch (error) {
    const payload = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    const message = payload?.response?.data?.message || payload?.message || 'Не удалось расшифровать запись.';
    throw new Error(message);
  }
}
