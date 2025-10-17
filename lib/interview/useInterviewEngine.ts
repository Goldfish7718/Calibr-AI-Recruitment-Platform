"use client";

import { useMemo, useState } from "react";
import { createInterviewEngine } from "./engine";
import type { EngineAdapter, Queues, Question } from "./types";
import { useChunkManager } from "./useChunkManager";

export interface UseInterviewEngineOptions {
  adapter: EngineAdapter;
  useVideoProcessing?: boolean;
  enableChunking?: boolean; // Enable chunking/batching
  interviewId?: string; // Required if chunking enabled
}

export function useInterviewEngine(
  adapterOrOptions: EngineAdapter | UseInterviewEngineOptions,
  useVideoProcessing: boolean = false
) {
  // Handle both old and new API
  const options = typeof adapterOrOptions === 'object' && 'adapter' in adapterOrOptions
    ? adapterOrOptions
    : { adapter: adapterOrOptions, useVideoProcessing, enableChunking: false };

  const { adapter, enableChunking = false, interviewId = '' } = options;
  const videoProcessing = options.useVideoProcessing ?? useVideoProcessing;

  const engine = useMemo(() => createInterviewEngine(adapter, videoProcessing), [adapter, videoProcessing]);
  const [queues, setQueuesState] = useState<Queues>(engine.state.queues);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(engine.state.currentQuestion);
  const [stats, setStats] = useState(engine.state.stats);

  // Initialize chunk manager if chunking enabled
  const chunkManager = useChunkManager({
    interviewId,
    queues,
    enabled: enableChunking,
  });

  const sync = () => {
    setQueuesState({ ...engine.state.queues });
    setCurrentQuestion(engine.state.currentQuestion);
    
    // Update stats with chunk info
    const updatedStats = { ...engine.state.stats };
    if (enableChunking) {
      updatedStats.currentChunk = chunkManager.chunkState.currentChunk;
      updatedStats.totalChunks = chunkManager.chunkState.totalChunks;
      updatedStats.chunksPreprocessed = chunkManager.preprocessingProgress.preprocessed;
      updatedStats.preprocessingInProgress = chunkManager.chunkState.preprocessingInProgress;
    }
    setStats(updatedStats);
  };

  const askNext = async () => {
    const q = await engine.askNext();
    sync();
    return q;
  };

  const handleAnswer = async (
    question: string,
    correctAnswer: string,
    userAnswer: string,
    currentQuestion: Question
  ) => {
    const result = await engine.handleAnswer(question, correctAnswer, userAnswer, currentQuestion);
    sync();
    return result;
  };

  const checkQueue0 = async () => {
    const shouldEnd = await engine.checkQueue0();
    sync();
    return shouldEnd;
  };

  const setQueues = (q: Queues) => {
    engine.setQueues(q);
    sync();
  };

  const endInterview = () => {
    if (enableChunking) {
      chunkManager.endInterview();
    }
    engine.state.stats.interviewEnded = true;
    sync();
  };

  return {
    state: engine.state,
    queues,
    currentQuestion,
    stats,
    setQueues,
    askNext,
    handleAnswer,
    checkQueue0,
    endInterview,
    adapter: engine.adapter,
    // Chunking-specific
    chunkManager: enableChunking ? chunkManager : undefined,
  };
}



