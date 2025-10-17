/**
 * Chunk Preprocessing Service
 * Handles background preprocessing of interview chunks
 */

import type { ChunkData } from "./simpleChunkManager";
import { generateIdealAnswer } from "@/utils/interview";
import {
  generateAndUploadTTSAudio,
  storePreprocessedChunk,
} from "@/app/assessment/technical-interview/chunkActions";

export interface PreprocessingResult {
  success: boolean;
  chunkNumber: number;
  audioUrls?: Map<string, string>;
  error?: string;
  duration?: number; // milliseconds
}

/**
 * Preprocess a single chunk: generate ideal answers and TTS audio, then store in DB
 * @param chunk - The chunk to preprocess
 * @param interviewId - Interview ID for S3 uploads and database storage
 * @param interviewType - Type of interview (technical or hr)
 */
export async function preprocessChunk(
  chunk: ChunkData,
  interviewId: string,
  interviewType: "technical" | "hr" = "technical"
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

        // Step 2: Generate TTS audio and upload to S3
        console.log(
          `[Chunk ${
            chunk.chunkNumber
          }] Generating and uploading TTS for: ${question.question.substring(0, 50)}...`
        );
        const audioUrl = await generateAndUploadTTSAudio(
          question.question,
          question.id,
          interviewId,
          interviewType
        );

        if (audioUrl) {
          audioUrls.set(question.id, audioUrl);
          console.log(
            `[Chunk ${chunk.chunkNumber}] ✓ Audio uploaded for question ${question.id}`
          );
        }
      } catch (error) {
        console.error(
          `[Chunk ${chunk.chunkNumber}] Error preprocessing question ${question.id}:`,
          error
        );
        // Continue with other questions even if one fails
      }
    }

    // Step 3: Store preprocessed chunk in database
    console.log(`[Chunk ${chunk.chunkNumber}] Storing in database...`);
    await storePreprocessedChunk(
      interviewId,
      chunk.chunkNumber,
      chunk.questions,
      audioUrls,
      interviewType
    );

    const duration = Date.now() - startTime;
    console.log(
      `[Chunk ${chunk.chunkNumber}] ✓ Preprocessing complete in ${duration}ms`
    );
    console.log(
      `[Chunk ${chunk.chunkNumber}] Generated ${audioUrls.size}/${chunk.questions.length} audio files`
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

// TTS generation is now handled by generateAndUploadTTSAudio in chunkActions.ts
// No need for local blob URLs - everything goes to S3

/**
 * Preprocess chunk in background (non-blocking)
 * @param chunk - The chunk to preprocess
 * @param interviewId - Interview ID for S3 uploads and database storage
 * @param interviewType - Type of interview (technical or hr)
 * @param onComplete - Callback when preprocessing completes
 */
export function preprocessChunkInBackground(
  chunk: ChunkData,
  interviewId: string,
  interviewType: "technical" | "hr",
  onComplete: (result: PreprocessingResult) => void
): void {
  // Start preprocessing asynchronously
  preprocessChunk(chunk, interviewId, interviewType)
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
 * @param interviewId - Interview ID for S3 uploads and database storage
 * @param interviewType - Type of interview (technical or hr)
 * @param onProgress - Optional progress callback
 */
export async function batchPreprocessChunks(
  chunks: ChunkData[],
  interviewId: string,
  interviewType: "technical" | "hr",
  onProgress?: (completed: number, total: number) => void
): Promise<PreprocessingResult[]> {
  const results: PreprocessingResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const result = await preprocessChunk(chunks[i], interviewId, interviewType);
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
