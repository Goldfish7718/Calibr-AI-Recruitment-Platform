"use server";

import { Question } from "@/utils/interview";
import { generateIdealAnswer } from "@/utils/interview";
import { connectToDatabase } from "@/utils/connectDb";
import InterviewChunkModel from "@/models/interviewChunk.model";
import { S3Service } from "@/lib/s3Service";

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
 * Generate TTS audio and upload to S3
 */
export async function generateAndUploadTTSAudio(
  text: string,
  questionId: string,
  interviewId: string,
  interviewType: "technical" | "hr"
): Promise<string | null> {
  try {
    // Call TTS API to generate audio
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/generate-audio`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!response.ok) {
      throw new Error(`TTS API failed: ${response.status}`);
    }

    const audioBlob = await response.blob();
    
    // Convert blob to buffer
    const arrayBuffer = await audioBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate S3 key: interviews/{interviewType}/{interviewId}/audio/{questionId}.mp3
    const s3Key = `interviews/${interviewType}/${interviewId}/audio/${questionId}.mp3`;

    // Upload to S3
    const audioUrl = await S3Service.uploadObject(
      s3Key,
      buffer,
      "audio/mpeg",
      {
        interviewId,
        interviewType,
        questionId,
        generatedAt: new Date().toISOString(),
      }
    );

    console.log(`[TTS] Uploaded audio for question ${questionId} to S3: ${audioUrl}`);
    return audioUrl;
  } catch (error) {
    console.error(`[TTS] Failed to generate/upload audio for question ${questionId}:`, error);
    return null;
  }
}

/**
 * Generate TTS audio for multiple questions (batch) and upload to S3
 */
export async function generateBatchTTSAudio(
  questions: { id: string; text: string }[],
  interviewId: string,
  interviewType: "technical" | "hr"
): Promise<Map<string, string>> {
  const audioUrls = new Map<string, string>();

  for (const question of questions) {
    try {
      const audioUrl = await generateAndUploadTTSAudio(
        question.text,
        question.id,
        interviewId,
        interviewType
      );

      if (audioUrl) {
        audioUrls.set(question.id, audioUrl);
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
 * Store preprocessed chunk data in MongoDB
 */
export async function storePreprocessedChunk(
  interviewId: string,
  chunkNumber: number,
  questions: Question[],
  audioUrls: Map<string, string>,
  interviewType: "technical" | "hr" = "technical"
): Promise<{ success: boolean; error?: string }> {
  try {
  await connectToDatabase();

    // Map audio URLs to questions
    const questionsWithAudio = questions.map((q) => ({
      ...q,
      audioUrl: audioUrls.get(q.id) || undefined,
    }));

    // Upsert chunk (update if exists, create if not)
    await InterviewChunkModel.findOneAndUpdate(
      {
        interviewId,
        chunkNumber,
      },
      {
        interviewId,
        interviewType,
        chunkNumber,
        questions: questionsWithAudio,
        preprocessedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
      }
    );

    console.log(
      `[Server] Stored preprocessed chunk ${chunkNumber} for interview ${interviewId}`
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
 * Retrieve preprocessed chunk data from MongoDB
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
  await connectToDatabase();

    const chunk = await InterviewChunkModel.findOne({
      interviewId,
      chunkNumber,
    });

    if (!chunk) {
      console.log(
        `[Server] Chunk ${chunkNumber} not found for interview ${interviewId}`
      );
      return {
        success: false,
        error: "Chunk not preprocessed yet",
      };
    }

    // Extract audio URLs from questions
    const audioUrls = new Map<string, string>();
  chunk.questions.forEach((q: Question) => {
      if (q.audioUrl) {
        audioUrls.set(q.id, q.audioUrl);
      }
    });

    console.log(
      `[Server] Retrieved preprocessed chunk ${chunkNumber} for interview ${interviewId}`
    );

    return {
      success: true,
      questions: chunk.questions as Question[],
      audioUrls,
    };
  } catch (error: any) {
    console.error("Error retrieving preprocessed chunk:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete all chunks for an interview (cleanup)
 */
export async function deleteInterviewChunks(
  interviewId: string
): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
  try {
  await connectToDatabase();

    // Get all chunks to delete their S3 audio files
    const chunks = await InterviewChunkModel.find({ interviewId });

    // Delete audio files from S3
    for (const chunk of chunks) {
      for (const question of chunk.questions) {
        if (question.audioUrl) {
          try {
            // Extract S3 key from URL
            const url = new URL(question.audioUrl);
            const s3Key = url.pathname.substring(1); // Remove leading '/'
            await S3Service.deleteObject(s3Key);
          } catch (error) {
            console.error(`Failed to delete S3 audio for question ${question.id}:`, error);
          }
        }
      }
    }

    // Delete chunks from database
    const result = await InterviewChunkModel.deleteMany({ interviewId });

    console.log(
      `[Server] Deleted ${result.deletedCount} chunks for interview ${interviewId}`
    );

    return {
      success: true,
      deletedCount: result.deletedCount,
    };
  } catch (error: any) {
    console.error("Error deleting interview chunks:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all chunks for an interview
 */
export async function getAllInterviewChunks(
  interviewId: string
): Promise<{
  success: boolean;
  chunks?: Array<{
    chunkNumber: number;
    questions: Question[];
    audioUrls: Map<string, string>;
  }>;
  error?: string;
}> {
  try {
  await connectToDatabase();

    const chunks = await InterviewChunkModel.find({ interviewId }).sort({
      chunkNumber: 1,
    });

    const formattedChunks = chunks.map((chunk) => {
      const audioUrls = new Map<string, string>();
  chunk.questions.forEach((q: Question) => {
        if ((q as any).audioUrl) {
          audioUrls.set(q.id, (q as any).audioUrl);
        }
      });

      return {
        chunkNumber: chunk.chunkNumber,
        questions: chunk.questions as Question[],
        audioUrls,
      };
    });

    return {
      success: true,
      chunks: formattedChunks,
    };
  } catch (error: any) {
    console.error("Error retrieving all chunks:", error);
    return { success: false, error: error.message };
  }
}
