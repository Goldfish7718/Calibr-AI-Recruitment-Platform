# Gemini Correctness Evaluation and Answer Verification

## Overview

This document describes the Gemini-powered correctness evaluation system that analyzes candidate answers during technical interviews. The system provides comprehensive answer verification with ideal answers, source URLs, and routing decisions.

## Architecture

### 1. Preprocessing Stage: Ideal Answer Generation

**When**: During question generation (Queue 1 and Queue 2)
**Purpose**: Generate verified ideal answers with authoritative source URLs

#### Implementation

```typescript
// In actions.ts - generateQuestions()
for (const question of queue1) {
  if (question.category === 'technical' && !question.answer) {
    const idealAnswerData = await generateIdealAnswer(question.question);
    if (idealAnswerData) {
      question.answer = idealAnswerData.ideal_answer;
      question.source_urls = idealAnswerData.source_urls;
    }
  }
}
```

**Function**: `generateIdealAnswer(question: string)`
- **Input**: Technical question text
- **Output**: 
  ```typescript
  {
    ideal_answer: string;      // Comprehensive technical answer
    source_urls: string[];     // 2-3 authoritative URLs
  }
  ```
- **AI Prompt**: Requests detailed answer with verifiable sources (MDN, official docs, Stack Overflow)

### 2. Evaluation Stage: Correctness Scoring

**When**: After candidate submits an answer
**Purpose**: Score answer accuracy and determine routing action

#### Implementation

```typescript
// In utils/interview.ts
export async function evaluateAnswer(
  question: string,
  userAnswer: string,
  idealAnswer?: string,
  sourceUrls?: string[]
): Promise<EvaluationResult | null>
```

**Return Structure**:
```typescript
{
  score: number;                    // 0-100 correctness score
  route_action: string;             // "next_difficulty", "normal_flow", or "followup"
  sources: string[];                // Authoritative source URLs
  ideal_answer: string;             // Reference answer
  reason?: string;                  // Scoring explanation
}
```

### 3. Routing Logic

Based on the evaluation result:

| Score Range | Route Action | Behavior |
|------------|--------------|----------|
| ≥ 80% | `next_difficulty` | Progress to medium/hard questions |
| 10-80% | `normal_flow` | Continue to next Queue 1 question |
| ≤ 10% | `followup` | Generate Queue 3 follow-up, discard depth questions |

#### Flow Rules

```typescript
// In actions.ts - analyzeAnswer()
if (evaluation.route_action === 'followup' || correctness <= 10) {
  // Add follow-up to Queue 3
  // Discard all Queue 2 questions for this topic
}
else if (evaluation.route_action === 'next_difficulty' || correctness >= 80) {
  // Move MEDIUM → Queue 1 (if base question)
  // Move HARD → Queue 1 (if medium question)
}
// else: normal_flow - just proceed to next question
```

## Storage Rules

### Only Asked Questions Are Stored

**Rule**: Store only questions that were actually asked, never unasked or discarded ones.

### QuestionEntry Structure

```typescript
interface QuestionEntry {
  question_text: string;
  user_answer: string;
  ideal_answer: string;             // From preprocessing
  correctness_score: number;        // From evaluation (0-100)
  source_urls: string[];            // From preprocessing
  question_type: 'technical' | 'non-technical' | 'followup' | 'mood-triggered';
  queue_number: 0 | 1 | 2 | 3;
  timestamp: Date;
  
  // Queue 0 specific (if active)
  mood_state?: string;
  violation_snapshot?: {
    violation_count: number;
    current_violations: string[];
  };
}
```

### Database Persistence

```typescript
// In actions.ts - appendQA()
await TechnicalInterviewEvaluationModel.findOneAndUpdate(
  { technicalInterviewId },
  { $push: { entries: dbEntry } },
  { upsert: true, new: true }
);
```

**Fields Stored**:
- Legacy fields: `question`, `correctAnswer`, `userAnswer`, `correctness`, `askedAt`
- New fields: All QuestionEntry fields including `source_urls`, `queue_number`, etc.
- Queue 0 fields: `mood_state`, `violation_snapshot` (if Queue 0 active)

## API Integration

### Gemini Prompts

#### 1. Ideal Answer Generation

```
For this technical question, provide a comprehensive ideal answer with supporting sources:

Question: {question}

Generate:
1. A detailed, technically accurate ideal answer
2. 2-3 authoritative source URLs

Return JSON:
{
  "ideal_answer": "...",
  "source_urls": ["...", "..."]
}
```

#### 2. Correctness Analysis

```
Compare these answers and determine correctness percentage:

Question: {question}
Ideal Answer: {idealAnswer}
User's Answer: {userAnswer}

Analyze the user's answer. Consider:
- Technical accuracy
- Completeness
- Correct terminology
- Conceptual understanding

Return JSON:
{
  "correctness": 85,
  "reason": "...",
  "route_action": "next_difficulty"
}
```

**route_action values**:
- `"next_difficulty"`: ≥80% score
- `"normal_flow"`: 10-80% score
- `"followup"`: ≤10% score

## Usage Example

### Complete Flow

```typescript
// 1. PREPROCESSING: Generate questions with ideal answers
const result = await generateQuestions(resume);
// result.queues.queue1[0].answer contains ideal answer
// result.queues.queue1[0].source_urls contains verification URLs

// 2. DURING INTERVIEW: Ask question
const question = await engine.askNext();

// 3. USER ANSWERS: Evaluate response
const evaluation = await evaluateAnswer(
  question.question,
  userAnswer,
  question.answer,  // ideal answer from preprocessing
  question.source_urls
);

// 4. APPLY ROUTING
const result = await analyzeAnswer(
  question.question,
  question.answer,
  userAnswer,
  engine.state.queues,
  question
);
// result.evaluation contains full EvaluationResult
// result.updatedQueues reflects routing decisions

// 5. STORE ASKED QUESTION
await appendQA(technicalInterviewId, {
  question_text: question.question,
  user_answer: userAnswer,
  ideal_answer: evaluation.ideal_answer,
  correctness_score: evaluation.score,
  source_urls: evaluation.sources,
  question_type: 'technical',
  queue_number: 1,
  timestamp: new Date()
});
```

## Key Features

### ✅ Implemented

1. **Ideal Answer Generation**
   - Comprehensive technical answers
   - Authoritative source URLs (2-3 per question)
   - Generated during preprocessing for all technical questions

2. **Correctness Scoring**
   - 0-100 scale based on accuracy, completeness, terminology
   - Considers conceptual understanding
   - Gemini-powered analysis comparing user vs ideal answer

3. **Routing Actions**
   - Automatic difficulty progression (≥80%)
   - Normal flow continuation (10-80%)
   - Follow-up generation (≤10%)

4. **Source Verification**
   - URLs stored with each question
   - Persisted in database with QA entries
   - Available for review/audit

5. **Storage Compliance**
   - Only asked questions stored
   - Full metadata including queue number, type
   - Queue 0 integration (mood, violations) when active

## Configuration

### Enable/Disable Source Generation

To skip source URL generation (faster but less verifiable):

```typescript
// In generateQuestions(), comment out:
// const idealAnswerData = await generateIdealAnswer(question.question);
```

### Adjust Scoring Thresholds

```typescript
// In actions.ts - analyzeAnswer()
if (correctness <= 10) { /* followup */ }
else if (correctness >= 80) { /* next difficulty */ }
// Adjust these thresholds as needed
```

## Performance Considerations

- **Preprocessing Time**: Each question requires 1 Gemini API call (~1-2s)
- **Evaluation Time**: Each answer requires 1 Gemini API call (~1-2s)
- **Recommendation**: Generate questions in batches or cache results

## Future Enhancements

1. **Source Ranking**: Prioritize official documentation over community sources
2. **Caching**: Store common question/answer pairs to reduce API calls
3. **Multi-Language**: Support ideal answers in different programming languages
4. **Confidence Scores**: Add confidence level to route_action
5. **Partial Credit**: More granular scoring for partially correct answers
