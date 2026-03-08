import { computed, onBeforeUnmount, ref } from 'vue';
import { transcribeAudioBlob } from '../services/transcription';

export type VoiceInputState = 'idle' | 'recording' | 'transcribing' | 'ready_with_text';

interface UseUnifiedVoiceInputOptions {
  language?: string;
  onTextReady: (text: string) => void;
}

const DEFAULT_WAVE = [9, 14, 10, 16, 11];

function mergeDraftText(currentText: string, transcribedText: string) {
  return [currentText.trim(), transcribedText.trim()]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useUnifiedVoiceInput(options: UseUnifiedVoiceInputOptions) {
  const state = ref<VoiceInputState>('idle');
  const errorMessage = ref('');
  const waveformBars = ref<number[]>([...DEFAULT_WAVE]);

  const hasMediaApi =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';

  const isSupported = computed(() => hasMediaApi);
  const isRecording = computed(() => state.value === 'recording');
  const isTranscribing = computed(() => state.value === 'transcribing');

  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let animationFrameId = 0;
  let analyserNode: AnalyserNode | null = null;
  let hasReadyText = false;

  function resetVisualizer() {
    waveformBars.value = [...DEFAULT_WAVE];
  }

  function cleanupAudioGraph() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }
    analyserNode = null;
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }
    mediaRecorder = null;
    resetVisualizer();
  }

  function updateWaveform() {
    if (!analyserNode || !isRecording.value) {
      resetVisualizer();
      return;
    }
    const samples = new Uint8Array(analyserNode.fftSize);
    analyserNode.getByteTimeDomainData(samples);
    let total = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i] ?? 128;
      total += Math.abs(value - 128);
    }
    const normalized = Math.min(1, total / (samples.length * 38));
    const minHeight = 8;
    const maxHeight = 22;
    waveformBars.value = waveformBars.value.map((_, index) => {
      const spread = (index % 2 === 0 ? 0.82 : 1.05) * normalized;
      return Math.round(minHeight + (maxHeight - minHeight) * spread);
    });
    animationFrameId = requestAnimationFrame(updateWaveform);
  }

  async function startRecording() {
    if (!isSupported.value) {
      errorMessage.value = 'Голосовой ввод недоступен в этом браузере.';
      return;
    }
    if (state.value === 'recording' || state.value === 'transcribing') return;

    hasReadyText = false;
    errorMessage.value = '';
    cleanupAudioGraph();

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const supportedType = preferredTypes.find((type) => {
        try {
          return MediaRecorder.isTypeSupported(type);
        } catch {
          return false;
        }
      });
      mediaRecorder = supportedType
        ? new MediaRecorder(mediaStream, { mimeType: supportedType })
        : new MediaRecorder(mediaStream);

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);

      mediaRecorder.start(220);
      state.value = 'recording';
      updateWaveform();
    } catch {
      cleanupAudioGraph();
      state.value = 'idle';
      errorMessage.value = 'Не удалось включить микрофон.';
    }
  }

  async function finishRecording() {
    if (state.value !== 'recording' || !mediaRecorder) return;

    const recorder = mediaRecorder;
    const chunks: BlobPart[] = [];
    state.value = 'transcribing';
    errorMessage.value = '';

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => reject(new Error('record_error'));
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.stop();
    }).catch(() => null);

    cleanupAudioGraph();

    if (!blob || blob.size === 0) {
      state.value = 'idle';
      errorMessage.value = 'Не удалось записать аудио.';
      return;
    }

    try {
      const transcript = await transcribeAudioBlob(blob, {
        language: options.language || 'ru',
        filename: 'voice-input.webm',
      });
      if (!transcript) {
        throw new Error('empty_transcript');
      }
      options.onTextReady(transcript);
      state.value = 'ready_with_text';
      hasReadyText = true;
      errorMessage.value = '';
    } catch (error) {
      state.value = 'idle';
      const message = error instanceof Error ? error.message.trim() : '';
      errorMessage.value = message || 'Не удалось расшифровать запись.';
    }
  }

  function cancelRecording() {
    if (state.value === 'recording' && mediaRecorder) {
      mediaRecorder.stop();
    }
    cleanupAudioGraph();
    errorMessage.value = '';
    state.value = hasReadyText ? 'ready_with_text' : 'idle';
  }

  function markTextConsumed() {
    hasReadyText = false;
    if (state.value === 'ready_with_text') {
      state.value = 'idle';
    }
  }

  function mergeWithCurrentDraft(currentDraft: string, transcript: string) {
    return mergeDraftText(currentDraft, transcript);
  }

  onBeforeUnmount(() => {
    cleanupAudioGraph();
  });

  return {
    state,
    errorMessage,
    waveformBars,
    isSupported,
    isRecording,
    isTranscribing,
    startRecording,
    finishRecording,
    cancelRecording,
    markTextConsumed,
    mergeWithCurrentDraft,
  };
}
