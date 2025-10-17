"use client";
import React from "react";
/// <reference types="node" />

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle, 
  RefreshCw,
  Mic,
  MicOff,
  Volume2,
  Clock,
} from "lucide-react";
import { technicalInterviewAdapter } from "../adapter";
import VideoProcessing from "@/lib/video-processing";
import HeaderBanner from "./_components/HeaderBanner";
import SetupScreen from "./_components/SetupScreen";
import LoadingScreen from "./_components/LoadingScreen";
import type { InterviewConfig, Question } from "../types";
import { formatTime } from "@/utils/interview";
import {
  initializeSpeechRecognition,
  startAudioRecording,
  stopMediaStream,
  toggleAudioMute,
  type SpeechRecognition
} from "@/utils/media";
import { AudioPlayer } from "@/utils/audioPlayback";
import { createChunkManager, interleaveQueues, type ChunkData } from "@/lib/interview/simpleChunkManager";
import { preprocessChunk } from "@/lib/interview/preprocessingService";
import { getPreprocessedChunk } from "../chunkActions";
import { generateQuestions } from "../actions";

interface TechnicalInterviewClientProps {
  interviewId: string;
  interviewConfig: InterviewConfig;
  jobData?: {
    title: string;
    department: string;
    position: string;
    seniority: string;
    techStack: string[];
    description?: string;
    requirements?: string;
  };
  resumeData?: {
    tagline?: string;
    summary?: string;
    workDetails?: any[];
    education?: any[];
    skills?: string;
    projects?: any[];
    certificates?: any[];
  };
}

export default function TechnicalInterviewClient({ 
  interviewId,
  interviewConfig: initialConfig,
  jobData,
  resumeData
}: TechnicalInterviewClientProps) {
  const [currentScreen, setCurrentScreen] = useState<
    "setup" | "loading" | "interview" | "complete"
  >("setup");
  const [isLoading, setIsLoading] = useState(false);
  const [queues, setQueues] = useState<{
    queue1: Question[];
    queue2: Question[];
    queue3: Question[];
  }>({ queue1: [], queue2: [], queue3: [] });
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [stats, setStats] = useState({
    questionsAsked: 0,
  });

  // Chunking state
  const [chunks, setChunks] = useState<ChunkData[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [currentChunk, setCurrentChunk] = useState<ChunkData | null>(null);
  const [chunkQuestionIndex, setChunkQuestionIndex] = useState(0);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);

  // Voice and media states
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(initialConfig.duration * 60);
  const [hasConsent, setHasConsent] = useState(false);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const evaluationStartedRef = useRef<boolean>(false);
  const transcriptBufferRef = useRef<string>("");
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkManagerRef = useRef<ReturnType<typeof createChunkManager> | null>(null);
  const preprocessingNextChunkRef = useRef<boolean>(false);

  // Initialize audio player once
  useEffect(() => {
    audioPlayerRef.current = new AudioPlayer(0.8);
  }, []);

  /**
   * Play question audio from S3 URL
   */
  const playQuestionAudio = async (audioUrl: string) => {
    if (!audioPlayerRef.current) return;

    try {
      setIsSpeaking(true);
      await audioPlayerRef.current.play(audioUrl);
    } catch (error) {
      console.error("[Audio] Error playing question audio:", error);
    } finally {
      setIsSpeaking(false);
    }
  };

  /**
   * Preprocess next chunk in background
   */
  const preprocessNextChunk = async () => {
    if (preprocessingNextChunkRef.current) return;
    
    const nextChunkIndex = currentChunkIndex + 1;
    if (nextChunkIndex >= chunks.length) return;

    const nextChunk = chunks[nextChunkIndex];
    if (!nextChunk) return;

    preprocessingNextChunkRef.current = true;

    try {
      console.log(`[Chunking] Background preprocessing Chunk ${nextChunk.chunkNumber}...`);
      await preprocessChunk(nextChunk, interviewId, "technical");
      console.log(`[Chunking] ✓ Chunk ${nextChunk.chunkNumber} preprocessed successfully`);
    } catch (error) {
      console.error(`[Chunking] Failed to preprocess chunk ${nextChunk.chunkNumber}:`, error);
    } finally {
      preprocessingNextChunkRef.current = false;
    }
  };

  /**
   * Load chunk from database or use in-memory version
   */
  const loadChunk = async (chunkIndex: number): Promise<ChunkData | null> => {
    if (!chunkManagerRef.current) return null;

    try {
      // Try to get preprocessed chunk from database
      const result = await getPreprocessedChunk(interviewId, chunkIndex);
      
      if (result.success && result.questions && result.audioUrls) {
        console.log(`[Chunking] Loaded preprocessed chunk ${chunkIndex} from database`);
        
        // Update chunk with preprocessed data
        const chunk = chunkManagerRef.current.getChunk(chunkIndex);
        if (chunk) {
          chunk.questions = result.questions;
          // Audio URLs are already in questions from database
          return chunk;
        }
      }

      // Fallback to in-memory chunk
      console.log(`[Chunking] Using in-memory chunk ${chunkIndex}`);
      return chunkManagerRef.current.getChunk(chunkIndex);
    } catch (error) {
      console.error(`[Chunking] Error loading chunk ${chunkIndex}:`, error);
      return chunkManagerRef.current.getChunk(chunkIndex);
    }
  };

  const startRecording = async () => {
    try {
      const { mediaRecorder, stream } = await startAudioRecording((audioBlob) => {
        console.log("Audio recorded:", audioBlob);
      });
      
      streamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      // Start speech recognition
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.start();
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
      alert(
        "Please allow microphone and camera access to continue with the interview."
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
    }
  };

  const handleToggleMute = () => {
    const newMutedState = toggleAudioMute(streamRef.current, isMuted);
    setIsMuted(newMutedState);
  };

  const startInterview = async () => {
    if (initialConfig?.consentRequired && !hasConsent) {
      alert("Please provide consent to continue with the interview.");
      return;
    }

    setIsLoading(true);
    setCurrentScreen("loading");

    try {
      // Start media recording if required
      if (
        initialConfig?.proctoring.micRequired ||
        initialConfig?.proctoring.cameraRequired
      ) {
        await startRecording();
      }
      
      // Start evaluation document once per session
      if (!evaluationStartedRef.current) {
        await technicalInterviewAdapter.startEvaluation(interviewId);
        evaluationStartedRef.current = true;
      }

      // Generate all questions with job and resume context
      console.log("[Chunking] Generating questions with job and resume context...");
      const result = await generateQuestions({ jobData, resumeData });
      
      if (!result.success || !result.queues) {
        alert("Failed to generate questions. Please try again.");
        setCurrentScreen("setup");
        setIsLoading(false);
        return;
      }

      // Interleave queue1 questions with their queue2 follow-ups
      // This ensures each queue1 question is followed by its deep-dive questions
      console.log("[Chunking] Interleaving Queue1 and Queue2 questions...");
      const interleavedQuestions = interleaveQueues(
        result.queues.queue1,
        result.queues.queue2
      );
      
      console.log(`[Chunking] Total questions after interleaving: ${interleavedQuestions.length}`);
      console.log(`[Chunking] - Queue1 (main): ${result.queues.queue1.length}`);
      console.log(`[Chunking] - Queue2 (follow-ups): ${result.queues.queue2.length}`);

      // Create chunks (5 questions per chunk)
      console.log("[Chunking] Creating chunks (5 questions per chunk)...");
      const chunkManager = createChunkManager(interleavedQuestions, 5);
      chunkManagerRef.current = chunkManager;
      
      const totalChunks = chunkManager.getTotalChunks();
      const chunkArray: ChunkData[] = [];
      for (let i = 0; i < totalChunks; i++) {
        chunkArray.push(chunkManager.getChunk(i));
      }
      setChunks(chunkArray);
      
      console.log(`[Chunking] ✓ Created ${totalChunks} chunks with interleaved questions`);

      // Preprocess Chunk 1 immediately
      if (chunkArray.length > 0) {
        console.log("[Chunking] Preprocessing Chunk 1...");
        await preprocessChunk(chunkArray[0], interviewId, "technical");
        console.log("[Chunking] ✓ Chunk 1 preprocessed");
      }

      // Load first chunk
      const firstChunk = await loadChunk(0);
      if (!firstChunk || firstChunk.questions.length === 0) {
        alert("No questions available. Please try again.");
        setCurrentScreen("setup");
        setIsLoading(false);
        return;
      }

      setCurrentChunk(firstChunk);
      setCurrentChunkIndex(0);
      setChunkQuestionIndex(0);
      
      // Set queues for compatibility
      setQueues({
        queue1: result.queues.queue1,
        queue2: result.queues.queue2,
        queue3: result.queues.queue3,
      });

      setCurrentScreen("interview");
      
      // Start with first question
      await askFirstQuestion(firstChunk);
      
      // Preprocess next chunk in background
      if (chunkArray.length > 1) {
        preprocessNextChunk();
      }
    } catch (error) {
      console.error("Error starting interview:", error);
      alert("An error occurred. Please try again.");
      setCurrentScreen("setup");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Ask the first question from the loaded chunk
   */
  const askFirstQuestion = async (chunk: ChunkData) => {
    if (!chunk || chunk.questions.length === 0) return;

    const question = chunk.questions[0];
    setCurrentQuestion(question);
    setStats((prev) => ({ ...prev, questionsAsked: 1 }));

    // Play audio if available
    if ((question as any).audioUrl) {
      await playQuestionAudio((question as any).audioUrl);
    } else {
      console.warn("[Audio] No audio URL for question:", question.id);
    }
  };

  const askNextQuestion = async () => {
    if (!currentChunk) {
      endInterview();
      return;
    }

    const nextQuestionIndex = chunkQuestionIndex + 1;

    // Check if we need to move to next chunk
    if (nextQuestionIndex >= currentChunk.questions.length) {
      console.log(`[Chunking] Chunk ${currentChunkIndex} completed, moving to next chunk...`);
      
      const nextChunkIdx = currentChunkIndex + 1;
      if (nextChunkIdx >= chunks.length) {
        console.log("[Chunking] All chunks completed");
        endInterview();
        return;
      }

      // Load next chunk
      const nextChunk = await loadChunk(nextChunkIdx);
      if (!nextChunk || nextChunk.questions.length === 0) {
        console.log("[Chunking] No more questions available");
        endInterview();
        return;
      }

      setCurrentChunk(nextChunk);
      setCurrentChunkIndex(nextChunkIdx);
      setChunkQuestionIndex(0);

      const question = nextChunk.questions[0];
      setCurrentQuestion(question);
      setStats((prev) => ({ ...prev, questionsAsked: prev.questionsAsked + 1 }));

      // Play audio
      if ((question as any).audioUrl) {
        await playQuestionAudio((question as any).audioUrl);
      }

      // Preprocess next chunk in background
      if (nextChunkIdx + 1 < chunks.length) {
        preprocessNextChunk();
      }

      return;
    }

    // Ask next question in current chunk
    const question = currentChunk.questions[nextQuestionIndex];
    setCurrentQuestion(question);
    setChunkQuestionIndex(nextQuestionIndex);
    setStats((prev) => ({ ...prev, questionsAsked: prev.questionsAsked + 1 }));

    // Play audio
    if ((question as any).audioUrl) {
      await playQuestionAudio((question as any).audioUrl);
    } else {
      console.warn("[Audio] No audio URL for question:", question.id);
    }
  };

  const submitAnswer = async () => {
    const answer = transcriptBufferRef.current.trim();
    if (!answer || !currentQuestion) return;

    // Clear the buffer
    transcriptBufferRef.current = "";

    try {
      if (currentQuestion.category === "technical" && currentQuestion.answer) {
        const analysis = await technicalInterviewAdapter.analyze(
          currentQuestion.question,
          currentQuestion.answer,
          answer,
          queues,
          currentQuestion
        );

        if (analysis.updatedQueues) {
          setQueues(analysis.updatedQueues);
        }
        
        try {
          await technicalInterviewAdapter.persistQA(interviewId, {
            question_text: currentQuestion.question,
            ideal_answer: currentQuestion.answer,
            user_answer: answer,
            correctness_score: analysis.correctness,
            question_type: currentQuestion.category as any,
            queue_number: 1,
            timestamp: new Date(),
            source_urls: [],
          });
        } catch (e) {
          console.error("Failed to append QA", e);
        }
      }

      // Ask next question after a brief pause
      setTimeout(() => askNextQuestion(), 1500);
    } catch (error) {
      console.error("Error analyzing answer:", error);
      askNextQuestion();
    }
  };

  const endInterview = () => {
    setCurrentScreen("complete");
    stopRecording();
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  };

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return;

    const recognition = initializeSpeechRecognition(
  initialConfig?.language || "en-US",
      (transcript: string) => {
        transcriptBufferRef.current += " " + transcript;
        console.log("Transcript buffer:", transcriptBufferRef.current);

        // Clear previous timeout
        if (submitTimeoutRef.current) {
          clearTimeout(submitTimeoutRef.current);
        }

        // Set new timeout (2 seconds of silence)
        submitTimeoutRef.current = setTimeout(() => {
          submitAnswer();
        }, 2000);
      },
      (error: Error) => {
        console.error("Speech recognition error:", error);
      }
    );

    speechRecognitionRef.current = recognition;

    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      stopMediaStream(streamRef.current);
    };
  }, [currentQuestion]);

  // Timer countdown
  useEffect(() => {
    if (currentScreen !== "interview") return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          endInterview();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentScreen]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A18] via-[#0D0D20] to-[#0A0A18]">
      <HeaderBanner 
        duration={initialConfig?.duration || 60}
        language={initialConfig?.language || "en-US"}
        difficulty={initialConfig?.difficulty || "mid"}
        mode={initialConfig?.mode || "live"}
      />

      {currentScreen === "setup" && (
        <SetupScreen
          consentRequired={initialConfig?.consentRequired || false}
          hasConsent={hasConsent}
          setHasConsent={setHasConsent}
          proctoring={initialConfig?.proctoring || null}
          isLoading={isLoading}
          onStart={startInterview}
          jobData={jobData}
          resumeData={resumeData}
        />
      )}

      {currentScreen === "loading" && <LoadingScreen />}

      {currentScreen === "interview" && (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          {/* Timer */}
          <div className="flex justify-center mb-4">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg px-6 py-3 flex items-center gap-3">
              <Clock className="w-5 h-5 text-purple-400" />
              <span className="text-white font-medium text-lg">
                Time Remaining: {formatTime(timeRemaining)}
              </span>
            </div>
          </div>

          {/* Video Boxes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* AI Avatar */}
            <div className="relative aspect-video bg-gradient-to-br from-purple-900/20 to-blue-900/20 rounded-2xl border border-white/10 overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-24 h-24 mx-auto mb-4 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                    <Volume2 className={`w-12 h-12 text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
                  </div>
                  <p className="text-white/70 text-sm">AI Interviewer</p>
                </div>
              </div>
            </div>

            {/* Candidate Webcam */}
            <div className="relative aspect-video bg-black/40 rounded-2xl border border-white/10 overflow-hidden">
              {initialConfig?.proctoring.cameraRequired && (
                <VideoProcessing />
              )}
            </div>
          </div>

          {/* Current Question */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-6 mb-6">
            <h3 className="text-white/60 text-sm mb-2">Current Question:</h3>
            <p className="text-white text-lg">
              {currentQuestion?.question || "Loading..."}
            </p>
          </div>

          {/* Transcript Display */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-6 mb-6">
            <h3 className="text-white/60 text-sm mb-2">Your Answer (Voice Transcript):</h3>
            <p className="text-white/90 min-h-[60px]">
              {transcriptBufferRef.current || "Listening..."}
            </p>
          </div>

          {/* Controls */}
          <div className="flex justify-center gap-4">
            <Button
              variant="outline"
              size="lg"
              onClick={handleToggleMute}
              className={`${
                isMuted
                  ? "bg-red-500/20 border-red-500/50 text-red-300"
                  : "bg-white/5 border-white/20 text-white"
              } hover:bg-white/10`}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              {isMuted ? "Unmute" : "Mute"}
            </Button>

            <Button
              size="lg"
              onClick={askNextQuestion}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
            >
              Next Question
            </Button>
          </div>

          {/* Stats */}
          <div className="mt-6 text-center">
            <p className="text-white/60 text-sm">
              Questions Asked: {stats.questionsAsked}
            </p>
          </div>
        </div>
      )}

      {currentScreen === "complete" && (
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-12 text-center max-w-md">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-white mb-4">
              Interview Complete!
            </h2>
            <p className="text-white/70 mb-8">
              Thank you for completing the technical interview. Your responses have
              been recorded and will be evaluated shortly.
            </p>
            <Button
              size="lg"
              onClick={() => window.location.href = "/dashboard/candidate"}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
            >
              <RefreshCw className="w-5 h-5 mr-2" />
              Return to Dashboard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
