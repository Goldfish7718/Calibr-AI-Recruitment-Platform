"use server";

import { Question } from "@/utils/interview";
import { generateIdealAnswer } from "@/utils/interview";

export interface ChunkPreprocessingResult {
  success: boolean;
  chunkNumber: number;
  questionsProcessed: number;
  error?: string;
  duration?: number;
}

/**
 * Preprocess a chunk on the server side
 * Generates ideal answers and source URLs for all technical questions
 */
export async function preprocessChunkServer(
  questions: Question[],
  chunkNumber: number
): Promise<ChunkPreprocessingResult> {
  const startTime = Date.now();

  try {
    console.log(
      `[Server] Preprocessing Chunk ${chunkNumber} with ${questions.length} questions`
    );

    let processedCount = 0;

    // Process each question
    for (const question of questions) {
      if (question.category === "technical" && !question.answer) {
        try {
          const idealAnswerData = await generateIdealAnswer(question.question);

          if (idealAnswerData) {
            question.answer = idealAnswerData.ideal_answer;
            (question as any).source_urls = idealAnswerData.source_urls;
            processedCount++;
          }
        } catch (error) {
          console.error(`Error preprocessing question ${question.id}:`, error);
          // Continue with next question
        }
      }
    }

    const duration = Date.now() - startTime;

    return {
      success: true,
      chunkNumber,
      questionsProcessed: processedCount,
      duration,
    };
  } catch (error: any) {
    console.error(`Chunk ${chunkNumber} preprocessing failed:`, error);
    return {
      success: false,
      chunkNumber,
      questionsProcessed: 0,
      error: error.message || "Preprocessing failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Generate TTS audio for multiple questions (batch)
 */
export async function generateBatchTTSAudio(
  questions: { id: string; text: string }[]
): Promise<Map<string, string>> {
  const audioUrls = new Map<string, string>();

  for (const question of questions) {
    try {
      // Call TTS API
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/generate-audio`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: question.text }),
        }
      );

      if (response.ok) {
        //const _audioBlob = await response.blob();
        // In production, upload to S3 and get URL
        // For now, we'll use a placeholder
        audioUrls.set(question.id, `audio://${question.id}`);
      }
    } catch (error) {
      console.error(
        `TTS generation failed for question ${question.id}:`,
        error
      );
    }
  }

  return audioUrls;
}

/**
 * Store preprocessed chunk data in database/cache
 */
export async function storePreprocessedChunk(
  interviewId: string,
  chunkNumber: number,
  questions: Question[],
  audioUrls: Map<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    // TODO: Store in database or cache (Redis, MongoDB, etc.)
    // For now, we'll just log it
    console.log(
      `[Server] Storing preprocessed chunk ${chunkNumber} for interview ${interviewId}`
    );
    console.log(
      `Questions: ${questions.length}, Audio URLs: ${audioUrls.size}`
    );

    return { success: true };
  } catch (error: any) {
    console.error("Error storing preprocessed chunk:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Retrieve preprocessed chunk data from database/cache
 */
export async function getPreprocessedChunk(
  interviewId: string,
  chunkNumber: number
): Promise<{
  success: boolean;
  questions?: Question[];
  audioUrls?: Map<string, string>;
  error?: string;
}> {
  try {
    // TODO: Retrieve from database or cache
    console.log(
      `[Server] Retrieving preprocessed chunk ${chunkNumber} for interview ${interviewId}`
    );

    return { success: true, questions: [], audioUrls: new Map() };
  } catch (error: any) {
    console.error("Error retrieving preprocessed chunk:", error);
    return { success: false, error: error.message };
  }
}
