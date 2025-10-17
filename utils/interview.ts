import { getGeminiResponse } from "@/ai-engine/ai-call/aiCall";

export interface Question {
  id: string;
  question: string;
  category: "technical" | "non-technical" | "followup";
  difficulty?: "medium" | "hard";
  answer?: string;
  parentQuestion?: string;
  topicId?: string;
}

export interface Queues {
  queue0?: {
    use_video_processing: boolean;
    violation_count: number;
    mood_state: string;
    logs: any[];
  };
  queue1: Question[];
  queue2: Question[];
  queue3: Question[];
}

/**
 * Generates a unique ID for questions
 */
export function generateId(): string {
  return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Generates a unique topic ID for tracking related questions
 */
export function generateTopicId(question: string): string {
  return 'topic_' + question.substring(0, 20).replace(/\s+/g, '_').toLowerCase() + '_' + Math.random().toString(36).slice(2, 6);
}

/**
 * Ensures all questions in an array have unique IDs and topic IDs
 */
export function ensureIds(questions: Question[]): Question[] {
  return questions.map(q => ({
    ...q,
    id: q.id || generateId(),
    topicId: q.topicId || (q.category === 'technical' ? generateTopicId(q.question) : undefined)
  }));
}

/**
 * Randomizes questions while preserving intro/outro positions
 * Ensures non-technical questions are <= 20% of total
 */
export function randomizeQueue1(questions: Question[]): Question[] {
  if (questions.length === 0) return [];

  const technical = questions.filter(q => q.category === 'technical');
  const nonTechnical = questions.filter(q => q.category === 'non-technical');

  // Ensure intro and outro
  let intro = nonTechnical.find(q => 
    q.question.toLowerCase().includes('tell me about yourself') ||
    q.question.toLowerCase().includes('introduce yourself')
  );
  
  let outro = nonTechnical.find(q => 
    q.question.toLowerCase().includes('any questions for') ||
    q.question.toLowerCase().includes('anything else')
  );

  // Create intro/outro if not present
  if (!intro && nonTechnical.length > 0) {
    intro = nonTechnical[0];
  } else if (!intro) {
    intro = {
      id: generateId(),
      question: "Tell me about yourself and your background.",
      category: 'non-technical',
      answer: ''
    };
  }

  if (!outro && nonTechnical.length > 1) {
    outro = nonTechnical[nonTechnical.length - 1];
  } else if (!outro) {
    outro = {
      id: generateId(),
      question: "Do you have any questions for us, or is there anything else you'd like to add?",
      category: 'non-technical',
      answer: ''
    };
  }

  // Remove intro/outro from pools
  const remainingNonTech = nonTechnical.filter(q => q.id !== intro?.id && q.id !== outro?.id);

  // Calculate 20% limit for non-technical (excluding intro/outro)
  const totalMiddle = technical.length + remainingNonTech.length;
  const maxNonTech = Math.floor(totalMiddle * 0.20);
  const limitedNonTech = remainingNonTech.slice(0, maxNonTech);

  // Shuffle middle section
  const middle = [...technical, ...limitedNonTech];
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }

  // Combine: intro + shuffled middle + outro
  return [intro, ...middle, outro];
}

/**
 * Generic API call wrapper for Gemini AI
 */
export async function callGeminiAPI(prompt: string): Promise<string | null> {
  try {
    const result = await getGeminiResponse(prompt, false);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (error) {
    console.error('API Error:', error);
    return null;
  }
}

/**
 * Evaluation result structure
 */
export interface EvaluationResult {
  score: number;
  route_action: 'next_difficulty' | 'normal_flow' | 'followup';
  sources: string[];
  ideal_answer: string;
  reason?: string;
}

/**
 * Generate ideal answer with source URLs for a question
 */
export async function generateIdealAnswer(question: string): Promise<{ ideal_answer: string; source_urls: string[] } | null> {
  const prompt = `For this technical question, provide a comprehensive ideal answer with supporting sources:

Question: ${question}

Generate:
1. A detailed, technically accurate ideal answer
2. 2-3 authoritative source URLs that verify the answer (documentation, official sites, reputable tech resources)

Return ONLY a JSON object:
{
  "ideal_answer": "comprehensive technical answer",
  "source_urls": [
    "https://example.com/source1",
    "https://example.com/source2"
  ]
}

Ensure sources are real, authoritative URLs (e.g., MDN, official documentation, Stack Overflow, tech blogs).`;

  try {
    const result = await callGeminiAPI(prompt);
    if (!result) return null;

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ideal_answer: parsed.ideal_answer || '',
        source_urls: parsed.source_urls || []
      };
    }
    return null;
  } catch (error) {
    console.error('Error generating ideal answer:', error);
    return null;
  }
}

/**
 * Evaluate user answer against ideal answer
 * Returns structured evaluation with score, routing action, sources, and ideal answer
 */
export async function evaluateAnswer(
  question: string,
  userAnswer: string,
  idealAnswer?: string,
  sourceUrls?: string[]
): Promise<EvaluationResult | null> {
  try {
    // Generate ideal answer if not provided
    let finalIdealAnswer = idealAnswer;
    let finalSources = sourceUrls || [];

    if (!finalIdealAnswer) {
      const generated = await generateIdealAnswer(question);
      if (generated) {
        finalIdealAnswer = generated.ideal_answer;
        finalSources = generated.source_urls;
      } else {
        finalIdealAnswer = "No ideal answer available";
      }
    }

    // Evaluate correctness
    const analysisPrompt = `Compare these answers and determine correctness percentage:

Question: ${question}
Ideal Answer: ${finalIdealAnswer}
User's Answer: ${userAnswer}

Analyze the user's answer against the ideal answer. Consider:
- Technical accuracy
- Completeness of explanation
- Correct terminology usage
- Conceptual understanding

Return ONLY a JSON object:
{
  "correctness": 85,
  "reason": "Brief explanation of scoring",
  "route_action": "next_difficulty"
}

Where:
- correctness: 0-100 score
- reason: Brief explanation
- route_action: "next_difficulty" (≥80%), "normal_flow" (10-80%), or "followup" (≤10%)`;

    const analysisResult = await callGeminiAPI(analysisPrompt);
    if (!analysisResult) {
      return {
        score: 50,
        route_action: 'normal_flow',
        sources: finalSources,
        ideal_answer: finalIdealAnswer,
        reason: 'Unable to evaluate'
      };
    }

    const jsonMatch = analysisResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return {
        score: analysis.correctness || 50,
        route_action: analysis.route_action || 'normal_flow',
        sources: finalSources,
        ideal_answer: finalIdealAnswer,
        reason: analysis.reason
      };
    }

    return {
      score: 50,
      route_action: 'normal_flow',
      sources: finalSources,
      ideal_answer: finalIdealAnswer
    };

  } catch (error) {
    console.error('Error evaluating answer:', error);
    return null;
  }
}