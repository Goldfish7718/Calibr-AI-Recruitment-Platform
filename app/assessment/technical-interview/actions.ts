"use server";

import { connectToDatabase } from "@/utils/connectDb";
import TechnicalInterviewModel from "@/models/technicalInterview.model";
import { buildQueue1Prompt, buildQueue2Prompt, buildFollowupPrompt } from "@/ai-engine/prompts/technicalInterview";
import TechnicalInterviewEvaluationModel from "@/models/technicalInterviewEvaluation.model";
import mongoose from "mongoose";
import { requireAuth } from "@/utils/auth-helpers";
import { Question, Queues, generateId, ensureIds, callGeminiAPI, randomizeQueue1, generateIdealAnswer, evaluateAnswer, EvaluationResult } from "@/utils/interview";
import { S3Service } from "@/lib/s3Service";
import type { QuestionEntry } from "@/lib/interview/types";

export async function getInterviewConfig(interviewId: string) {
  try {
    await connectToDatabase();
    const config = await TechnicalInterviewModel.findById(interviewId).lean();
    
    if (!config) {
      return { success: false, error: 'Interview configuration not found' };
    }

    // Serialize to plain JSON-safe object (convert ObjectIds/Dates to strings)
    const serialized = JSON.parse(JSON.stringify(config));
    return { success: true, config: serialized };
  } catch (error) {
    console.error('Error fetching interview config:', error);
    return { success: false, error: 'Failed to fetch interview configuration' };
  }
}

export async function generateQuestions(context: {
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
}): Promise<{ success: boolean; queues?: Queues; error?: string }> {
  try {
    // Validate required context
    if (!context.jobData || !context.resumeData) {
      return { 
        success: false, 
        error: 'Job and resume data are required to generate personalized questions' 
      };
    }

    // Generate Queue 1 questions with job and resume context
    const q1Prompt = buildQueue1Prompt(context.jobData, context.resumeData);

    const q1Result = await callGeminiAPI(q1Prompt);
    let queue1: Question[] = [];

    if (q1Result) {
      try {
        const jsonMatch = q1Result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          queue1 = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    }

    queue1 = ensureIds(queue1);

    // Randomize Queue 1 while maintaining intro/outro and 20% non-technical limit
    queue1 = randomizeQueue1(queue1);

    console.log(`[generateQuestions] ✓ Generated ${queue1.length} Q1 questions (basic structure only, no answers yet)`);

    // NOTE: Q2 generation happens dynamically during interview based on correctness scores
    // NOTE: Ideal answers, sources, and TTS audio are generated during chunk preprocessing

    return {
      success: true,
      queues: {
        queue1,
        queue2: [], // Q2 generated dynamically during interview
        queue3: []  // Q3 generated dynamically during interview
      }
    };

  } catch (error) {
    console.error('Error generating questions:', error);
    return { success: false, error: 'Failed to generate questions' };
  }
}

// Evaluation lifecycle
export async function startEvaluation(technicalInterviewId: string, assessmentId?: string | null, jobId?: string | null) {
  try {
    await connectToDatabase();
    const candidateId = await requireAuth();
    
    // Check if evaluation already exists for this interview and candidate
    const existingEvaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: new mongoose.Types.ObjectId(technicalInterviewId),
      status: { $in: ['in_progress', 'not_started'] }
    });

    if (existingEvaluation) {
      const existingId = (existingEvaluation as any)._id.toString();
      console.log('[Server] Using existing evaluation:', existingId);
      return { 
        success: true, 
        evaluationId: existingId,
        resumed: true 
      };
    }

    // Create new evaluation only if none exists
    const doc = await TechnicalInterviewEvaluationModel.create({
      candidateId: new mongoose.Types.ObjectId(candidateId),
      technicalInterviewId: new mongoose.Types.ObjectId(technicalInterviewId),
      assessmentId: assessmentId ? new mongoose.Types.ObjectId(assessmentId) : undefined,
      jobId: jobId ? new mongoose.Types.ObjectId(jobId) : undefined,
      startedAt: new Date(),
      status: 'in_progress',
      q1Questions: [],  // Initialize empty arrays
      askedQuestions: [],
    });
    const id = (doc && (doc as any)._id) ? (doc as any)._id.toString() : undefined;
    console.log('[Server] Created new evaluation:', id);
    return { success: true, evaluationId: id, resumed: false };
  } catch (error) {
    console.error('Error starting evaluation:', error);
    return { success: false, error: 'Failed to start evaluation' };
  }
}

export async function appendQA(
  technicalInterviewId: string, 
  entry: QuestionEntry
) {
  try {
    await connectToDatabase();
    
    // Map QuestionEntry fields to database schema
    const dbEntry = {
      question: entry.question_text,
      correctAnswer: entry.ideal_answer,
      userAnswer: entry.user_answer,
      correctness: entry.correctness_score,
      askedAt: entry.timestamp || new Date(),
      // Store new fields
      question_text: entry.question_text,
      user_answer: entry.user_answer,
      ideal_answer: entry.ideal_answer,
      correctness_score: entry.correctness_score,
      source_urls: entry.source_urls,
      question_type: entry.question_type,
      queue_number: entry.queue_number,
      timestamp: entry.timestamp || new Date(),
      mood_state: entry.mood_state,
      violation_snapshot: entry.violation_snapshot
    };

    await TechnicalInterviewEvaluationModel.findOneAndUpdate(
      { technicalInterviewId: new mongoose.Types.ObjectId(technicalInterviewId) },
      { $push: { entries: dbEntry } },
      { upsert: true, new: true }
    ).lean();
    
    return { success: true };
  } catch (error) {
    console.error('Error appending QA:', error);
    return { success: false, error: 'Failed to append QA' };
  }
}

export async function analyzeAnswer(
  question: string,
  correctAnswer: string,
  userAnswer: string,
  currentQueues: Queues,
  currentQuestion: Question
): Promise<{ updatedQueues?: Queues; correctness?: number; evaluation?: EvaluationResult }> {
  try {
    // Edge case: If either idealAnswer or userAnswer is missing, skip evaluation and Q2/Q3 generation
    if (!correctAnswer || correctAnswer.trim().length === 0 || !userAnswer || userAnswer.trim().length === 0) {
      console.warn('[analyzeAnswer] Missing idealAnswer or userAnswer, skipping evaluation and Q2/Q3 generation');
      // Return undefined correctness to avoid triggering any queue logic (Q2 or Q3)
      // This ensures we simply move to next question without any queue modifications
      return {};
    }

    // Get source URLs from question if available
    const sourceUrls = (currentQuestion as any).source_urls || [];
    
    // Use the new evaluateAnswer function for comprehensive evaluation
    const evaluation = await evaluateAnswer(question, userAnswer, correctAnswer, sourceUrls);
    
    // If evaluation returns null (due to missing data), skip Q2/Q3 generation
    if (!evaluation) {
      console.warn('[analyzeAnswer] Evaluation failed, skipping Q2/Q3 generation');
      // Return undefined correctness to avoid triggering any queue logic (Q2 or Q3)
      return {};
    }

    const correctness = evaluation.score;
    const updatedQueues = { ...currentQueues };

    // Apply flow rules based on correctness and route_action
    if (evaluation.route_action === 'followup' || correctness <= 10) {
      // Generate follow-up for very wrong answer
      const followupPrompt = buildFollowupPrompt(question, userAnswer);

      const followupResult = await callGeminiAPI(followupPrompt);
      
      if (followupResult) {
        try {
          const jsonMatch = followupResult.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const followup = JSON.parse(jsonMatch[0]);
            updatedQueues.queue3.push({
              question: followup.question,
              category: 'followup',
              parentQuestion: currentQuestion.id, // Store question ID, not full text
              topicId: currentQuestion.topicId,
              id: generateId()
            });

            // Discard all depth questions for this topic (Queue 2)
            if (currentQuestion.topicId) {
              updatedQueues.queue2 = updatedQueues.queue2.filter(
                q => q.topicId !== currentQuestion.topicId
              );
            }
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      }
    } else if (evaluation.route_action === 'next_difficulty' || correctness >= 50) {
      // Progress to next difficulty level (LOWERED from 80% to 50%)
      // This allows Q2 follow-ups for decent answers, not just excellent ones
      console.log(`[analyzeAnswer] Score ${correctness}% ≥ 50%, generating Q2 follow-ups`);
      const topicId = currentQuestion.topicId || currentQuestion.id;
      
      if (currentQuestion.category === 'technical') {
        // Generate Q2 medium/hard questions for this topic
        console.log(`[analyzeAnswer] Generating Q2 questions for topic: ${topicId}`);
        
        try {
          const q2Prompt = buildQueue2Prompt(question, correctAnswer);
          const q2Result = await callGeminiAPI(q2Prompt);
          
          if (q2Result) {
            const jsonMatch = q2Result.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const q2Questions = JSON.parse(jsonMatch[0]);
              console.log(`[analyzeAnswer] Generated ${q2Questions.length} Q2 questions`);
              
              // Add medium/hard questions to queue2 with metadata
              for (const q2 of q2Questions) {
                updatedQueues.queue2.push({
                  ...q2,
                  topicId: topicId,
                  parentQuestionId: currentQuestion.id,
                  id: generateId(),
                  queueType: 'Q2'
                });
              }
            }
          }
        } catch (e) {
          console.error('[analyzeAnswer] Error generating Q2 questions:', e);
        }
        
        // Now move FIRST medium question to Queue 1 for immediate asking
        if (!currentQuestion.difficulty) {
          // Base question with high score → move MEDIUM to Queue 1
          const mediumQ = updatedQueues.queue2.find(
            q => q.topicId === topicId && q.difficulty === 'medium'
          );
          if (mediumQ) {
            console.log(`[analyzeAnswer] Moving medium Q2 to Queue 1: "${mediumQ.question.substring(0, 60)}..."`);
            updatedQueues.queue2 = updatedQueues.queue2.filter(q => q.id !== mediumQ.id);
            updatedQueues.queue1.unshift(mediumQ); // Add to front of Queue 1
          }
        } else if (currentQuestion.difficulty === 'medium') {
          // Medium question with high score → move HARD to Queue 1
          const hardQ = updatedQueues.queue2.find(
            q => q.topicId === topicId && q.difficulty === 'hard'
          );
          if (hardQ) {
            console.log(`[analyzeAnswer] Moving hard Q2 to Queue 1: "${hardQ.question.substring(0, 60)}..."`);
            updatedQueues.queue2 = updatedQueues.queue2.filter(q => q.id !== hardQ.id);
            updatedQueues.queue1.unshift(hardQ); // Add to front of Queue 1
          }
        }
      }
    }
    // route_action === 'normal_flow' or 10-80%: Just proceed to next question (no special action)

    return { updatedQueues, correctness, evaluation };

  } catch (error) {
    console.error('Error analyzing answer:', error);
    return {};
  }
}

/**
 * Check video processing violations from localStorage/session
 * This should be called from client-side video processing component
 */
// This function is server-side but needs client data
// For now it's a placeholder - actual implementation should use a client-side hook
export async function checkVideoViolations(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _interviewId: string
) {
  // NOTE: This is a server action and cannot directly access client-side videoQueueIntegration
  // The video state should be passed from client or stored in a way accessible to server
  // For now, returning default values - actual implementation needs client-server bridge
  
  return {
    violation_count: 0,
    mood_state: 'neutral',
    should_end: false,
    mood_changed: false
  };
}

// ============================================================================
// NEW CHUNKING STRATEGY: Q1 Questions Array + Asked Questions Array
// ============================================================================

/**
 * Store Q1 questions array in evaluation document (basic data only)
 * Called immediately after question generation
 */
export async function storeQ1Questions(
  interviewId: string,
  q1Questions: Array<{
    id: string;
    question: string;
    category: 'technical' | 'non-technical';
    difficulty?: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const evaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: interviewId,
      status: 'in_progress'
    });

    if (!evaluation) {
      return { success: false, error: 'Evaluation not found' };
    }

    evaluation.q1Questions = q1Questions;
    await evaluation.save();

    console.log(`[Server] Stored ${q1Questions.length} Q1 questions for interview ${interviewId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error storing Q1 questions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get Q1 questions for a specific chunk (dynamic chunking: index ÷ 5)
 */
export async function getQ1QuestionsForChunk(
  interviewId: string,
  chunkNumber: number
): Promise<{
  success: boolean;
  questions?: Array<{
    id: string;
    question: string;
    category: 'technical' | 'non-technical';
    difficulty?: string;
  }>;
  error?: string;
}> {
  try {
    await connectToDatabase();

    const evaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: interviewId,
      status: 'in_progress'
    }).lean();

    if (!evaluation || !evaluation.q1Questions) {
      return { success: false, error: 'Q1 questions not found' };
    }

    // Dynamic chunking: chunk 0 = questions 0-4, chunk 1 = questions 5-9, etc.
    const startIndex = chunkNumber * 5;
    const endIndex = startIndex + 5;
    const chunkQuestions = evaluation.q1Questions.slice(startIndex, endIndex);

    // Serialize to plain JSON-safe objects (remove any potential MongoDB-specific fields)
    const serializedQuestions = JSON.parse(JSON.stringify(chunkQuestions));

    console.log(`[Server] Retrieved ${chunkQuestions.length} Q1 questions for chunk ${chunkNumber}`);
    return { success: true, questions: serializedQuestions };
  } catch (error: any) {
    console.error('Error retrieving Q1 questions for chunk:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Preprocess a single question (generate ideal answer and sources)
 * Server action to avoid exposing API keys on client side
 */
export async function preprocessQuestion(questionText: string): Promise<{
  success: boolean;
  answer?: string;
  source_urls?: string[];
  error?: string;
}> {
  try {
    const result = await generateIdealAnswer(questionText);
    
    if (result) {
      return {
        success: true,
        answer: result.ideal_answer,
        source_urls: result.source_urls
      };
    }
    
    return { success: false, error: 'Failed to generate ideal answer' };
  } catch (error: any) {
    console.error('Error preprocessing question:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate Q2 (medium + hard) follow-up questions for a Q1 question
 * Server action to avoid exposing API keys on client side
 * Returns the generated questions with preprocessed answers
 */
export async function generateQ2Questions(
  q1QuestionId: string,
  q1QuestionText: string,
  q1IdealAnswer: string
): Promise<{
  success: boolean;
  mediumQuestion?: {
    id: string;
    question: string;
    answer: string;
    source_urls: string[];
  };
  hardQuestion?: {
    id: string;
    question: string;
    answer: string;
    source_urls: string[];
  };
  error?: string;
}> {
  try {
    console.log(`[Server] Generating Q2 for ${q1QuestionId}...`);
    
    // Generate Q2 questions using Gemini
    const q2Prompt = buildQueue2Prompt(q1QuestionText, q1IdealAnswer);
    const q2Result = await callGeminiAPI(q2Prompt);
    
    if (!q2Result) {
      return { success: false, error: 'Failed to generate Q2 questions' };
    }
    
    const jsonMatch = q2Result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { success: false, error: 'Invalid Q2 response format' };
    }
    
    let q2Questions;
    try {
      // Sanitize control characters that might break JSON parsing
      const sanitizedJson = jsonMatch[0]
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, ' ')  // Replace control characters with space
        .replace(/\s+/g, ' ');  // Normalize whitespace
      
      q2Questions = JSON.parse(sanitizedJson);
    } catch (parseError) {
      console.error(`[Server] JSON parse error in Q2 generation:`, parseError);
      console.error(`[Server] Original response length: ${jsonMatch[0].length}`);
      return { success: false, error: `Failed to parse Q2 JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}` };
    }
    
    console.log(`[Server] Generated ${q2Questions.length} Q2 questions`);
    
    // Process medium question
    const mediumQ = q2Questions.find((q: any) => q.difficulty === 'medium');
    let mediumResult = undefined;
    
    if (mediumQ) {
      const mediumId = `${q1QuestionId}_medium`;
      console.log(`[Server] Processing medium Q2: ${mediumId}`);
      
      // Generate ideal answer for medium (or use provided answer)
      let mediumAnswer = mediumQ.answer || '';
      let mediumSources: string[] = [];
      
      if (!mediumAnswer) {
        const answerResult = await generateIdealAnswer(mediumQ.question);
        if (answerResult) {
          mediumAnswer = answerResult.ideal_answer;
          mediumSources = answerResult.source_urls;
        }
      }
      
      mediumResult = {
        id: mediumId,
        question: mediumQ.question,
        answer: mediumAnswer,
        source_urls: mediumSources
      };
      
      console.log(`[Server] ✓ Medium Q2 preprocessed`);
    }
    
    // Process hard question
    const hardQ = q2Questions.find((q: any) => q.difficulty === 'hard');
    let hardResult = undefined;
    
    if (hardQ) {
      const hardId = `${q1QuestionId}_hard`;
      console.log(`[Server] Processing hard Q2: ${hardId}`);
      
      // Generate ideal answer for hard (or use provided answer)
      let hardAnswer = hardQ.answer || '';
      let hardSources: string[] = [];
      
      if (!hardAnswer) {
        const answerResult = await generateIdealAnswer(hardQ.question);
        if (answerResult) {
          hardAnswer = answerResult.ideal_answer;
          hardSources = answerResult.source_urls;
        }
      }
      
      hardResult = {
        id: hardId,
        question: hardQ.question,
        answer: hardAnswer,
        source_urls: hardSources
      };
      
      console.log(`[Server] ✓ Hard Q2 preprocessed`);
    }
    
    return {
      success: true,
      mediumQuestion: mediumResult,
      hardQuestion: hardResult
    };
    
  } catch (error: any) {
    console.error('[Server] Error generating Q2 questions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add preprocessed question to askedQuestions array
 * Called after preprocessing (generating answers, sources, TTS audio)
 */
export async function addAskedQuestion(
  interviewId: string,
  question: {
    id: string;
    question: string;
    category: 'technical' | 'non-technical';
    difficulty?: string;
    queueType: 'Q1' | 'Q2' | 'Q3';
    parentQuestionId?: string;
    askedAt?: Date;  // Optional - only set when audio playback starts
    preprocessed: boolean;
    answer?: string;
    source_urls?: string[];
    audioUrl?: string;
    userAnswer?: string;
    correctness?: number;
  },
  insertAfterQuestionId?: string  // For Q2: insert after parent Q1
): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const evaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: interviewId,
      status: 'in_progress'
    });

    if (!evaluation) {
      return { success: false, error: 'Evaluation not found' };
    }

    if (!evaluation.askedQuestions) {
      evaluation.askedQuestions = [];
    }

    if (insertAfterQuestionId) {
      // Insert Q2 immediately after parent Q1
      const parentIndex = evaluation.askedQuestions.findIndex(
        q => q.id === insertAfterQuestionId
      );
      
      if (parentIndex !== -1) {
        evaluation.askedQuestions.splice(parentIndex + 1, 0, question as any);
      } else {
        // Parent not found, append at end
        evaluation.askedQuestions.push(question as any);
      }
    } else {
      // Append at end (for Q1 questions)
      evaluation.askedQuestions.push(question as any);
    }

    await evaluation.save();

    console.log(`[Server] Added question ${question.id} to askedQuestions (queueType: ${question.queueType})`);
    return { success: true };
  } catch (error: any) {
    console.error('Error adding asked question:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Mark a question as asked by updating its askedAt timestamp to now.
 * Called when audio playback for that question begins.
 */
export async function markQuestionAsked(
  interviewId: string,
  questionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const result = await TechnicalInterviewEvaluationModel.findOneAndUpdate(
      {
        technicalInterviewId: interviewId,
        status: 'in_progress',
        'askedQuestions.id': questionId
      },
      {
        $set: {
          'askedQuestions.$.askedAt': new Date()
        }
      },
      { new: true }
    );

    if (!result) {
      return { success: false, error: 'Question not found to mark askedAt' };
    }

    console.log(`[Server] Marked question ${questionId} as asked (askedAt set to now)`);
    return { success: true };
  } catch (error: any) {
    console.error('Error marking question askedAt:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update user answer for a question in askedQuestions array
 */
export async function updateAskedQuestionAnswer(
  interviewId: string,
  questionId: string,
  userAnswer: string,
  correctness?: number
): Promise<{ success: boolean; error?: string; shouldDeleteFollowups?: boolean }> {
  try {
    await connectToDatabase();

    console.log(`[Server] Updating answer for question: ${questionId}`);
    console.log(`[Server] Answer length: ${userAnswer.length} chars`);
    console.log(`[Server] Correctness: ${correctness}`);

    const evaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: interviewId,
      status: 'in_progress'
    });

    if (!evaluation) {
      return { success: false, error: 'Evaluation not found' };
    }

    // Find the question being answered
    const currentQuestion = evaluation.askedQuestions.find((q: any) => q.id === questionId);
    if (!currentQuestion) {
      console.error(`[Server] ❌ Question ${questionId} not found in askedQuestions`);
      return { success: false, error: 'Question not found in askedQuestions' };
    }

    // Update the answer
    currentQuestion.userAnswer = userAnswer;
    currentQuestion.correctness = correctness;

    // Determine if we should delete Q2 follow-ups based on score
    let shouldDeleteFollowups = false;
    
    if (currentQuestion.queueType === 'Q1' && 
        currentQuestion.category === 'technical' && 
        correctness !== undefined && 
        correctness < 50) {
      
      console.log(`[Server] ⚠️ Q1 Low score (${correctness}%) - will delete both medium and hard Q2 for ${questionId}`);
      shouldDeleteFollowups = true;
      
      // Delete both medium and hard questions for failed Q1
      const mediumId = `${questionId}_medium`;
      const hardId = `${questionId}_hard`;
      
      const beforeCount = evaluation.askedQuestions.length;
      evaluation.askedQuestions = evaluation.askedQuestions.filter((q: any) => 
        q.id !== mediumId && q.id !== hardId
      );
      const afterCount = evaluation.askedQuestions.length;
      const deletedCount = beforeCount - afterCount;
      
      if (deletedCount > 0) {
        console.log(`[Server] 🗑️ Deleted ${deletedCount} Q2 follow-up questions (${mediumId}, ${hardId})`);
      }
    } else if (currentQuestion.queueType === 'Q2' && 
               currentQuestion.difficulty === 'medium' &&
               currentQuestion.category === 'technical' && 
               correctness !== undefined && 
               correctness < 50) {
      
      console.log(`[Server] ⚠️ Q2 Medium Low score (${correctness}%) - will delete only hard Q2 for ${currentQuestion.parentQuestionId}`);
      
      // Delete only the hard question (keep medium)
      const hardId = `${currentQuestion.parentQuestionId}_hard`;
      
      const beforeCount = evaluation.askedQuestions.length;
      evaluation.askedQuestions = evaluation.askedQuestions.filter((q: any) => 
        q.id !== hardId
      );
      const afterCount = evaluation.askedQuestions.length;
      
      if (beforeCount > afterCount) {
        console.log(`[Server] 🗑️ Deleted hard Q2 (${hardId}) due to low medium Q2 score`);
      }
    } else if (correctness !== undefined && correctness >= 50) {
      if (currentQuestion.queueType === 'Q1') {
        console.log(`[Server] ✅ Q1 Good score (${correctness}%) - Q2 follow-ups will be asked`);
      } else if (currentQuestion.queueType === 'Q2' && currentQuestion.difficulty === 'medium') {
        console.log(`[Server] ✅ Q2 Medium Good score (${correctness}%) - Hard Q2 will be asked`);
      }
    }

    // Save to DB
    await evaluation.save();

    // Verify the update
    console.log(`[Server] ✓ Answer updated in DB for ${questionId}`);
    console.log(`[Server] Stored userAnswer length: ${currentQuestion.userAnswer?.length || 0}`);
    console.log(`[Server] Stored correctness: ${currentQuestion.correctness}`);

    return { 
      success: true,
      shouldDeleteFollowups
    };
  } catch (error: any) {
    console.error('Error updating asked question answer:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove question from askedQuestions array (for discarded Q2 questions)
 */
export async function removeAskedQuestion(
  interviewId: string,
  questionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const evaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: interviewId,
      status: 'in_progress'
    });

    if (!evaluation || !evaluation.askedQuestions) {
      return { success: false, error: 'Evaluation or askedQuestions not found' };
    }

    evaluation.askedQuestions = evaluation.askedQuestions.filter(
      q => q.id !== questionId
    );

    await evaluation.save();

    console.log(`[Server] Removed question ${questionId} from askedQuestions`);
    return { success: true };
  } catch (error: any) {
    console.error('Error removing asked question:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all asked questions for an interview (sorted by askedAt)
 */
export async function getAskedQuestions(
  interviewId: string
): Promise<{
  success: boolean;
  questions?: Array<any>;
  error?: string;
}> {
  try {
    await connectToDatabase();

    const evaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: interviewId,
      status: 'in_progress'
    }).lean();

    if (!evaluation || !evaluation.askedQuestions) {
      return { success: true, questions: [] };
    }

    // Sort by askedAt timestamp
    // Questions without askedAt (not yet asked) should come after questions with askedAt
    const sortedQuestions = [...evaluation.askedQuestions].sort((a, b) => {
      const aTime = a.askedAt ? new Date(a.askedAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.askedAt ? new Date(b.askedAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

    // Serialize to plain JSON-safe objects (remove MongoDB-specific fields)
    const serializedQuestions = JSON.parse(JSON.stringify(sortedQuestions));

    return { success: true, questions: serializedQuestions };
  } catch (error: any) {
    console.error('Error retrieving asked questions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get Q1 questions array from evaluation
 */
export async function getQ1Questions(
  interviewId: string
): Promise<{
  success: boolean;
  q1Questions?: Array<{
    id: string;
    question: string;
    category: 'technical' | 'non-technical';
    difficulty?: string;
  }>;
  preprocessedChunks?: number[];
  error?: string;
}> {
  try {
    await connectToDatabase();

    const evaluation = await TechnicalInterviewEvaluationModel.findOne({
      technicalInterviewId: interviewId,
      status: 'in_progress'
    }).lean();

    if (!evaluation) {
      return { success: false, error: 'Evaluation not found' };
    }

    return { 
      success: true, 
      q1Questions: (evaluation.q1Questions || []).map((q: any) => ({
        id: q.id,
        question: q.question,
        category: q.category,
        difficulty: q.difficulty,
      })),
      preprocessedChunks: evaluation.preprocessedChunks || []
    };
  } catch (error: any) {
    console.error('Error getting Q1 questions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Mark chunk as preprocessed
 */
export async function markChunkPreprocessed(
  interviewId: string,
  chunkNumber: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    await TechnicalInterviewEvaluationModel.findOneAndUpdate(
      {
        technicalInterviewId: interviewId,
        status: 'in_progress'
      },
      {
        $addToSet: { preprocessedChunks: chunkNumber }
      }
    );

    console.log(`[Server] Marked chunk ${chunkNumber} as preprocessed`);
    return { success: true };
  } catch (error: any) {
    console.error('Error marking chunk as preprocessed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Mark interview evaluation as completed
 * Sets status to 'completed' and records endedAt timestamp
 */
export async function completeInterview(interviewId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const result = await TechnicalInterviewEvaluationModel.findOneAndUpdate(
      {
        technicalInterviewId: interviewId,
        status: 'in_progress'
      },
      {
        $set: {
          status: 'completed',
          endedAt: new Date()
        }
      },
      { new: true }
    );

    if (!result) {
      return { success: false, error: 'Interview not found or already completed' };
    }

    console.log(`[Server] Interview ${interviewId} marked as completed`);
    return { success: true };
  } catch (error: any) {
    console.error('Error completing interview:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete all TTS audio files for an interview
 */
export async function deleteInterviewAudio(interviewId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // All TTS audio files are stored with prefix: interviews/technical/{interviewId}/audio/
    const prefix = `interviews/technical/${interviewId}/audio/`;
    await S3Service.deleteByPrefix(prefix);
    console.log(`[Server] Deleted all audio files for interview ${interviewId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting interview audio:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Store video processing logs in evaluation document
 * Called periodically from client-side video processing
 */
export async function storeVideoLogs(
  interviewId: string,
  logs: Array<{
    timestamp: Date;
    mood?: string;
    gesture?: string;
    objects?: string[];
    violationType?: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const result = await TechnicalInterviewEvaluationModel.findOneAndUpdate(
      {
        technicalInterviewId: interviewId,
        status: 'in_progress'
      },
      {
        $push: {
          videoLogs: { $each: logs }
        }
      },
      { new: true }
    );

    if (!result) {
      return { success: false, error: 'Evaluation not found' };
    }

    console.log(`[Server] Stored ${logs.length} video logs for interview ${interviewId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error storing video logs:', error);
    return { success: false, error: error.message };
  }
}