"use server";

import { buildFollowupPrompt, buildQueue2Prompt } from "@/ai-engine/prompts/technicalInterview";
import { Question, Queues, generateId, callGeminiAPI, evaluateAnswer, EvaluationResult } from "@/utils/interview";

/**
 * Answer Analysis Actions
 * Handles answer evaluation and queue routing logic
 */

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
    mood_changed: false,
    current_violations: []
  };
}
