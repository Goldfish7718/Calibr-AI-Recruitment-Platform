import { EngineAdapter } from "@/lib/interview/types";
import { getInterviewConfig, startEvaluation, generateQuestionsBatch, analyzeAnswer, appendQA } from "./actions";
import { checkVideoViolationsClient } from "@/lib/interview/clientVideoAdapter";

export const technicalInterviewAdapter: EngineAdapter = {
  getConfig: (interviewId: string) => getInterviewConfig(interviewId),
  startEvaluation: (interviewId: string) => startEvaluation(interviewId),
  generateBatch: (contextData: any, count: number) => generateQuestionsBatch(contextData, count),
  analyze: (question, correctAnswer, userAnswer, queues, currentQuestion) =>
    analyzeAnswer(question, correctAnswer, userAnswer, queues as any, currentQuestion as any),
  persistQA: (interviewId, entry) => appendQA(interviewId, entry),
  checkVideoViolations: () => checkVideoViolationsClient(), // Use client-side check
};


