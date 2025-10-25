/**
 * Media Utilities for Technical Interview
 * Handles audio/video recording and media streams only
 */

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