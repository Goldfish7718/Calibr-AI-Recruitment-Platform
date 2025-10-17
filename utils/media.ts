/**
 * Media Utilities for Technical Interview
 * Handles TTS, audio recording, speech recognition, and media streams
 */

// Minimal typings for Web Speech API
declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export interface SpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
}

/**
 * Convert text to audio URL using TTS API
 */
export async function ttsToAudioUrl(text: string): Promise<string> {
  const res = await fetch("/api/generate-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("TTS request failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Get microphone stream (audio only)
 */
export async function getMicStreamAudioOnly(): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

/**
 * Get microphone and camera stream
 */
export async function getMicAndCameraStream(): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
}

/**
 * Revoke object URL to free memory
 */
export function revokeObjectUrl(url: string | null) {
  if (url) URL.revokeObjectURL(url);
}

/**
 * Initialize speech recognition
 */
export function initializeSpeechRecognition(
  language: string = "en-US",
  onResult: (transcript: string) => void,
  onError?: (error: any) => void
): SpeechRecognition | null {
  if (typeof window !== "undefined" && "webkitSpeechRecognition" in window) {
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        onResult(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (onError) onError(event);
    };

    return recognition;
  }
  return null;
}

/**
 * Start audio recording
 */
export async function startAudioRecording(
  onDataAvailable?: (blob: Blob) => void
): Promise<{ mediaRecorder: MediaRecorder; stream: MediaStream }> {
  const stream = await getMicStreamAudioOnly();
  const mediaRecorder = new MediaRecorder(stream);
  const audioChunks: Blob[] = [];

  mediaRecorder.ondataavailable = (event) => {
    audioChunks.push(event.data);
  };

  mediaRecorder.onstop = () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
    if (onDataAvailable) onDataAvailable(audioBlob);
  };

  mediaRecorder.start();
  return { mediaRecorder, stream };
}

/**
 * Stop all tracks in a media stream
 */
export function stopMediaStream(stream: MediaStream | null) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Toggle mute on audio tracks
 */
export function toggleAudioMute(stream: MediaStream | null, muted: boolean): boolean {
  if (stream) {
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach((track) => {
      track.enabled = !muted;
    });
    return !muted;
  }
  return muted;
}

/**
 * Stop audio playback and cleanup
 */
export function stopAudioPlayback(
  audioElement: HTMLAudioElement | null,
  audioUrl: string | null
): void {
  try {
    if (audioElement) {
      audioElement.pause();
      audioElement.src = "";
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Play audio from URL
 */
export async function playAudio(
  url: string,
  onEnded?: () => void
): Promise<HTMLAudioElement> {
  const audio = new Audio(url);
  if (onEnded) {
    audio.onended = onEnded;
  }
  await audio.play();
  return audio;
}


