"use client";
import React, { useState, useRef, useEffect } from "react";
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
import type { InterviewConfig, Question } from "../types";
import { formatTime } from "@/utils/interview";

// TESTING MODE: Set to true to disable timer-based interview completion
// When true, interview only ends when all questions are answered, not when time runs out
const TESTING_MODE = process.env.NEXT_PUBLIC_INTERVIEW_TESTING_MODE === "true";
import { startAudioRecording } from "@/utils/media";
import { initWebSpeechRecognition, type ISpeechRecognition } from "@/utils/stt";
import {
  generateTTSAudio,
  playBrowserTTS,
  loadBrowserVoices,
} from "@/utils/tts";
import {
  getAskedQuestions,
  storeQ1Questions,
  getQ1QuestionsForChunk,
  addAskedQuestion,
  updateAskedQuestionAnswer,
  generateQuestions,
  preprocessQuestion,
  deleteInterviewAudio,
  markQuestionAsked,
  completeInterview,
} from "../actions";
import { buildInterviewClosingPrompt } from "@/ai-engine/prompts/technicalInterview";
import { callGeminiAPI } from "@/utils/interview";

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
  resumeData,
}: TechnicalInterviewClientProps) {
  const [currentScreen, setCurrentScreen] = useState<
    "setup" | "loading" | "ready" | "interview" | "complete"
  >("setup");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] =
    useState<string>("Initializing...");
  const [preprocessingProgress, setPreprocessingProgress] = useState<number>(0);
  const [queues, setQueues] = useState<{
    queue1: Question[];
    queue2: Question[];
    queue3: Question[];
  }>({ queue1: [], queue2: [], queue3: [] });
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [stats, setStats] = useState({
    questionsAsked: 0,
  });
  const [closingMessage, setClosingMessage] = useState<string>("");

  // New chunking state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentChunkNumber, setCurrentChunkNumber] = useState(0);
  const [totalQ1Questions, setTotalQ1Questions] = useState(0);
  const [preprocessedChunks, setPreprocessedChunks] = useState<Set<number>>(
    new Set([0])
  ); // Track which chunks have been preprocessed (chunk 0 is done initially)

  // Voice and media states
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserMuted, setIsUserMuted] = useState(false); // User manually muted via button
  const [timeRemaining, setTimeRemaining] = useState(
    initialConfig.duration * 60
  );
  const [hasConsent, setHasConsent] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] =
    useState(true);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<ISpeechRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const evaluationStartedRef = useRef<boolean>(false);
  const transcriptBufferRef = useRef<string>("");
  const answerBufferRef = useRef<string>("");
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preprocessingInProgressRef = useRef<boolean>(false);
  const askedQuestionsRef = useRef<any[]>([]);
  const lastActivityRef = useRef<number>(Date.now());
  const hasStartedSpeakingRef = useRef<boolean>(false); // Flag to track if user has started speaking
  const isSubmittingRef = useRef<boolean>(false); // Flag to prevent multiple simultaneous submissions
  const isUserMutedRef = useRef<boolean>(false); // Ref for immediate access to mute state
  const isSpeakingRef = useRef<boolean>(false); // Ref for immediate access in callbacks
  const currentScreenRef = useRef<typeof currentScreen>("setup"); // Ref for immediate access in callbacks
  const sttRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  ); // Prevent rapid STT restarts
  const currentQuestionRef = useRef<Question | null>(null); // Ref to track current question (for immediate access)
  const PAUSE_THRESHOLD = 3000;

  // Keep refs in sync with state for use in callbacks
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    currentScreenRef.current = currentScreen;
  }, [currentScreen]);

  /**
   * Immediate video log persistence - logs are stored in DB as soon as they're generated
   * This ensures real-time availability for mood-based question generation
   */
  useEffect(() => {
    if (currentScreen !== "interview") return; // Only store during active interview

    const handleVideoLog = async (log: any) => {
      const { storeVideoLogs } = await import("../actions");

      console.log("[Video] Storing log immediately:", log);
      const result = await storeVideoLogs(interviewId, [log]);
      if (!result.success) {
        console.error("[Video] Failed to store log:", result.error);
      }
    };

    // Register callback for immediate log storage
    const setupCallback = async () => {
      const { setLogCallback } = await import(
        "@/lib/interview/videoQueueIntegration"
      );
      setLogCallback(handleVideoLog);
    };

    setupCallback();

    // Cleanup: unregister callback when interview ends or component unmounts
    return () => {
      const cleanup = async () => {
        const { setLogCallback } = await import(
          "@/lib/interview/videoQueueIntegration"
        );
        setLogCallback(null);
      };
      cleanup();
    };
  }, [currentScreen, interviewId]);

  /**
   * Generate TTS audio and upload to S3 (with retry)
   * Falls back to null (browser TTS) if S3 is not configured
   */
  const generateAndUploadTTS = async (
    text: string,
    questionId: string
  ): Promise<string | null> => {
    try {
      console.log(`[TTS] Generating audio for ${questionId}...`);
      const audioBlob = await generateTTSAudio(text);

      if (!audioBlob) {
        console.warn(
          `[TTS] No audio blob for ${questionId}, will use browser TTS`
        );
        return null;
      }

      console.log(`[TTS] Audio blob generated, size: ${audioBlob.size} bytes`);

      // Convert blob to base64 for server upload
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString("base64");

      // Upload via API route (server-side S3 access)
      const uploadResponse = await fetch("/api/upload-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: base64Audio,
          questionId,
          interviewId,
        }),
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        console.warn(
          `[TTS] Upload failed for ${questionId}: ${error.error}, will use browser TTS`
        );
        return null;
      }

      const { audioUrl } = await uploadResponse.json();
      console.log(`[TTS] ✓ Uploaded ${questionId} to S3: ${audioUrl}`);
      return audioUrl;
    } catch (error) {
      console.warn(
        `[TTS] Upload failed for ${questionId}, will use browser TTS:`,
        error
      );
      return null;
    }
  };

  /**
   * Preprocess chunk: generate answers, sources, TTS
   */
  const preprocessChunk = async (chunkNumber: number) => {
    if (preprocessingInProgressRef.current) return;
    preprocessingInProgressRef.current = true;

    try {
      console.log(`[Preprocessing] 🔄 Starting chunk ${chunkNumber}...`);
      setLoadingMessage(`Preprocessing chunk ${chunkNumber}...`);

      const result = await getQ1QuestionsForChunk(interviewId, chunkNumber);
      if (
        !result.success ||
        !result.questions ||
        result.questions.length === 0
      ) {
        console.log(`[Preprocessing] ❌ No questions for chunk ${chunkNumber}`);
        return;
      }

      const totalQuestions = result.questions.length;
      console.log(
        `[Preprocessing] Found ${totalQuestions} questions in chunk ${chunkNumber}`
      );

      for (let i = 0; i < result.questions.length; i++) {
        const q = result.questions[i];
        const baseProgress = Math.round(((i + 1) / totalQuestions) * 100);

        console.log(
          `[Preprocessing] Q1 Question ${
            i + 1
          }/${totalQuestions} (${baseProgress}%): ${q.id}`
        );
        setLoadingMessage(
          `Preprocessing chunk ${chunkNumber}: Question ${
            i + 1
          }/${totalQuestions}`
        );
        setPreprocessingProgress(baseProgress);

        let answer: string | undefined, source_urls: string[] | undefined;

        if (q.category === "technical") {
          console.log(`[Preprocessing] Generating ideal answer for ${q.id}...`);
          const result = await preprocessQuestion(q.question);
          if (result.success && result.answer) {
            answer = result.answer;
            source_urls = result.source_urls;
            console.log(`[Preprocessing] ✓ Ideal answer generated for ${q.id}`);
          } else {
            console.log(
              `[Preprocessing] ⚠️ No ideal answer for ${q.id}: ${
                result.error || "Unknown error"
              }`
            );
          }
        } else {
          console.log(
            `[Preprocessing] Skipping ideal answer generation for non-technical question ${q.id}`
          );
        }

        console.log(`[Preprocessing] Generating TTS audio for ${q.id}...`);
        const audioUrl = await generateAndUploadTTS(q.question, q.id);
        console.log(
          `[Preprocessing] TTS result for ${q.id}: ${
            audioUrl ? "S3 URL" : "Browser TTS fallback"
          }`
        );

        console.log(
          `[Preprocessing] Storing Q1 question ${q.id} in database...`
        );
        await addAskedQuestion(interviewId, {
          id: q.id,
          question: q.question,
          category: q.category,
          difficulty: q.difficulty,
          queueType: "Q1",
          askedAt: undefined as any,
          preprocessed: true,
          answer: answer || undefined,
          source_urls: source_urls || [],
          audioUrl: audioUrl || undefined,
          userAnswer: undefined,
          correctness: undefined,
        });
        console.log(
          `[Preprocessing] ✓ Q1 question ${q.id} stored successfully`
        );

        // Generate Q2 questions (medium + hard) for technical Q1 questions
        if (q.category === "technical" && answer) {
          console.log(
            `[Preprocessing] 🎯 Generating Q2 (medium + hard) for ${q.id}...`
          );
          setLoadingMessage(
            `Preprocessing chunk ${chunkNumber}: Generating follow-ups for Q${
              i + 1
            }`
          );

          try {
            // Call server action to generate Q2 questions (server-side to protect API key)
            const { generateQ2Questions } = await import("../actions");
            const q2Result = await generateQ2Questions(
              q.id,
              q.question,
              answer
            );

            if (q2Result.success) {
              console.log(`[Preprocessing] ✓ Q2 generation successful`);

              // Add medium question if generated
              if (q2Result.mediumQuestion) {
                const mediumAudioUrl = await generateAndUploadTTS(
                  q2Result.mediumQuestion.question,
                  q2Result.mediumQuestion.id
                );

                await addAskedQuestion(interviewId, {
                  id: q2Result.mediumQuestion.id,
                  question: q2Result.mediumQuestion.question,
                  category: "technical",
                  difficulty: "medium",
                  queueType: "Q2",
                  parentQuestionId: q.id,
                  askedAt: undefined as any,
                  preprocessed: true,
                  answer: q2Result.mediumQuestion.answer,
                  source_urls: q2Result.mediumQuestion.source_urls,
                  audioUrl: mediumAudioUrl || undefined,
                  userAnswer: undefined,
                  correctness: undefined,
                });
                console.log(
                  `[Preprocessing] ✓ Medium Q2 stored: ${q2Result.mediumQuestion.id}`
                );
              }

              // Add hard question if generated
              if (q2Result.hardQuestion) {
                const hardAudioUrl = await generateAndUploadTTS(
                  q2Result.hardQuestion.question,
                  q2Result.hardQuestion.id
                );

                await addAskedQuestion(interviewId, {
                  id: q2Result.hardQuestion.id,
                  question: q2Result.hardQuestion.question,
                  category: "technical",
                  difficulty: "hard",
                  queueType: "Q2",
                  parentQuestionId: q.id,
                  askedAt: undefined as any,
                  preprocessed: true,
                  answer: q2Result.hardQuestion.answer,
                  source_urls: q2Result.hardQuestion.source_urls,
                  audioUrl: hardAudioUrl || undefined,
                  userAnswer: undefined,
                  correctness: undefined,
                });
                console.log(
                  `[Preprocessing] ✓ Hard Q2 stored: ${q2Result.hardQuestion.id}`
                );
              }
            } else {
              console.error(
                `[Preprocessing] ❌ Q2 generation failed: ${q2Result.error}`
              );
            }
          } catch (e) {
            console.error(
              `[Preprocessing] ❌ Error generating Q2 for ${q.id}:`,
              e
            );
          }
        }
      }

      console.log(
        `[Preprocessing] ✅ Chunk ${chunkNumber} complete (${totalQuestions} questions processed)`
      );
      setPreprocessingProgress(100);

      // Mark this chunk as preprocessed in DATABASE
      const { markChunkPreprocessed } = await import("../actions");
      await markChunkPreprocessed(interviewId, chunkNumber);
      console.log(
        `[Preprocessing] ✓ Marked chunk ${chunkNumber} as preprocessed in database`
      );

      // Update local state
      setPreprocessedChunks((prev) => {
        const updated = new Set(prev);
        updated.add(chunkNumber);
        console.log(
          `[Preprocessing] ✓ Local state updated. Preprocessed chunks: [${Array.from(
            updated
          )
            .sort()
            .join(", ")}]`
        );
        return updated;
      });
    } catch (error) {
      console.error(`[Preprocessing] ❌ Error in chunk ${chunkNumber}:`, error);
      setLoadingMessage(`Error preprocessing chunk ${chunkNumber}`);
    } finally {
      preprocessingInProgressRef.current = false;
    }
  };

  /**
   * Load asked questions
   */
  const loadAskedQuestions = async () => {
    try {
      const result = await getAskedQuestions(interviewId);
      if (result.success && result.questions) {
        askedQuestionsRef.current = result.questions;
        return result.questions;
      }
      return [];
    } catch (error) {
      console.error("[Load] Error:", error);
      return [];
    }
  };

  /**
   * Use browser's built-in speech synthesis as fallback
   */
  const playBrowserAudio = (
    text: string,
    onStart?: () => void,
    onEnd?: () => void
  ) => {
    playBrowserTTS(
      text,
      initialConfig?.language || "en-US",
      () => {
        setIsSpeaking(true);
        onStart?.();
      },
      () => {
        setIsSpeaking(false);
        onEnd?.();
      },
      (event) => {
        console.error("[TTS] Browser TTS error:", event);
        // Even if browser TTS fails, continue the flow
        setIsSpeaking(false);
        // Call onEnd to ensure STT resumes and flow continues
        onEnd?.();
      }
    );
  };

  /**
   * Pause recording (stop STT but keep mic stream active)
   */
  const pauseRecording = () => {
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
        setIsRecording(false); // Turn off mic indicator when STT stops
        console.log("[STT] 🔇 Paused speech recognition");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // Ignore if already stopped
      }
    }
  };

  /**
   * Resume recording (restart STT) - only if not user-muted
   */
  const resumeRecording = () => {
    if (!speechRecognitionRef.current) {
      console.error("[STT] ❌ Cannot resume - not initialized");
      return;
    }

    // Don't resume if user manually muted the mic (use REF for immediate access)
    if (isUserMutedRef.current) {
      console.log("[STT] 🔇 Not resuming - user has muted mic");
      return;
    }

    try {
      speechRecognitionRef.current.start();
      setIsRecording(true); // Turn on mic indicator when STT starts
      console.log("[STT] 🎤 Resumed speech recognition");
    } catch (error: any) {
      // Silently ignore "already started" errors
      if (error.message && !error.message.includes("already started")) {
        console.error("[STT] Error resuming:", error);
      }
    }
  };

  /**
   * Play audio with fallback to browser TTS
   * Automatically pauses recording during playback and resumes after
   */
  const playQuestionAudio = async (
    audioUrl?: string,
    questionText?: string
  ) => {
    const text = questionText || currentQuestionRef.current?.question;

    // Pause recording during AI speech
    pauseRecording();

    // Mark question as asked (set askedAt) right before playback starts so it reflects actual ask time
    try {
      if (currentQuestionRef.current?.id) {
        await markQuestionAsked(interviewId, currentQuestionRef.current.id);
      }
    } catch (err) {
      console.warn("[Audio] markQuestionAsked failed:", err);
    }

    // No waiting needed - play question immediately

    const onAudioEnd = () => {
      // Resume recording immediately after AI finishes speaking
      setTimeout(() => resumeRecording(), 300); // Reduced from 500ms to 300ms
    };

    // Try S3 audio first
    if (audioUrl) {
      try {
        setIsSpeaking(true);
        const audio = new Audio(audioUrl);

        audio.onerror = () => {
          console.warn("[Audio] S3 audio failed, falling back to browser TTS");
          playBrowserAudio(text || "", undefined, onAudioEnd);
        };

        audio.onended = () => {
          setIsSpeaking(false);
          onAudioEnd();
        };

        await audio.play();
        return;
      } catch (error) {
        console.error("[Audio] Error with S3 audio:", error);
      }
    }

    // Fallback: Browser TTS
    console.log("[Audio] No S3 audio available, using browser TTS");
    playBrowserAudio(text || "", undefined, onAudioEnd);
  };

  const startRecording = async () => {
    try {
      const { mediaRecorder, stream } = await startAudioRecording(
        (audioBlob) => {
          console.log("Audio recorded:", audioBlob);
        }
      );

      streamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.start();
      }
    } catch (error) {
      console.error("Error starting recording:", error);
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
    const newMutedState = !isUserMuted;
    setIsUserMuted(newMutedState);
    isUserMutedRef.current = newMutedState; // Update ref for immediate access

    if (newMutedState) {
      // User muted - stop STT but PRESERVE transcripts
      console.log(
        "[Mute] 🔇 User muted mic - stopping STT and clearing pause timer"
      );
      console.log("[Mute] Preserving current answer:", answerBufferRef.current);

      // Stop STT immediately
      pauseRecording();

      // CRITICAL: Clear pause timer to prevent auto-submission
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = null;
        console.log("[Mute] ✓ Cleared pause timer - submission blocked");
      }

      // DON'T clear transcripts - preserve what user has said so far
      // answerBufferRef.current stays intact
      // finalTranscript stays visible
      // User can see their partial answer while mic is muted
    } else {
      // User unmuted - resume STT from where they left off
      console.log("[Mute] 🎤 User unmuted mic - resuming STT");
      console.log(
        "[Mute] Continuing from previous answer:",
        answerBufferRef.current
      );

      // Resume STT - will append to existing buffers
      resumeRecording();
    }
  };

  /**
   * Begin the actual interview (called from ready screen)
   */
  const beginInterview = async () => {
    console.log("[Interview] Starting interview from ready screen...");
    
    // CRITICAL: Load Q1 questions from database to ensure queues.queue1 is populated
    console.log("[Interview] Loading Q1 questions for chunk preprocessing...");
    const { getQ1Questions } = await import("../actions");
    const q1Result = await getQ1Questions(interviewId);
    
    if (q1Result.success && q1Result.q1Questions) {
      console.log(`[Interview] ✓ Loaded ${q1Result.q1Questions.length} Q1 questions from database`);
      setQueues(prev => ({
        ...prev,
        queue1: q1Result.q1Questions as Question[]
      }));
      setPreprocessedChunks(new Set(q1Result.preprocessedChunks || []));
    } else {
      console.warn("[Interview] ⚠️ Failed to load Q1 questions, chunk preprocessing may not work");
    }
    
    setCurrentScreen("interview");

    // Start recording infrastructure but don't start STT yet (will start after audio playback)
    await startRecording();

    // Immediately pause STT - it will resume after audio playback
    pauseRecording();

    // Play the first question (recording will resume after playback via onAudioEnd)
    if (currentQuestion) {
      await playQuestionAudio(
        (currentQuestion as any).audioUrl,
        currentQuestion.question
      );
    }
  };

  const startInterview = async () => {
    if (initialConfig?.consentRequired && !hasConsent) {
      alert("Please provide consent to continue.");
      return;
    }

    setIsLoading(true);
    setCurrentScreen("loading");
    setLoadingMessage("Initializing interview...");

    try {
      // DON'T start recording here - it will be started in beginInterview()
      // This prevents STT from starting before the interview actually begins

      if (!evaluationStartedRef.current) {
        await technicalInterviewAdapter.startEvaluation(interviewId);
        evaluationStartedRef.current = true;
      }

      console.log("[Interview] Checking for existing questions...");
      setLoadingMessage("Checking for previous progress...");
      const existingQuestions = await loadAskedQuestions();

      if (existingQuestions.length > 0) {
        console.log(
          `[Interview] ✓ Found ${existingQuestions.length} existing questions - resuming interview`
        );

        // Load Q1 questions array and preprocessed chunks from database
        console.log(
          "[Interview] Loading Q1 questions and preprocessed chunks from database..."
        );
        const { getQ1Questions } = await import("../actions");
        const q1Result = await getQ1Questions(interviewId);

        if (q1Result.success && q1Result.q1Questions) {
          console.log(
            `[Interview] Loaded ${q1Result.q1Questions.length} Q1 questions from database`
          );
          console.log(
            `[Interview] Preprocessed chunks: [${
              q1Result.preprocessedChunks?.join(", ") || "none"
            }]`
          );

          // Set queues and preprocessed chunks from DB
          setQueues({
            queue1: q1Result.q1Questions as Question[],
            queue2: [],
            queue3: [],
          });
          setTotalQ1Questions(q1Result.q1Questions.length);
          setPreprocessedChunks(new Set(q1Result.preprocessedChunks || []));
        }

        // Find FIRST unanswered question
        const firstUnanswered = existingQuestions.find(
          (q) => !q.userAnswer || q.userAnswer.trim().length === 0
        );

        if (firstUnanswered) {
          const resumeIndex = existingQuestions.indexOf(firstUnanswered);
          console.log(
            `[Interview] 📍 Resuming at question #${
              resumeIndex + 1
            } (first unanswered): "${firstUnanswered.question.substring(
              0,
              80
            )}..."`
          );

          setCurrentQuestionIndex(resumeIndex);
          setCurrentQuestion(firstUnanswered);
          currentQuestionRef.current = firstUnanswered;
          setStats({ questionsAsked: resumeIndex });
          setCurrentChunkNumber(Math.floor(resumeIndex / 5));
        } else {
          // All questions answered - interview complete
          console.log(
            `[Interview] ✅ All ${existingQuestions.length} questions answered, interview complete`
          );
          setCurrentScreen("complete");
          setIsLoading(false);
          return;
        }

        // Wait for models before showing ready screen (resume case)
        console.log("[Interview] Resuming - checking if models are loaded...");
        setLoadingMessage("Loading proctoring models...");

        // Check if chunk 0 is preprocessed
        const isChunk0Ready = q1Result.preprocessedChunks?.includes(0);
        console.log(`[Interview] Chunk 0 preprocessed: ${isChunk0Ready}`);

        if (!isChunk0Ready) {
          console.log(
            "[Interview] ⚠️ Chunk 0 not preprocessed yet, waiting..."
          );
          setLoadingMessage(
            "📋 Waiting for initial questions to be prepared..."
          );

          // Wait for chunk 0 to be marked as preprocessed
          let waitAttempts = 0;
          while (waitAttempts < 60) {
            const updatedResult = await getQ1Questions(interviewId);
            if (
              updatedResult.success &&
              updatedResult.preprocessedChunks?.includes(0)
            ) {
              console.log("[Interview] ✅ Chunk 0 is now ready");
              setPreprocessedChunks(
                new Set(updatedResult.preprocessedChunks || [])
              );
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
            waitAttempts++;
          }

          if (waitAttempts >= 60) {
            console.warn(
              "[Interview] Chunk 0 preprocessing timed out, continuing anyway..."
            );
          }
        }

        // When resuming, check if models are already loaded
        let modelWaitAttempts = 0;
        const maxWaitTime = 10; // Max 10 seconds

        if (modelsLoaded) {
          console.log("[Interview] ✅ Models already loaded, skipping wait");
        } else {
          setLoadingMessage("Checking proctoring models...");
          console.log("[Interview] Models not loaded yet, waiting...");

          while (!modelsLoaded && modelWaitAttempts < maxWaitTime) {
            console.log(
              `[Interview] Waiting for models... (${
                modelWaitAttempts + 1
              }/${maxWaitTime}s)`
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
            modelWaitAttempts++;
          }

          if (!modelsLoaded) {
            console.warn(
              `[Interview] Models not loaded after ${maxWaitTime} seconds, continuing anyway (resume mode)...`
            );
          } else {
            console.log("[Interview] ✅ Models loaded");
          }
        }

        console.log("[Interview] ✓ Resuming interview - showing ready screen");
        setCurrentScreen("ready");
        setIsLoading(false);
        return;
      }

      console.log("[Interview] Generating questions...");
      console.log("[Interview] Job Data:", jobData ? "Present" : "Missing");
      console.log(
        "[Interview] Resume Data:",
        resumeData ? "Present" : "Missing"
      );

      setLoadingMessage("AI is generating personalized questions...");

      console.log("[Interview] 🚀 Calling generateQuestions API...");
      const startTime = Date.now();

      const result = await generateQuestions({ jobData, resumeData });

      const endTime = Date.now();
      console.log(
        `[Interview] ✓ API Response received in ${
          (endTime - startTime) / 1000
        }s`
      );
      console.log("[Interview] API Result:", result);

      if (!result.success || !result.queues) {
        console.error(
          "[Interview] ❌ Question generation failed:",
          result.error || "No queues returned"
        );
        alert(
          `Failed to generate questions: ${
            result.error || "Unknown error"
          }. Please try again.`
        );
        setCurrentScreen("setup");
        setIsLoading(false);
        return;
      }

      console.log("[Interview] ✓ Questions generated successfully");
      console.log(
        "[Interview] Queue1:",
        result.queues.queue1?.length || 0,
        "questions"
      );
      console.log(
        "[Interview] Queue2:",
        result.queues.queue2?.length || 0,
        "questions"
      );
      console.log(
        "[Interview] Queue3:",
        result.queues.queue3?.length || 0,
        "questions"
      );

      const q1Questions = result.queues.queue1.map((q) => ({
        id: q.id,
        question: q.question,
        category: q.category as "technical" | "non-technical",
        difficulty: q.difficulty,
      }));

      console.log(`[Interview] Storing ${q1Questions.length} Q1 questions...`);
      setLoadingMessage("Storing questions in database...");
      await storeQ1Questions(interviewId, q1Questions);
      setTotalQ1Questions(q1Questions.length);

      setQueues({
        queue1: result.queues.queue1,
        queue2: result.queues.queue2,
        queue3: result.queues.queue3,
      });

      console.log("[Interview] Starting preprocessing of Chunk 0...");
      setLoadingMessage("🔄 Analyzing your resume and skills...");
      setPreprocessingProgress(5);

      // Start preprocessing immediately
      preprocessChunk(0); // Don't await - let it run in background

      // WAIT for chunk 0 to fully complete
      const expectedCount = Math.min(5, q1Questions.length);
      let attempts = 0;
      console.log(
        `[Interview] Waiting for ${expectedCount} questions to be preprocessed...`
      );

      // Update UI immediately to show preprocessing has started
      setLoadingMessage(
        `📋 Generating ideal answers & sources: 0/${expectedCount} questions prepared`
      );

      while (attempts < 60) {
        // Increased timeout to 60 seconds
        const askedQuestions = await loadAskedQuestions();
        const progress = Math.round(
          5 + (askedQuestions.length / expectedCount) * 85
        ); // 5-90% range

        if (askedQuestions.length >= expectedCount) {
          console.log(
            `[Interview] ✓ Chunk 0 ready: ${askedQuestions.length}/${expectedCount} questions`
          );
          setPreprocessingProgress(100);
          setLoadingMessage("✅ All questions ready! Starting interview...");
          break;
        }

        console.log(
          `[Interview] Progress: ${askedQuestions.length}/${expectedCount} questions (${progress}%)`
        );
        setLoadingMessage(
          `📋 Generating ideal answers & sources: ${askedQuestions.length}/${expectedCount} questions prepared`
        );
        setPreprocessingProgress(progress);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }

      // CRITICAL: Wait for preprocessedChunks state to update (check database)
      console.log("[Interview] Verifying chunk 0 is marked as preprocessed...");
      setLoadingMessage("Finalizing preprocessing...");
      let chunkCheckAttempts = 0;
      while (chunkCheckAttempts < 10) {
        const { getQ1Questions } = await import("../actions");
        const q1Result = await getQ1Questions(interviewId);
        
        if (q1Result.success && q1Result.preprocessedChunks?.includes(0)) {
          console.log("[Interview] ✅ Chunk 0 confirmed as preprocessed in database");
          setPreprocessedChunks(new Set(q1Result.preprocessedChunks));
          break;
        }
        
        console.log(`[Interview] Chunk 0 not marked yet, waiting... (${chunkCheckAttempts + 1}/10)`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        chunkCheckAttempts++;
      }
      
      if (chunkCheckAttempts >= 10) {
        console.warn("[Interview] ⚠️ Chunk 0 preprocessed status verification timed out");
      }

      if (attempts >= 60) {
        console.warn("[Interview] Chunk 0 preprocessing timed out");
        setLoadingMessage(
          "⏱️ Preprocessing is taking longer than expected, starting interview anyway..."
        );
        setPreprocessingProgress(95);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      const askedQuestions = await loadAskedQuestions();
      if (askedQuestions.length === 0) {
        alert("No questions available. Please try again.");
        setCurrentScreen("setup");
        setIsLoading(false);
        return;
      }

      setCurrentQuestion(askedQuestions[0]);
      currentQuestionRef.current = askedQuestions[0]; // Initialize ref
      setCurrentQuestionIndex(0);
      setCurrentChunkNumber(0);
      setStats({ questionsAsked: 1 });

      // Wait for models to load before showing ready screen
      console.log("[Interview] Waiting for proctoring models...");
      setLoadingMessage(
        "Loading proctoring models (facial & object detection)..."
      );

      let modelWaitAttempts = 0;
      const maxWaitTime = 10; // Max 10 seconds

      if (modelsLoaded) {
        console.log("[Interview] ✅ Models already loaded, skipping wait");
      } else {
        console.log("[Interview] Models not loaded yet, waiting...");

        while (!modelsLoaded && modelWaitAttempts < maxWaitTime) {
          const mediaPipeReady = (window as any).mediaPipeLoaded === true;
          const yoloReady = (window as any).yoloLoaded === true;
          console.log(
            `[Models] MediaPipe: ${mediaPipeReady} YOLO: ${yoloReady}`
          );

          await new Promise((resolve) => setTimeout(resolve, 1000));
          modelWaitAttempts++;
        }

        if (!modelsLoaded) {
          console.warn(
            "[Interview] Models not loaded after 10 seconds, continuing anyway..."
          );
          setLoadingMessage(
            "Interview ready! (Note: Some proctoring features may be delayed)"
          );
        } else {
          console.log("[Interview] ✅ Models loaded, interview ready");
          setLoadingMessage(
            'Interview ready! Click "Start Interview" to begin.'
          );
        }
      }

      // Show ready screen instead of directly starting interview
      setCurrentScreen("ready");
      setIsLoading(false);
    } catch (error) {
      console.error("Error starting interview:", error);
      alert("An error occurred. Please try again.");
      setCurrentScreen("setup");
      setIsLoading(false);
    }
  };

  // const askNextQuestion = async () => {
  //   try {
  //     console.log('[NextQ] Loading questions from database...');
  //     const askedQuestions = await loadAskedQuestions();

  //     if (!askedQuestions || askedQuestions.length === 0) {
  //       console.log('[NextQ] No questions found, ending interview');
  //       endInterview();
  //       return;
  //     }

  //     console.log(`[NextQ] Loaded ${askedQuestions.length} total questions`);

  //     // Debug: Show which questions have answers
  //     const answeredCount = askedQuestions.filter(q => q.userAnswer && q.userAnswer.trim().length > 0).length;
  //     const unansweredCount = askedQuestions.filter(q => !q.userAnswer || q.userAnswer.trim().length === 0).length;
  //     console.log(`[NextQ] Answered: ${answeredCount}, Unanswered: ${unansweredCount}`);

  //     // Find first question WITHOUT a user answer
  //     const nextQuestion = askedQuestions.find(q => !q.userAnswer || q.userAnswer.trim().length === 0);

  //     if (!nextQuestion) {
  //       console.log('[NextQ] All questions answered, ending interview');
  //       endInterview();
  //       return;
  //     }

  //     console.log(`[NextQ] Next question ID: ${nextQuestion.id}`);
  //     console.log(`[NextQ] Has userAnswer: ${!!nextQuestion.userAnswer}`);
  //     console.log(`[NextQ] UserAnswer value: "${nextQuestion.userAnswer}"`);

  //     // Get overall index in askedQuestions (for state tracking)
  //     const nextQuestionIndex = askedQuestions.indexOf(nextQuestion);

  //     // Check if this is a Q1 question to trigger preprocessing
  //     const isQ1Question = nextQuestion.queueType === 'Q1' || !nextQuestion.queueType;
  //     let nextChunkNum = currentChunkNumber; // Default to current

  //     if (isQ1Question) {
  //       // Find this Q1's index in the ORIGINAL Q1 questions array (NOT askedQuestions)
  //       const q1Index = queues.queue1.findIndex(q => q.id === nextQuestion.id);

  //       if (q1Index !== -1) {
  //         const chunkNumber = Math.floor(q1Index / 5);
  //         const indexInChunk = q1Index % 5;
  //         const nextChunkToPreprocess = chunkNumber + 1;
  //         nextChunkNum = chunkNumber; // Update for chunk state tracking

  //         console.log(`[NextQ] 📊 Q1 Analysis: q1Index=${q1Index}, chunkNum=${chunkNumber}, indexInChunk=${indexInChunk}, nextChunkToPreprocess=${nextChunkToPreprocess}, totalQ1=${queues.queue1.length}, preprocessedChunks=[${Array.from(preprocessedChunks).sort().join(', ')}], preprocessingInProgress=${preprocessingInProgressRef.current}`);

  //         // Check if next chunk needs preprocessing (not already preprocessed or in progress)
  //         const nextChunkExists = nextChunkToPreprocess * 5 <= queues.queue1.length;
  //         const nextChunkNotPreprocessed = !preprocessedChunks.has(nextChunkToPreprocess);

  //         // Trigger preprocessing for any unprocessed chunk
  //         if (nextChunkExists && nextChunkNotPreprocessed) {
  //           if (preprocessingInProgressRef.current) {
  //             console.log(`[NextQ] ⏸️ Preprocessing already in progress, will retry later for chunk ${nextChunkToPreprocess}`);
  //           } else {
  //             console.log(`[NextQ] � Triggering chunk ${nextChunkToPreprocess} preprocessing (Q1 #${q1Index + 1} is first in chunk)`);
  //             // Don't await - let it run in background
  //             setTimeout(() => preprocessChunk(nextChunkToPreprocess), 100);
  //           }
  //         } else {
  //           const reason = !nextChunkExists ? 'no more chunks available' :
  //                         !nextChunkNotPreprocessed ? `chunk ${nextChunkToPreprocess} already preprocessed` :
  //                         'unknown';
  //           console.log(`[NextQ] ⏭️ Not preprocessing: ${reason}`);
  //         }
  //       }
  //     } else {
  //       console.log(`[NextQ] ⏭️ Not a Q1 question (${nextQuestion.queueType}), no preprocessing trigger`);
  //     }

  //     // Log which question is being asked
  //     const queueType = nextQuestion.queueType || 'Q1';
  //     let logMessage = `🎯 === ASKING ${queueType}`;

  //     // Q2 has difficulty levels (medium/hard) related to parent Q1
  //     if (queueType === 'Q2' && nextQuestion.difficulty) {
  //       logMessage += ` (${nextQuestion.difficulty})`;
  //       if (nextQuestion.parentQuestionId) {
  //         const parentQ = askedQuestions.find(q => q.id === nextQuestion.parentQuestionId);
  //         if (parentQ) {
  //           const parentIndex = askedQuestions.indexOf(parentQ) + 1;
  //           logMessage += ` - Follow-up to Q1 #${parentIndex}`;
  //         }
  //       }
  //     }

  //     // Q3 is follow-up (triggered by wrong Q1 answer)
  //     if (queueType === 'Q3') {
  //       if (nextQuestion.parentQuestionId) {
  //         const parentQ = askedQuestions.find(q => q.id === nextQuestion.parentQuestionId);
  //         if (parentQ) {
  //           const parentIndex = askedQuestions.indexOf(parentQ) + 1;
  //           logMessage += ` - Follow-up to Q1 #${parentIndex} (incorrect answer)`;
  //         }
  //       }
  //     }

  //     logMessage += ` ===`;
  //     console.log(`\n${logMessage}`);
  //     console.log(`📝 ${nextQuestion.question.substring(0, 120)}${nextQuestion.question.length > 120 ? '...' : ''}`);

  //     // Reset all transcript states for new question (FIX ISSUE #2)
  //     setFinalTranscript("");
  //     setInterimTranscript("");
  //     transcriptBufferRef.current = "";
  //     answerBufferRef.current = "";
  //     console.log('[STT] ✅ Cleared all transcripts for new question');

  //     // Reset speaking flag for new question
  //     hasStartedSpeakingRef.current = false;
  //     console.log('[STT] Reset hasStartedSpeaking flag for new question');

  //     // Clear any pending submission timers from previous question
  //     if (pauseTimeoutRef.current) {
  //       clearTimeout(pauseTimeoutRef.current);
  //       pauseTimeoutRef.current = null;
  //       console.log('[STT] Cleared any pending pause timers');
  //     }

  //     // If moving to NEW chunk, preprocess NEXT chunk in background
  //     // But only after verifying current chunk is fully ready
  //     if (nextChunkNum > currentChunkNumber) {
  //       console.log(`[Interview] Moving to chunk ${nextChunkNum}`);

  //       // Verify current chunk is fully preprocessed before using it
  //       const currentChunkStart = nextChunkNum * 5;
  //       const currentChunkEnd = Math.min(currentChunkStart + 5, totalQ1Questions);
  //       const currentChunkQ1Count = currentChunkEnd - currentChunkStart;

  //       const currentChunkQuestions = askedQuestions.filter(q =>
  //         q.queueType === 'Q1' &&
  //         askedQuestions.indexOf(q) >= currentChunkStart &&
  //         askedQuestions.indexOf(q) < currentChunkEnd
  //       );

  //       if (currentChunkQuestions.length < currentChunkQ1Count) {
  //         console.log(`[Interview] ⏳ Waiting for chunk ${nextChunkNum} to complete preprocessing...`);
  //         console.log(`[Interview] Expected: ${currentChunkQ1Count} questions, Found: ${currentChunkQuestions.length}`);

  //         let attempts = 0;
  //         const maxAttempts = 60; // Increased from 20 to 60 (60 seconds total)

  //         while (attempts < maxAttempts) {
  //           await new Promise(resolve => setTimeout(resolve, 1000));
  //           const updated = await loadAskedQuestions();
  //           const updatedChunkQuestions = updated.filter(q =>
  //             q.queueType === 'Q1' &&
  //             updated.indexOf(q) >= currentChunkStart &&
  //             updated.indexOf(q) < currentChunkEnd
  //           );

  //           if (updatedChunkQuestions.length >= currentChunkQ1Count) {
  //             console.log(`[Interview] ✓ Chunk ${nextChunkNum} ready (${updatedChunkQuestions.length}/${currentChunkQ1Count} questions)`);
  //             break;
  //           }

  //           attempts++;

  //           // Log progress every 5 seconds
  //           if (attempts % 5 === 0) {
  //             console.log(`[Interview] Still waiting... ${updatedChunkQuestions.length}/${currentChunkQ1Count} questions ready (${attempts}s elapsed)`);
  //           }
  //         }

  //         // If we timed out, log warning but continue anyway (questions might be ready by now)
  //         if (attempts >= maxAttempts) {
  //           console.warn(`[Interview] ⚠️ Chunk ${nextChunkNum} preprocessing timeout after ${maxAttempts}s - continuing anyway`);
  //           // Force reload to get latest state
  //           await loadAskedQuestions();
  //         }
  //       } else {
  //         console.log(`[Interview] ✓ Chunk ${nextChunkNum} already complete (${currentChunkQuestions.length}/${currentChunkQ1Count} questions)`);
  //       }

  //       setCurrentChunkNumber(nextChunkNum);

  //       // Remove this old logic since we now preprocess proactively above
  //       // The next chunk should already be preprocessing by now
  //     }

  //     // Update both state and ref (ref for immediate access in submitAnswer)
  //     setCurrentQuestion(nextQuestion);
  //     currentQuestionRef.current = nextQuestion;
  //     setCurrentQuestionIndex(nextQuestionIndex);
  //     setStats(prev => ({ ...prev, questionsAsked: prev.questionsAsked + 1 }));

  //     await playQuestionAudio(nextQuestion.audioUrl, nextQuestion.question);
  //   } catch (error) {
  //     console.error("Error asking next question:", error);
  //     endInterview();
  //   }
  // };

  const askNextQuestion = async () => {
    try {
      console.log('[NextQ] Loading questions from database...');
      const askedQuestions = await loadAskedQuestions();

      if (!askedQuestions || askedQuestions.length === 0) {
        console.log('[NextQ] No questions found, ending interview');
        endInterview();
        return;
      }

      console.log(`[NextQ] Loaded ${askedQuestions.length} total questions`);

      // CRITICAL: Load Q1 questions from database for chunk calculation
      const { getQ1Questions } = await import("../actions");
      const q1Result = await getQ1Questions(interviewId);
      
      if (!q1Result.success || !q1Result.q1Questions || q1Result.q1Questions.length === 0) {
        console.error('[NextQ] ❌ Failed to load Q1 questions from database');
        // Continue anyway but chunk preprocessing won't work
      } else {
        console.log(`[NextQ] ✓ Loaded ${q1Result.q1Questions.length} Q1 questions for chunk analysis`);
        console.log(`[NextQ] ✓ Preprocessed chunks from DB: [${q1Result.preprocessedChunks?.join(', ') || 'none'}]`);
      }
      
      const q1Questions = q1Result.success ? (q1Result.q1Questions || []) : [];
      const dbPreprocessedChunks = new Set(q1Result.preprocessedChunks || []);

      // Find first question WITHOUT a user answer
      const nextQuestion = askedQuestions.find(q => !q.userAnswer || q.userAnswer.trim().length === 0);

      if (!nextQuestion) {
        console.log('[NextQ] All questions answered, ending interview');
        endInterview();
        return;
      }

      console.log(`[NextQ] Next question ID: ${nextQuestion.id}`);

      // ✅ CHUNK PREPROCESSING TRIGGER - Check on EVERY question (Q1, Q2, Q3)
      const CHUNK_SIZE = 5;
      const isQ1Question = nextQuestion.queueType === 'Q1' || !nextQuestion.queueType;
      
      // Find Q1 index to determine chunk boundaries (works for all question types)
      let q1Index = -1;
      if (isQ1Question) {
        q1Index = q1Questions.findIndex(q => q.id === nextQuestion.id);
      } else if (nextQuestion.parentQuestionId) {
        // For Q2/Q3, find parent Q1 index
        q1Index = q1Questions.findIndex(q => q.id === nextQuestion.parentQuestionId);
      }

      // Trigger preprocessing based on Q1 index (regardless of question type)
      if (q1Index !== -1) {
        const chunkNumber = Math.floor(q1Index / CHUNK_SIZE);
        const nextChunkToPreprocess = chunkNumber + 1;

        console.log(`[NextQ] 📊 Chunk Analysis (${nextQuestion.queueType || 'Q1'}): q1Index=${q1Index}, currentChunk=${chunkNumber}, nextChunk=${nextChunkToPreprocess}, preprocessed=[${Array.from(dbPreprocessedChunks).sort().join(', ')}]`);

        const nextChunkExists = nextChunkToPreprocess * CHUNK_SIZE < q1Questions.length;
        const nextChunkNotPreprocessed = !dbPreprocessedChunks.has(nextChunkToPreprocess);

        console.log(`[NextQ] 🔍 Preprocessing Check for Chunk ${nextChunkToPreprocess}:`);
        console.log(`  - nextChunkExists: ${nextChunkExists} (${nextChunkToPreprocess * CHUNK_SIZE} < ${q1Questions.length})`);
        console.log(`  - nextChunkNotPreprocessed: ${nextChunkNotPreprocessed}`);
        console.log(`  - preprocessingInProgress: ${preprocessingInProgressRef.current}`);
        console.log(`  - All conditions met: ${nextChunkExists && nextChunkNotPreprocessed && !preprocessingInProgressRef.current}`);

        // Trigger preprocessing for any unprocessed chunk
        if (nextChunkExists && nextChunkNotPreprocessed && !preprocessingInProgressRef.current) {
          console.log(`[NextQ] 🔄 Triggering chunk ${nextChunkToPreprocess} preprocessing (detected on ${isQ1Question ? 'Q1 #' + (q1Index + 1) : nextQuestion.queueType})`);
          setTimeout(() => preprocessChunk(nextChunkToPreprocess), 100);
        } else {
          console.log(`[NextQ] ⏭️ Skipping chunk ${nextChunkToPreprocess} preprocessing`);
        }
      } else {
        console.log(`[NextQ] ⚠️ Could not determine Q1 index for question ${nextQuestion.id} (type: ${nextQuestion.queueType}, parentId: ${nextQuestion.parentQuestionId})`);
      }

      // Get overall index in askedQuestions (for state tracking)
      const nextQuestionIndex = askedQuestions.indexOf(nextQuestion);
      let nextChunkNum = currentChunkNumber;
      
      if (isQ1Question && q1Index !== -1) {
        nextChunkNum = Math.floor(q1Index / CHUNK_SIZE);
      }

      // Log which question is being asked
      const queueType = nextQuestion.queueType || 'Q1';
      console.log(`\n🎯 === ASKING ${queueType} ===`);
      console.log(`📝 ${nextQuestion.question.substring(0, 120)}${nextQuestion.question.length > 120 ? '...' : ''}`);

      // Reset all transcript states for new question
      setFinalTranscript("");
      setInterimTranscript("");
      transcriptBufferRef.current = "";
      answerBufferRef.current = "";
      console.log('[STT] ✅ Cleared all transcripts for new question');

      // Reset speaking flag for new question
      hasStartedSpeakingRef.current = false;

      // Clear any pending submission timers from previous question
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = null;
      }

      // If moving to NEW chunk, wait for it to be ready
      if (nextChunkNum > currentChunkNumber) {
        console.log(`[Interview] Moving to chunk ${nextChunkNum}`);
        
        const currentChunkStart = nextChunkNum * CHUNK_SIZE;
        const currentChunkEnd = Math.min(currentChunkStart + CHUNK_SIZE, totalQ1Questions);
        const currentChunkQ1Count = currentChunkEnd - currentChunkStart;

        // ✅ FIX: Use q1Questions (loaded from DB) instead of queues.queue1 (stale state)
        const expectedChunkQ1Ids = q1Questions.slice(currentChunkStart, currentChunkEnd).map(q => q.id);
        const currentChunkQuestions = askedQuestions.filter(q =>
          q.queueType === 'Q1' &&
          expectedChunkQ1Ids.includes(q.id)
        );

        if (currentChunkQuestions.length < currentChunkQ1Count) {
          console.log(`[Interview] ⏳ Waiting for chunk ${nextChunkNum} to complete preprocessing...`);
          console.log(`[Interview] Expected Q1s: [${expectedChunkQ1Ids.join(', ')}], Found: ${currentChunkQuestions.length}/${currentChunkQ1Count}`);
          
          let attempts = 0;
          const maxAttempts = 60;

          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const updated = await loadAskedQuestions();
            const updatedChunkQuestions = updated.filter(q =>
              q.queueType === 'Q1' &&
              expectedChunkQ1Ids.includes(q.id)
            );

            if (updatedChunkQuestions.length >= currentChunkQ1Count) {
              console.log(`[Interview] ✓ Chunk ${nextChunkNum} ready (${updatedChunkQuestions.length}/${currentChunkQ1Count} questions)`);
              break;
            }

            attempts++;

            if (attempts % 5 === 0) {
              console.log(`[Interview] Still waiting... ${updatedChunkQuestions.length}/${currentChunkQ1Count} questions ready`);
            }
          }

          if (attempts >= maxAttempts) {
            console.warn(`[Interview] ⚠️ Chunk ${nextChunkNum} preprocessing timeout - continuing anyway`);
          }
        } else {
          console.log(`[Interview] ✓ Chunk ${nextChunkNum} already complete (${currentChunkQuestions.length}/${currentChunkQ1Count} questions)`);
        }

        setCurrentChunkNumber(nextChunkNum);
      }

      // Update both state and ref
      setCurrentQuestion(nextQuestion);
      currentQuestionRef.current = nextQuestion;
      setCurrentQuestionIndex(nextQuestionIndex);
      setStats(prev => ({ ...prev, questionsAsked: prev.questionsAsked + 1 }));

      await playQuestionAudio(nextQuestion.audioUrl, nextQuestion.question);
    } catch (error) {
      console.error("Error asking next question:", error);
      endInterview();
    }
  };

  const submitAnswer = async () => {
    // CRITICAL: Don't submit if user has manually muted (use REF for immediate access)
    if (isUserMutedRef.current) {
      console.log("[Answer] ⚠️ User has muted mic - canceling auto-submit");
      return;
    }

    // Prevent multiple simultaneous submissions
    if (isSubmittingRef.current) {
      console.log(
        "[Answer] ⚠️ Submission already in progress, ignoring duplicate call"
      );
      return;
    }

    const answer = answerBufferRef.current.trim();
    // Use ref instead of state for immediate access to current question
    const questionToSubmit = currentQuestionRef.current;

    if (!answer || !questionToSubmit) {
      console.log("[Answer] No answer to submit or no current question");
      return;
    }

    // Set submission lock
    isSubmittingRef.current = true;
    console.log("[Answer] 🔒 Locked submission, processing answer...");
    console.log("[Answer] Question ID:", questionToSubmit.id);
    console.log(
      "[Answer] Question text:",
      questionToSubmit.question.substring(0, 80) + "..."
    );
    console.log("[Answer] Final answer:", answer);

    // Turn off recording indicator during submission
    setIsRecording(false);

    // Stop speech recognition immediately to prevent further input
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
        console.log("[STT] Stopped recognition for answer submission");
      } catch (error) {
        console.warn("[STT] Error stopping recognition:", error);
      }
    }

    // Clear all buffers and UI
    answerBufferRef.current = "";
    transcriptBufferRef.current = "";
    setFinalTranscript("");
    setInterimTranscript("");

    // Reset speaking flag for next question
    hasStartedSpeakingRef.current = false;

    // Clear any pending timeout
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }

    try {
      // Edge case: If questionToSubmit has no ideal answer, skip analysis (non-technical or missing answer)
      const hasIdealAnswer =
        questionToSubmit.answer && questionToSubmit.answer.trim().length > 0;

      let correctness: number | undefined = undefined;

      if (hasIdealAnswer && questionToSubmit.category === "technical") {
        // Only analyze technical questions with ideal answers
        console.log("[Answer] Analyzing technical answer...");
        const analysis = await technicalInterviewAdapter.analyze(
          questionToSubmit.question,
          questionToSubmit.answer || "",
          answer,
          queues,
          questionToSubmit
        );
        // If analysis returns undefined correctness (evaluation failed), leave it as undefined
        correctness = analysis?.correctness;
        console.log(
          `[Answer] Analysis complete, correctness: ${
            correctness !== undefined
              ? correctness + "%"
              : "N/A (evaluation skipped)"
          }`
        );
      } else {
        console.log(
          "[Answer] Skipping analysis - non-technical question or missing ideal answer"
        );
      }

      console.log("[Answer] Storing answer in database...");
      const storeResult = await updateAskedQuestionAnswer(
        interviewId,
        questionToSubmit.id,
        answer,
        correctness
      );

      if (storeResult.success) {
        console.log(
          `[Answer] ✓ Answer stored successfully, correctness: ${
            correctness !== undefined ? correctness + "%" : "N/A"
          }`
        );

        // Log Q2 follow-up handling
        if (storeResult.shouldDeleteFollowups) {
          console.log(
            `[Answer] 🗑️ Q2 follow-ups deleted due to low score (<50%)`
          );
        } else if (
          correctness !== undefined &&
          correctness >= 50 &&
          questionToSubmit.category === "technical"
        ) {
          console.log(
            `[Answer] ✅ Good score - Q2 follow-ups will be asked next`
          );
        }

        // Add small delay to ensure DB write is committed before loading next question
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        console.error(
          `[Answer] ❌ Failed to store answer: ${storeResult.error}`
        );
      }

      // Ask next question immediately (no delay)
      console.log("[Answer] Proceeding to next question...");
      await askNextQuestion();
    } catch (error) {
      console.error("[Answer] ❌ Error processing answer:", error);
      await askNextQuestion();
    } finally {
      // Release submission lock
      isSubmittingRef.current = false;
      console.log("[Answer] 🔓 Unlocked submission");

      // Turn recording indicator back on
      setIsRecording(true);

      // Restart speech recognition if we're still in interview
      // This ensures STT is ready for the next question
      if (currentScreen === "interview" && speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.start();
          console.log("[STT] Restarted recognition after submission");
        } catch (error: any) {
          // Ignore "already started" errors - resumeRecording in playQuestionAudio will handle it
          if (!error.message || !error.message.includes("already started")) {
            console.warn("[STT] Could not restart recognition:", error);
          }
        }
      }
    }
  };

  const endInterview = async () => {
    try {
      const prompt = buildInterviewClosingPrompt(
        "candidate",
        "Completed all questions"
      );

      // Use callGeminiAPI with JSON parsing
      const rawResponse = await callGeminiAPI(prompt);

      if (rawResponse) {
        try {
          const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const response = JSON.parse(jsonMatch[0]);
            if (response.closing) {
              setClosingMessage(response.closing);
            } else {
              setClosingMessage(
                "Thank you for completing the technical interview. Your responses have been recorded and will be evaluated shortly. We appreciate your time and effort!"
              );
            }
          } else {
            setClosingMessage(
              "Thank you for completing the technical interview. Your responses have been recorded and will be evaluated shortly. We appreciate your time and effort!"
            );
          }
        } catch (parseError) {
          console.error("Error parsing closing message:", parseError);
          setClosingMessage(
            "Thank you for completing the technical interview. Your responses have been recorded and will be evaluated shortly. We appreciate your time and effort!"
          );
        }
      } else {
        setClosingMessage(
          "Thank you for completing the technical interview. Your responses have been recorded and will be evaluated shortly. We appreciate your time and effort!"
        );
      }
    } catch (error) {
      console.error("Error generating closing message:", error);
      setClosingMessage(
        "Thank you for completing the technical interview. Your responses have been recorded and will be evaluated shortly. We appreciate your time and effort!"
      );
    } finally {
      setCurrentScreen("complete");
      stopRecording();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      // Mark interview as completed in database BEFORE deleting audio files
      console.log("[Interview] Marking interview as completed...");
      const completeResult = await completeInterview(interviewId);
      if (completeResult.success) {
        console.log("[Interview] ✓ Interview marked as completed");
      } else {
        console.error(
          "[Interview] ⚠️ Failed to mark interview as completed:",
          completeResult.error
        );
      }

      // Delete all interview audio files after interview is complete
      console.log("[Interview] Deleting all TTS audio files...");
      const deleteResult = await deleteInterviewAudio(interviewId);
      if (deleteResult.success) {
        console.log("[Interview] ✓ All audio files deleted successfully");
      } else {
        console.error(
          "[Interview] ⚠️ Failed to delete audio files:",
          deleteResult.error
        );
      }
    }
  };

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check browser compatibility
    const isSupported = !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );

    if (!isSupported) {
      console.error("[STT] Web Speech API not supported in this browser");
      console.log("[STT] Supported browsers: Chrome, Edge, Safari (iOS 14.5+)");
      console.log("[STT] Current browser:", navigator.userAgent);
      setSpeechRecognitionAvailable(false);
      return;
    }

    console.log("[STT] Web Speech API is supported, initializing...");
    setSpeechRecognitionAvailable(true);

    const recognition = initWebSpeechRecognition(
      initialConfig?.language || "en-US",
      (transcript: string) => {
        // This callback receives final transcripts
        console.log("[STT] Final transcript received:", transcript);
      }
    );

    if (recognition) {
      // Override onresult to handle both interim and final results
      recognition.onresult = (event: any) => {
        let interim = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcriptPart = event.results[i][0].transcript;

          if (event.results[i].isFinal) {
            console.log("[STT] Final:", transcriptPart);

            // Mark that user has started speaking
            if (!hasStartedSpeakingRef.current) {
              hasStartedSpeakingRef.current = true;
              console.log("[STT] User has started speaking for this question");
            }

            // Add to answer buffer
            answerBufferRef.current += " " + transcriptPart;
            transcriptBufferRef.current += " " + transcriptPart;

            // Update final transcript display
            setFinalTranscript(answerBufferRef.current.trim());
            setInterimTranscript("");

            // Update last activity time
            lastActivityRef.current = Date.now();

            // Clear existing timeout
            if (pauseTimeoutRef.current) {
              clearTimeout(pauseTimeoutRef.current);
              pauseTimeoutRef.current = null;
            }

            // Only start 2-second timer if:
            // 1. User has started speaking
            // 2. Not already submitting
            // 3. User hasn't manually muted the mic (use REF for immediate access)
            if (
              hasStartedSpeakingRef.current &&
              !isSubmittingRef.current &&
              !isUserMutedRef.current
            ) {
              pauseTimeoutRef.current = setTimeout(() => {
                // Double-check user hasn't muted in the meantime
                if (!isUserMutedRef.current) {
                  console.log(
                    "[STT] 2-second pause detected, submitting answer..."
                  );
                  submitAnswer();
                } else {
                  console.log(
                    "[STT] Timer fired but user muted - canceling submission"
                  );
                }
              }, PAUSE_THRESHOLD);
            } else if (isSubmittingRef.current) {
              console.log(
                "[STT] Ignoring pause timer - submission already in progress"
              );
            } else if (isUserMutedRef.current) {
              console.log("[STT] Ignoring pause timer - user has muted mic");
            }
          } else {
            interim += transcriptPart;
            lastActivityRef.current = Date.now();

            // Mark that user has started speaking (even for interim)
            if (!hasStartedSpeakingRef.current && interim.trim().length > 0) {
              hasStartedSpeakingRef.current = true;
              console.log("[STT] User has started speaking (interim detected)");
            }
          }
        }

        // Only update UI, don't log every interim change
        if (interim) {
          setInterimTranscript(interim);
        }
      };

      recognition.onstart = () => {
        // Reduced logging - only log when actually starting
      };

      recognition.onerror = (event: any) => {
        // Ignore common/expected errors
        const ignoredErrors = ["no-speech", "aborted", "audio-capture"];
        if (!ignoredErrors.includes(event.error)) {
          console.error("[STT] Error:", event.error);
        }
      };

      recognition.onend = () => {
        // Prevent rapid restart loops - only allow restart after 500ms delay
        if (sttRestartTimeoutRef.current) {
          // Already waiting for restart, ignore this event
          return;
        }

        // Auto-restart ONLY if:
        // 1. Currently in interview screen (NOT setup, loading, ready, or complete) - use REF
        // 2. Not currently speaking (AI is not talking) - use REF
        // 3. Not submitting answer - use REF
        // 4. User hasn't manually muted mic - use REF
        const shouldRestart =
          currentScreenRef.current === "interview" &&
          !isSpeakingRef.current &&
          !isSubmittingRef.current &&
          !isUserMutedRef.current;

        if (shouldRestart) {
          // Debounce restart to prevent rapid loops
          sttRestartTimeoutRef.current = setTimeout(() => {
            sttRestartTimeoutRef.current = null;
            try {
              recognition.start();
              console.log("[STT] Auto-restarted recognition");
            } catch (error: any) {
              // Ignore "already started" errors
              if (
                !error.message ||
                !error.message.includes("already started")
              ) {
                console.error("[STT] Error restarting:", error);
              }
            }
          }, 500);
        } else {
          const reason =
            currentScreenRef.current !== "interview"
              ? `screen is ${currentScreenRef.current}`
              : isSubmittingRef.current
              ? "submission in progress"
              : isUserMutedRef.current
              ? "user muted"
              : isSpeakingRef.current
              ? "AI speaking"
              : "unknown";
          // Only log reasons occasionally to avoid spam
          if (Math.random() < 0.1) {
            // Log 10% of the time
            console.log(`[STT] Not auto-restarting: ${reason}`);
          }
        }
      };

      speechRecognitionRef.current = recognition;
      console.log("[STT] Speech recognition initialized successfully");
    } else {
      console.error("[STT] Failed to initialize speech recognition");
      setSpeechRecognitionAvailable(false);
    }

    return () => {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
      if (sttRestartTimeoutRef.current) {
        clearTimeout(sttRestartTimeoutRef.current);
      }
    };
  }, []); // Empty deps - initialize ONCE only, don't recreate on state changes

  // Load browser TTS voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    loadBrowserVoices();
    window.speechSynthesis.onvoiceschanged = loadBrowserVoices;
  }, []);

  // Listen for models loading (MediaPipe and YOLO)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkModelsLoaded = () => {
      // Check if both MediaPipe and YOLO are loaded
      const mediaPipeLoaded = (window as any).mediaPipeLoaded || false;
      const yoloLoaded = (window as any).yoloLoaded || false;

      // Only log and update if both models just loaded (not already marked as loaded)
      if (mediaPipeLoaded && yoloLoaded && !modelsLoaded) {
        console.log("[Models] ✅ All models loaded successfully");
        setModelsLoaded(true);
      }
    };

    // Check every second
    const interval = setInterval(checkModelsLoaded, 1000);

    // Also listen for custom events
    window.addEventListener("mediapipe-loaded", checkModelsLoaded);
    window.addEventListener("yolo-loaded", checkModelsLoaded);

    return () => {
      clearInterval(interval);
      window.removeEventListener("mediapipe-loaded", checkModelsLoaded);
      window.removeEventListener("yolo-loaded", checkModelsLoaded);
    };
  }, [modelsLoaded]);

  // Timer
  useEffect(() => {
    if (currentScreen !== "interview") return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          // In testing mode, don't auto-end interview when timer expires
          // Only end when all questions are answered (handled in askNextQuestion)
          if (!TESTING_MODE) {
            console.log("[Timer] Time expired, ending interview...");
            endInterview();
          } else {
            console.log(
              "[Timer] Time expired but TESTING_MODE is enabled, continuing..."
            );
          }
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

      {currentScreen === "loading" && (
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-12 text-center max-w-2xl">
            <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-2xl font-bold text-white mb-4">
              {loadingMessage}
            </h2>
            {preprocessingProgress > 0 && (
              <div className="mt-6">
                <div className="w-full bg-white/10 rounded-full h-3 mb-2">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-blue-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${preprocessingProgress}%` }}
                  ></div>
                </div>
                <p className="text-white/60 text-sm">
                  {preprocessingProgress}% complete
                </p>
              </div>
            )}
            {!speechRecognitionAvailable && (
              <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <p className="text-yellow-400 text-sm">
                  ⚠️ Voice recognition not available in your browser. Please use
                  Chrome, Edge, or Safari for voice features.
                </p>
              </div>
            )}
          </div>
          {/* Hidden VideoProcessing to preload models */}
          {initialConfig?.proctoring.cameraRequired && (
            <div
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                overflow: "hidden",
              }}
            >
              <VideoProcessing />
            </div>
          )}
        </div>
      )}

      {currentScreen === "ready" && (
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-12 text-center max-w-2xl">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-white mb-4">
              Ready to Begin!
            </h2>
            <p className="text-white/80 mb-8 text-lg leading-relaxed">
              All systems are ready. Click the button below to start your
              technical interview.
            </p>
            <div className="space-y-4 mb-8">
              <div className="flex items-center justify-center gap-2 text-white/60">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <span>Questions preprocessed</span>
              </div>
              {modelsLoaded && (
                <div className="flex items-center justify-center gap-2 text-white/60">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span>Proctoring models loaded</span>
                </div>
              )}
              {speechRecognitionAvailable && (
                <div className="flex items-center justify-center gap-2 text-white/60">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span>Voice recognition ready</span>
                </div>
              )}
            </div>
            {!speechRecognitionAvailable && (
              <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <p className="text-yellow-400 text-sm">
                  ⚠️ Voice recognition not available. You&apos;ll need to type your
                  answers or use Chrome/Edge browser.
                </p>
              </div>
            )}
            <Button
              size="lg"
              onClick={beginInterview}
              disabled={!preprocessedChunks.has(0)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-12 py-6 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {preprocessedChunks.has(0)
                ? "Start Interview"
                : "Preparing Questions..."}
            </Button>
          </div>
          {/* Hidden VideoProcessing to keep models loaded */}
          {initialConfig?.proctoring.cameraRequired && (
            <div
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                overflow: "hidden",
              }}
            >
              <VideoProcessing />
            </div>
          )}
        </div>
      )}

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
                    <Volume2
                      className={`w-12 h-12 text-white ${
                        isSpeaking ? "animate-pulse" : ""
                      }`}
                    />
                  </div>
                  <p className="text-white/70 text-sm">AI Interviewer</p>
                </div>
              </div>
            </div>

            {/* Candidate Webcam */}
            <div className="relative aspect-video bg-black/40 rounded-2xl border border-white/10 overflow-hidden">
              {initialConfig?.proctoring.cameraRequired && (
                <VideoProcessing autoStart={true} />
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

          {/* Status Indicators */}
          {isSpeaking && (
            <div className="mb-4 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-purple-500 rounded-full animate-pulse"></div>
                <p className="text-purple-300 font-semibold">
                  🔇 AI Speaking - Please wait, recording paused
                </p>
              </div>
            </div>
          )}

          {!isSpeaking && isRecording && (
            <div className="mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                  <div className="absolute inset-0 w-4 h-4 bg-green-500 rounded-full animate-ping"></div>
                </div>
                <p className="text-green-300 font-semibold">
                  🎤 Recording - Speak your answer now
                </p>
              </div>
            </div>
          )}

          {!isSpeaking && !isRecording && isUserMuted && (
            <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-yellow-500 rounded-full"></div>
                <p className="text-yellow-300 font-semibold">
                  🔇 Microphone Muted - Unmute to continue answering
                </p>
              </div>
            </div>
          )}

          {/* Transcript Display - Only show when user can/should speak */}
          {!isSpeaking && (
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-6 mb-6">
              <h3 className="text-white/60 text-sm mb-3">Your Answer:</h3>

              {/* Final Transcript */}
              {finalTranscript && (
                <div className="mb-3">
                  <p className="text-white/90 leading-relaxed">
                    {finalTranscript}
                  </p>
                </div>
              )}

              {/* Interim Transcript (Live) */}
              {interimTranscript && (
                <div className="border-t border-white/10 pt-3">
                  <p className="text-yellow-300 italic">{interimTranscript}</p>
                </div>
              )}

              {/* Placeholder */}
              {!finalTranscript && !interimTranscript && (
                <p className="text-white/40 italic">
                  {isUserMuted
                    ? "🔇 Microphone muted - unmute to answer"
                    : "Listening for your response... Take your time to think."}
                </p>
              )}

              {/* Auto-submit indicator */}
              {finalTranscript && !isUserMuted && (
                <div className="mt-3 text-white/50 text-xs">
                  💡 Answer will auto-submit after 2 seconds of silence
                </div>
              )}

              {/* Muted warning */}
              {isUserMuted && (finalTranscript || interimTranscript) && (
                <div className="mt-3 text-yellow-300 text-xs">
                  ⚠️ Microphone is muted - pause timer is disabled
                </div>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex justify-center gap-4">
            <Button
              variant="outline"
              size="lg"
              onClick={handleToggleMute}
              className={`${
                isUserMuted
                  ? "bg-red-500/20 border-red-500/50 text-red-300"
                  : "bg-green-500/20 border-green-500/50 text-green-300"
              } hover:bg-white/10`}
              title={
                isUserMuted
                  ? "Click to unmute microphone"
                  : "Click to mute microphone"
              }
            >
              {isUserMuted ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
              <span className="ml-2 text-sm">
                {isUserMuted ? "Unmute" : "Mute"}
              </span>
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
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-12 text-center max-w-2xl">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-6" />
            <h2 className="text-3xl font-bold text-white mb-4">
              Interview Complete!
            </h2>
            <p className="text-white/80 mb-8 text-lg leading-relaxed">
              {closingMessage ||
                "Thank you for completing the technical interview. Your responses have been recorded and will be evaluated shortly."}
            </p>
            <div className="mt-6 mb-8 p-4 bg-white/5 rounded-lg border border-white/10">
              <p className="text-white/60 text-sm">
                Questions Asked:{" "}
                <span className="text-white font-semibold">
                  {stats.questionsAsked}
                </span>
              </p>
            </div>
            <Button
              size="lg"
              onClick={() => (window.location.href = "/dashboard/candidate")}
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
