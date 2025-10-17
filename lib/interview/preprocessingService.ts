/**
 * Chunk Preprocessing Service
 * Handles background preprocessing of interview chunks
 */

import type { ChunkData } from "./chunkManager";
import { generateIdealAnswer } from "@/utils/interview";

export interface PreprocessingResult {
  success: boolean;
  chunkNumber: number;
  audioUrls?: Map<string, string>;
  error?: string;
  duration?: number; // milliseconds
}

/**
 * Preprocess a single chunk: generate ideal answers and TTS audio
 * @param chunk - The chunk to preprocess
 * @param _interviewId - Interview ID (reserved for future use: S3 uploads, database storage)
 */
export async function preprocessChunk(
  chunk: ChunkData,
 // _interviewId: string
): Promise<PreprocessingResult> {
  const startTime = Date.now();

  try {
    console.log(
      `[Chunk ${chunk.chunkNumber}] Starting preprocessing for ${chunk.questions.length} questions`
    );

    const audioUrls = new Map<string, string>();

    // Process each question in the chunk
    for (const question of chunk.questions) {
      try {
        // Step 1: Generate ideal answer + source URLs (if technical and missing)
        if (question.category === "technical" && !question.answer) {
          console.log(
            `[Chunk ${
              chunk.chunkNumber
            }] Generating ideal answer for: ${question.question.substring(
              0,
              50
            )}...`
          );
          const idealAnswerData = await generateIdealAnswer(question.question);

          if (idealAnswerData) {
            question.answer = idealAnswerData.ideal_answer;
            (question as any).source_urls = idealAnswerData.source_urls;
          }
        }

        // Step 2: Generate TTS audio for question
        console.log(
          `[Chunk ${
            chunk.chunkNumber
          }] Generating TTS for: ${question.question.substring(0, 50)}...`
        );
        const audioUrl = await generateTTSAudio(question.question);

        if (audioUrl) {
          audioUrls.set(question.id, audioUrl);
        }
      } catch (error) {
        console.error(
          `[Chunk ${chunk.chunkNumber}] Error preprocessing question ${question.id}:`,
          error
        );
        // Continue with other questions even if one fails
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[Chunk ${chunk.chunkNumber}] Preprocessing completed in ${duration}ms`
    );

    return {
      success: true,
      chunkNumber: chunk.chunkNumber,
      audioUrls,
      duration,
    };
  } catch (error: any) {
    console.error(`[Chunk ${chunk.chunkNumber}] Preprocessing failed:`, error);
    return {
      success: false,
      chunkNumber: chunk.chunkNumber,
      error: error.message || "Preprocessing failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Generate TTS audio and return URL/path
 * Uses the existing /api/generate-audio endpoint
 */
async function generateTTSAudio(text: string): Promise<string | null> {
  try {
    const response = await fetch("/api/generate-audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`TTS API failed: ${response.status}`);
    }

    // Get audio blob
    const audioBlob = await response.blob();

    // In a real implementation, you'd upload this to S3/CDN
    // For now, we'll create a blob URL (client-side only)
    // TODO: Implement S3 upload for server-side storage
    const audioUrl = URL.createObjectURL(audioBlob);

    return audioUrl;
  } catch (error) {
    console.error("TTS generation failed:", error);
    return null;
  }
}

/**
 * Preprocess chunk in background (non-blocking)
 * @param chunk - The chunk to preprocess
 * @param _interviewId - Interview ID (reserved for future use)
 * @param onComplete - Callback when preprocessing completes
 */
export function preprocessChunkInBackground(
  chunk: ChunkData,
  _interviewId: string,
  onComplete: (result: PreprocessingResult) => void
): void {
  // Start preprocessing asynchronously
  preprocessChunk(chunk)
    .then(onComplete)
    .catch((error) => {
      console.error("Background preprocessing error:", error);
      onComplete({
        success: false,
        chunkNumber: chunk.chunkNumber,
        error: error.message,
      });
    });
}

/**
 * Batch preprocess multiple chunks sequentially
 * @param chunks - Array of chunks to preprocess
 * @param _interviewId - Interview ID (reserved for future use)
 * @param onProgress - Optional progress callback
 */
export async function batchPreprocessChunks(
  chunks: ChunkData[],
  _interviewId: string,
  onProgress?: (completed: number, total: number) => void
): Promise<PreprocessingResult[]> {
  const results: PreprocessingResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
  //  const result = await preprocessChunk(chunks[i], _interviewId);
   const result = await preprocessChunk(chunks[i],);
    results.push(result);

    if (onProgress) {
      onProgress(i + 1, chunks.length);
    }
  }

  return results;
}

/**
 * Cancel ongoing preprocessing (for early termination)
 */
export function cancelPreprocessing(chunkNumber: number): void {
  console.log(
    `[Chunk ${chunkNumber}] Preprocessing cancelled (early termination)`
  );
  // In a real implementation, this would abort ongoing API calls
  // For now, we just log it
}
