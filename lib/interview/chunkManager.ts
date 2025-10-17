/**
 * Chunk Manager for Interview Batching
 * Splits interview into 5 chunks (20% each) and manages preprocessing
 */

import type { Question, Queues } from "./types";

export interface ChunkData {
  chunkNumber: number; // 1-5
  questions: Question[];
  preprocessed: boolean;
  idealAnswersGenerated: boolean;
  audioGenerated: boolean;
  audioUrls?: Map<string, string>; // questionId -> audio URL
  startedAt?: Date;
  completedAt?: Date;
}

export interface ChunkState {
  totalChunks: number; // Always 5
  currentChunk: number; // 1-5
  chunks: ChunkData[];
  interviewEnded: boolean;
  preprocessingInProgress: boolean;
}

/**
 * Split questions into 5 equal chunks (20% each)
 */
export function splitIntoChunks(queues: Queues): ChunkData[] {
  const allQuestions = [...queues.queue1, ...queues.queue2];
  const totalQuestions = allQuestions.length;
  const chunkSize = Math.ceil(totalQuestions / 5);

  const chunks: ChunkData[] = [];
  for (let i = 0; i < 5; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalQuestions);
    const chunkQuestions = allQuestions.slice(start, end);

    chunks.push({
      chunkNumber: i + 1,
      questions: chunkQuestions,
      preprocessed: false,
      idealAnswersGenerated: false,
      audioGenerated: false,
      audioUrls: new Map(),
    });
  }

  return chunks;
}

/**
 * Initialize chunk state
 */
export function initializeChunkState(queues: Queues): ChunkState {
  const chunks = splitIntoChunks(queues);
  
  return {
    totalChunks: 5,
    currentChunk: 1,
    chunks,
    interviewEnded: false,
    preprocessingInProgress: false,
  };
}

/**
 * Get current active chunk
 */
export function getCurrentChunk(state: ChunkState): ChunkData | null {
  return state.chunks.find(c => c.chunkNumber === state.currentChunk) || null;
}

/**
 * Get next chunk to preprocess
 */
export function getNextChunkToPreprocess(state: ChunkState): ChunkData | null {
  const nextChunkNumber = state.currentChunk + 1;
  if (nextChunkNumber > state.totalChunks) return null;
  
  const nextChunk = state.chunks.find(c => c.chunkNumber === nextChunkNumber);
  return nextChunk && !nextChunk.preprocessed ? nextChunk : null;
}

/**
 * Mark chunk as started
 */
export function markChunkStarted(state: ChunkState, chunkNumber: number): void {
  const chunk = state.chunks.find(c => c.chunkNumber === chunkNumber);
  if (chunk) {
    chunk.startedAt = new Date();
  }
}

/**
 * Mark chunk as preprocessed
 */
export function markChunkPreprocessed(
  state: ChunkState, 
  chunkNumber: number,
  audioUrls?: Map<string, string>
): void {
  const chunk = state.chunks.find(c => c.chunkNumber === chunkNumber);
  if (chunk) {
    chunk.preprocessed = true;
    chunk.idealAnswersGenerated = true;
    chunk.audioGenerated = true;
    chunk.completedAt = new Date();
    if (audioUrls) {
      chunk.audioUrls = audioUrls;
    }
  }
}

/**
 * Move to next chunk
 */
export function moveToNextChunk(state: ChunkState): boolean {
  if (state.currentChunk >= state.totalChunks) {
    return false;
  }
  state.currentChunk += 1;
  return true;
}

/**
 * Check if chunk is ready to use
 */
export function isChunkReady(chunk: ChunkData | null): boolean {
  return chunk?.preprocessed === true;
}

/**
 * Get preprocessing progress
 */
export function getPreprocessingProgress(state: ChunkState): {
  total: number;
  preprocessed: number;
  percentage: number;
} {
  const preprocessed = state.chunks.filter(c => c.preprocessed).length;
  return {
    total: state.totalChunks,
    preprocessed,
    percentage: (preprocessed / state.totalChunks) * 100,
  };
}

/**
 * Check if should trigger next chunk preprocessing
 */
export function shouldPreprocessNextChunk(state: ChunkState): boolean {
  // Don't preprocess if interview ended
  if (state.interviewEnded) return false;
  
  // Don't preprocess if already preprocessing
  if (state.preprocessingInProgress) return false;
  
  // Check if next chunk exists and isn't preprocessed
  const nextChunk = getNextChunkToPreprocess(state);
  return nextChunk !== null;
}

/**
 * Get all questions from preprocessed chunks up to current
 */
export function getAvailableQuestions(state: ChunkState): Question[] {
  const questions: Question[] = [];
  for (let i = 1; i <= state.currentChunk; i++) {
    const chunk = state.chunks.find(c => c.chunkNumber === i);
    if (chunk?.preprocessed) {
      questions.push(...chunk.questions);
    }
  }
  return questions;
}

/**
 * Calculate saved API costs from early termination
 */
export function calculateSavedCosts(state: ChunkState): {
  totalChunks: number;
  processedChunks: number;
  skippedChunks: number;
  savedPercentage: number;
} {
  const processedChunks = state.chunks.filter(c => c.preprocessed).length;
  const skippedChunks = state.totalChunks - processedChunks;
  
  return {
    totalChunks: state.totalChunks,
    processedChunks,
    skippedChunks,
    savedPercentage: (skippedChunks / state.totalChunks) * 100,
  };
}
