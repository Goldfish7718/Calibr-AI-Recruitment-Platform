/**
 * UNIFIED Chunk Manager - Splits questions into chunks
 * All chunking logic in ONE place
 * 
 * IMPORTANT: Queue2 questions are follow-ups for Queue1 questions.
 * They must be grouped with their parent Queue1 question.
 */

import type { Question } from "@/utils/interview";

export interface ChunkData {
  chunkNumber: number;
  questions: Question[];
}

/**
 * Interleaves queue1 questions with their queue2 follow-ups
 * @param queue1 - Main technical questions with answers
 * @param queue2 - Deep-dive follow-up questions
 * @returns Properly ordered array with queue1 questions followed by their follow-ups
 */
export function interleaveQueues(queue1: Question[], queue2: Question[]): Question[] {
  const interleavedQuestions: Question[] = [];
  
  // Group queue2 questions by their parent question (topicId)
  const followUpMap = new Map<string, Question[]>();
  
  for (const q2 of queue2) {
    if (q2.topicId) {
      if (!followUpMap.has(q2.topicId)) {
        followUpMap.set(q2.topicId, []);
      }
      followUpMap.get(q2.topicId)!.push(q2);
    }
  }
  
  // For each queue1 question, add it and its follow-ups
  for (const q1 of queue1) {
    // Add the main question
    interleavedQuestions.push(q1);
    
    // Add its follow-ups (if any)
    if (q1.topicId && followUpMap.has(q1.topicId)) {
      const followUps = followUpMap.get(q1.topicId)!;
      interleavedQuestions.push(...followUps);
    }
  }
  
  return interleavedQuestions;
}

/**
 * Split questions into chunks of specified size
 * @param questions - All questions to split (should be interleaved queue1 + queue2)
 * @param chunkSize - Questions per chunk (default: 5)
 * @returns Array of chunks
 */
export function splitIntoChunks(
  questions: Question[],
  chunkSize: number = 5
): ChunkData[] {
  const totalChunks = Math.ceil(questions.length / chunkSize);
  const chunks: ChunkData[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, questions.length);
    const chunkQuestions = questions.slice(start, end);

    chunks.push({
      chunkNumber: i,
      questions: chunkQuestions,
    });
  }

  return chunks;
}

/**
 * Legacy wrapper for backwards compatibility
 * @deprecated Use splitIntoChunks directly
 */
export function createChunkManager(
  questions: Question[],
  chunkSize: number = 5
) {
  const chunks = splitIntoChunks(questions, chunkSize);
  
  return {
    getTotalChunks: () => chunks.length,
    getChunk: (index: number) => {
      if (index < 0 || index >= chunks.length) {
        throw new Error(`Chunk index ${index} out of bounds`);
      }
      return chunks[index];
    },
    getCurrentChunkIndex: () => 0,
  };
}
