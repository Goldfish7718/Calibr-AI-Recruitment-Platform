/**
 * React Hook for Chunk Management
 * Manages interview chunking with background preprocessing
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Queues } from './types';
import type { ChunkState, ChunkData } from './chunkManager';
import {
  initializeChunkState,
  getCurrentChunk,
  getNextChunkToPreprocess,
  markChunkStarted,
  markChunkPreprocessed,
  moveToNextChunk,
  isChunkReady,
  shouldPreprocessNextChunk,
  getPreprocessingProgress,
  calculateSavedCosts,
} from './chunkManager';
import { preprocessChunkServer } from '@/app/assessment/technical-interview/chunkActions';

export interface UseChunkManagerOptions {
  interviewId: string;
  queues: Queues;
  enabled?: boolean; // Enable/disable chunking
}

export interface UseChunkManagerReturn {
  chunkState: ChunkState;
  currentChunk: ChunkData | null;
  isCurrentChunkReady: boolean;
  preprocessingProgress: {
    total: number;
    preprocessed: number;
    percentage: number;
  };
  startChunk: (chunkNumber: number) => void;
  moveToNext: () => boolean;
  endInterview: () => void;
  getSavedCosts: () => {
    totalChunks: number;
    processedChunks: number;
    skippedChunks: number;
    savedPercentage: number;
  };
}

/**
 * Hook to manage interview chunks with background preprocessing
 * @param options - Configuration options
 * @param options.interviewId - Interview ID (reserved for future use: analytics, logging, storage)
 * @param options.queues - Interview queues to chunk
 * @param options.enabled - Enable/disable chunking (default: true)
 */
export function useChunkManager({
  //interviewId: _interviewId,
  queues,
  enabled = true,
}: UseChunkManagerOptions): UseChunkManagerReturn {
  const [chunkState, setChunkState] = useState<ChunkState>(() => 
    initializeChunkState(queues)
  );
  
  const preprocessingInProgress = useRef(false);
  const mountedRef = useRef(true);

  // Get current chunk
  const currentChunk = getCurrentChunk(chunkState);
  const isCurrentChunkReady = isChunkReady(currentChunk);

  /**
   * Preprocess a chunk in the background
   */
  const preprocessChunk = useCallback(async (chunk: ChunkData) => {
    if (!enabled || preprocessingInProgress.current) return;
    
    preprocessingInProgress.current = true;
    setChunkState(prev => ({ ...prev, preprocessingInProgress: true }));

    console.log(`[useChunkManager] Starting background preprocessing for Chunk ${chunk.chunkNumber}`);

    try {
      // Server-side preprocessing (ideal answers + source URLs)
      const result = await preprocessChunkServer(chunk.questions, chunk.chunkNumber);
      
      if (!mountedRef.current) return;

      if (result.success) {
        console.log(`[useChunkManager] Chunk ${chunk.chunkNumber} preprocessed successfully`);
        console.log(`Duration: ${result.duration}ms, Questions: ${result.questionsProcessed}`);
        
        // Mark chunk as preprocessed
        setChunkState(prev => {
          markChunkPreprocessed(prev, chunk.chunkNumber);
          return { ...prev, preprocessingInProgress: false };
        });
      } else {
        console.error(`[useChunkManager] Chunk ${chunk.chunkNumber} preprocessing failed:`, result.error);
        setChunkState(prev => ({ ...prev, preprocessingInProgress: false }));
      }
    } catch (error) {
      console.error('[useChunkManager] Preprocessing error:', error);
      if (mountedRef.current) {
        setChunkState(prev => ({ ...prev, preprocessingInProgress: false }));
      }
    } finally {
      preprocessingInProgress.current = false;
    }
  }, [enabled]);

  /**
   * Start a chunk (mark as started and trigger next chunk preprocessing)
   */
  const startChunk = useCallback((chunkNumber: number) => {
    setChunkState(prev => {
      markChunkStarted(prev, chunkNumber);
      return { ...prev };
    });

    // Trigger next chunk preprocessing if needed
    if (shouldPreprocessNextChunk(chunkState)) {
      const nextChunk = getNextChunkToPreprocess(chunkState);
      if (nextChunk) {
        console.log(`[useChunkManager] Triggering background preprocessing for Chunk ${nextChunk.chunkNumber}`);
        preprocessChunk(nextChunk);
      }
    }
  }, [chunkState, preprocessChunk]);

  /**
   * Move to next chunk
   */
  const moveToNext = useCallback(() => {
    let moved = false;
    setChunkState(prev => {
      moved = moveToNextChunk(prev);
      return { ...prev };
    });
    
    if (moved) {
      // Start the new chunk
      startChunk(chunkState.currentChunk + 1);
    }
    
    return moved;
  }, [chunkState.currentChunk, startChunk]);

  /**
   * End interview (stop all preprocessing)
   */
  const endInterview = useCallback(() => {
    setChunkState(prev => ({ ...prev, interviewEnded: true, preprocessingInProgress: false }));
    preprocessingInProgress.current = false;
    
    const savedCosts = calculateSavedCosts(chunkState);
    console.log('[useChunkManager] Interview ended early');
    console.log(`Saved costs: ${savedCosts.savedPercentage.toFixed(1)}% (${savedCosts.skippedChunks}/${savedCosts.totalChunks} chunks not processed)`);
  }, [chunkState]);

  /**
   * Get saved costs from early termination
   */
  const getSavedCosts = useCallback(() => {
    return calculateSavedCosts(chunkState);
  }, [chunkState]);

  /**
   * Get preprocessing progress
   */
  const preprocessingProgress = getPreprocessingProgress(chunkState);

  /**
   * Initialize: Preprocess Chunk 1 immediately
   */
  useEffect(() => {
    if (!enabled) return;
    
    const chunk1 = chunkState.chunks[0];
    if (chunk1 && !chunk1.preprocessed && !preprocessingInProgress.current) {
      console.log('[useChunkManager] Initializing: preprocessing Chunk 1');
      preprocessChunk(chunk1);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [enabled]); // Only run on mount

  /**
   * Auto-trigger next chunk preprocessing when current chunk starts
   */
  useEffect(() => {
    if (!enabled || chunkState.interviewEnded) return;

    if (shouldPreprocessNextChunk(chunkState)) {
      const nextChunk = getNextChunkToPreprocess(chunkState);
      if (nextChunk) {
        console.log(`[useChunkManager] Auto-triggering preprocessing for Chunk ${nextChunk.chunkNumber}`);
        preprocessChunk(nextChunk);
      }
    }
  }, [chunkState.currentChunk, enabled, chunkState.interviewEnded, preprocessChunk]);

  return {
    chunkState,
    currentChunk,
    isCurrentChunkReady,
    preprocessingProgress,
    startChunk,
    moveToNext,
    endInterview,
    getSavedCosts,
  };
}
