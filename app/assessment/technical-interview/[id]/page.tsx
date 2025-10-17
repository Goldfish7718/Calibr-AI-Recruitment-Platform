"use client";
import React from "react";
/// <reference types="node" />

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
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

//type Conversation = ConversationItem;

export default function VoiceInterviewPage() {
  const params = useParams();
  const interviewId = params.id as string;
  
  const [currentScreen, setCurrentScreen] = useState<
    "setup" | "loading" | "interview" | "complete"
  >("setup");
  const [resumeData, setResumeData] = useState("");
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
  const [interviewConfig, setInterviewConfig] =
    useState<InterviewConfig | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
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

  // Fetch interview configuration on component mount
  useEffect(() => {
    const fetchInterviewConfig = async () => {
      try {
        const result = await technicalInterviewAdapter.getConfig(interviewId);
        if (result.success && result.config) {
          setInterviewConfig(result.config);
          setTimeRemaining(result.config.duration * 60); // Convert minutes to seconds
        } else {
          console.error("Interview configuration not found:", result.error);
        }
      } catch (error) {
        console.error("Error fetching interview config:", error);
      }
    };

    if (interviewId) {
      fetchInterviewConfig();
    }
  }, [interviewId]);

  // Initialize speech recognition
  useEffect(() => {
    const recognition = initializeSpeechRecognition(
      interviewConfig?.language || "en-US",
      (transcript) => {
        // Buffer the transcript
        transcriptBufferRef.current += (transcriptBufferRef.current ? " " : "") + transcript;
        
        // Clear existing timeout
        if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
        
        // Set timeout to submit after 2 seconds of silence
        submitTimeoutRef.current = setTimeout(() => {
          submitAnswer();
        }, 2000);
      },
      () => {
        setIsRecording(false);
      }
    );
    speechRecognitionRef.current = recognition;
  }, [interviewConfig?.language]);

  // Timer effect
  useEffect(() => {
    if (currentScreen === "interview" && timeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            endInterview();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [currentScreen, timeRemaining]);

  /**
   * Play audio from S3 URL using AudioPlayer
   */
  const playQuestionAudio = async (audioUrl: string) => {
    if (!audioPlayerRef.current) return;
    
    try {
      setIsSpeaking(true);
      await audioPlayerRef.current.play(audioUrl, {
        onStart: () => {
          console.log("[Audio] Playing question audio...");
        },
        onEnd: () => {
          setIsSpeaking(false);
          console.log("[Audio] Question audio completed");
        },
        onError: (error) => {
          console.error("[Audio] Playback error:", error);
          setIsSpeaking(false);
        },
      });
    } catch (error) {
      console.error("[Audio] Failed to play audio:", error);
      setIsSpeaking(false);
    }
  };

  /**
   * Preprocess next chunk in background
   */
  const preprocessNextChunk = async () => {
    if (!chunkManagerRef.current || preprocessingNextChunkRef.current) return;

    const nextChunkIndex = currentChunkIndex + 1;
    if (nextChunkIndex >= chunks.length) return;

    const nextChunk = chunkManagerRef.current.getChunk(nextChunkIndex);
    if (!nextChunk) return;

    preprocessingNextChunkRef.current = true;
    console.log(`[Chunking] Preprocessing Chunk ${nextChunk.chunkNumber} in background...`);

    try {
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
    if (!resumeData.trim()) {
      alert("Please paste resume data first!");
      return;
    }

    if (interviewConfig?.consentRequired && !hasConsent) {
      alert("Please provide consent to continue with the interview.");
      return;
    }

    setIsLoading(true);
    setCurrentScreen("loading");

    try {
      // Start media recording if required
      if (
        interviewConfig?.proctoring.micRequired ||
        interviewConfig?.proctoring.cameraRequired
      ) {
        await startRecording();
      }
      
      // Start evaluation document once per session
      if (!evaluationStartedRef.current) {
        await technicalInterviewAdapter.startEvaluation(interviewId);
        evaluationStartedRef.current = true;
      }

      // Generate all questions
      console.log("[Chunking] Generating questions...");
      const result = await generateQuestions(resumeData);
      
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
      console.error("Error submitting answer:", error);
      setTimeout(() => askNextQuestion(), 1500);
    }
  };

  const endInterview = () => {
    // Stop all media streams
    stopRecording();
    stopMediaStream(streamRef.current);
    
    // Stop audio player
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }
    
    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Log chunking stats
    if (chunks.length > 0) {
      const processedChunks = currentChunkIndex + 1;
      const totalChunks = chunks.length;
      const savedChunks = totalChunks - processedChunks;
      const savedPercentage = ((savedChunks / totalChunks) * 100).toFixed(1);
      
      console.log(`[Chunking] Interview ended:`);
      console.log(`  - Processed: ${processedChunks}/${totalChunks} chunks`);
      console.log(`  - Saved: ${savedChunks} chunks (${savedPercentage}%)`);
    }
    
    setCurrentScreen("complete");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A18] to-[#0D0D20] p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
          {interviewConfig && (
          <HeaderBanner
            duration={interviewConfig.duration}
            language={interviewConfig.language}
            difficulty={interviewConfig.difficulty}
            mode={interviewConfig.mode}
          />
        )}

        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* Setup Screen */}
          {currentScreen === "setup" && interviewConfig && (
            <SetupScreen
              resumeData={resumeData}
              setResumeData={setResumeData}
              consentRequired={!!interviewConfig.consentRequired}
              hasConsent={hasConsent}
              setHasConsent={setHasConsent}
              proctoring={interviewConfig.proctoring}
              isLoading={isLoading}
              onStart={startInterview}
            />
          )}

          {/* Loading Screen */}
          {currentScreen === "loading" && <LoadingScreen />}

          {/* Interview Screen */}
          {currentScreen === "interview" && (
            <div className="flex flex-col h-[calc(100vh-200px)]">
              {/* Top Bar - Timer and Status */}
              <div className="flex justify-between items-center px-6 py-4 border-b border-white/10 bg-gradient-to-r from-white/5 to-white/10">
                <div className="flex items-center gap-4">
                  {/* Timer */}
                  <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 px-5 py-2.5 rounded-full border border-indigo-500/30 shadow-lg">
                    <div className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-indigo-300" />
                      <span className="text-white font-mono text-xl font-semibold">
                        {formatTime(timeRemaining)}
                      </span>
                    </div>
                  </div>
                  
                  {/* Questions Counter */}
                  <div className="bg-white/10 px-5 py-2.5 rounded-full border border-white/20">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span className="text-white text-sm font-medium">
                        Question {stats.questionsAsked}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Speaking Indicator */}
                {isSpeaking && (
                  <div className="flex items-center gap-2 bg-indigo-500/20 px-4 py-2.5 rounded-full border border-indigo-500/40 shadow-lg animate-pulse">
                    <Volume2 className="w-5 h-5 text-indigo-300 animate-bounce" />
                    <span className="text-indigo-200 text-sm font-medium">AI is speaking...</span>
                  </div>
                )}
                
                {/* Recording Indicator */}
                {isRecording && !isSpeaking && (
                  <div className="flex items-center gap-2 bg-red-500/20 px-4 py-2.5 rounded-full border border-red-500/40">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-red-200 text-sm font-medium">Listening...</span>
                  </div>
                )}
              </div>

              {/* Main Video Grid - Google Meet Style */}
              <div className="flex-1 p-8 flex items-center justify-center gap-6 bg-gradient-to-br from-[#0A0A18] to-[#0D0D20]">
                {/* AI Avatar Box - Left */}
                <div className="relative w-full max-w-2xl h-[500px] rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border-2 border-indigo-500/30 shadow-2xl hover:shadow-indigo-500/20 transition-all duration-300">
                  {/* AI Avatar Placeholder */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
                    {/* Avatar Circle */}
                    <div className="relative mb-6">
                      <div className="w-32 h-32 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl">
                        <svg className="w-20 h-20 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      {/* Pulse Ring */}
                      {isSpeaking && (
                        <div className="absolute inset-0 rounded-full bg-indigo-500/30 animate-ping"></div>
                      )}
                    </div>
                    
                    {/* AI Name */}
                    <div className="text-center">
                      <h3 className="text-2xl font-bold text-white mb-2">AI Interviewer</h3>
                      <p className="text-indigo-300 text-sm">Technical Assessment</p>
                    </div>
                    
                    {/* Current Question Display */}
                    {currentQuestion && (
                      <div className="mt-8 max-w-lg">
                        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                          <p className="text-white/90 text-center leading-relaxed">
                            {currentQuestion.question}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Name Tag */}
                  <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
                    <span className="text-white font-medium text-sm">AI Interviewer</span>
                  </div>
                </div>

                {/* Candidate Video Box - Right */}
                <div className="relative w-full max-w-2xl h-[500px] rounded-3xl overflow-hidden bg-gradient-to-br from-slate-900/20 to-slate-800/20 border-2 border-white/20 shadow-2xl hover:shadow-white/10 transition-all duration-300">
                  {/* Video Preview */}
                  {interviewConfig?.proctoring.cameraRequired ? (
                    <div className="absolute inset-0">
                      <VideoProcessing />
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center mb-4 mx-auto">
                          <span className="text-4xl font-bold text-white">
                            {resumeData.charAt(0).toUpperCase() || "C"}
                          </span>
                        </div>
                        <p className="text-white/60">Camera Off</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Name Tag */}
                  <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
                    <span className="text-white font-medium text-sm">You</span>
                  </div>
                  
                  {/* Microphone Status */}
                  <div className="absolute top-6 right-6">
                    {isMuted ? (
                      <div className="bg-red-500/80 backdrop-blur-md p-3 rounded-full">
                        <MicOff className="w-5 h-5 text-white" />
                      </div>
                    ) : isRecording ? (
                      <div className="bg-green-500/80 backdrop-blur-md p-3 rounded-full animate-pulse">
                        <Mic className="w-5 h-5 text-white" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Bottom Control Bar - Google Meet Style */}
              <div className="border-t border-white/10 px-6 py-6 bg-gradient-to-r from-white/5 to-white/10">
                <div className="flex items-center justify-center gap-6">
                  {/* Microphone Toggle */}
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      onClick={isRecording ? stopRecording : startRecording}
                      size="lg"
                      className={`rounded-full w-16 h-16 transition-all duration-200 shadow-lg ${
                        isRecording
                          ? "bg-white/20 hover:bg-white/30 text-white border-2 border-white/40"
                          : "bg-red-500/80 hover:bg-red-600 text-white border-2 border-red-400/50"
                      }`}
                    >
                      {isRecording ? (
                        <Mic className="w-7 h-7" />
                      ) : (
                        <MicOff className="w-7 h-7" />
                      )}
                    </Button>
                    <span className="text-white/60 text-xs font-medium">
                      {isRecording ? "Mute" : "Unmute"}
                    </span>
                  </div>
                  
                  {/* Volume Toggle */}
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      onClick={handleToggleMute}
                      size="lg"
                      className={`rounded-full w-16 h-16 transition-all duration-200 shadow-lg ${
                        isMuted
                          ? "bg-red-500/80 hover:bg-red-600 text-white border-2 border-red-400/50"
                          : "bg-white/20 hover:bg-white/30 text-white border-2 border-white/40"
                      }`}
                    >
                      {isMuted ? (
                        <MicOff className="w-7 h-7" />
                      ) : (
                        <Volume2 className="w-7 h-7" />
                      )}
                    </Button>
                    <span className="text-white/60 text-xs font-medium">
                      {isMuted ? "Unmute Audio" : "Mute Audio"}
                    </span>
                  </div>
                  
                  {/* End Interview */}
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      onClick={endInterview}
                      size="lg"
                      className="rounded-full bg-red-500 hover:bg-red-600 text-white px-10 h-16 font-semibold shadow-lg border-2 border-red-400/50 transition-all duration-200"
                    >
                      End Interview
                    </Button>
                    <span className="text-white/60 text-xs font-medium">Leave</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Complete Screen */}
          {currentScreen === "complete" && (
            <div className="p-12 text-center">
              <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-6" />
              <h2 className="text-2xl font-semibold text-white mb-4">
                Interview Completed!
              </h2>
              <p className="text-white/70 text-lg mb-8">
                Thank you for completing the interview. The session has been
                saved and analyzed.
              </p>
              <Button
                onClick={() => window.location.reload()}
                className="bg-gradient-to-r from-indigo-500 to-rose-500 hover:from-indigo-600 hover:to-rose-600 text-white font-semibold text-lg px-8 py-6 rounded-xl"
              >
                <RefreshCw className="w-5 h-5 mr-2" />
                Start New Interview
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
