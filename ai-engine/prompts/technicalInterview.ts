// Gemini prompts for technical interview (moved from utils/interview.ts)

export const IDEAL_ANSWER_PROMPT = (question: string) => `For this technical question, provide a comprehensive ideal answer with supporting sources:

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

export const EVALUATE_ANSWER_PROMPT = (question: string, idealAnswer: string, userAnswer: string) => `Compare these answers and determine correctness percentage:

Question: ${question}
Ideal Answer: ${idealAnswer}
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
export const buildQueue1Prompt = (
  jobData: {
    title: string;
    position: string;
    department: string;
    seniority: string;
    techStack: string[];
    description?: string;
    requirements?: string;
  },
  resumeData: {
    tagline?: string;
    summary?: string;
    workDetails?: any[];
    education?: any[];
    skills?: string;
    projects?: any[];
    certificates?: any[];
  }
): string => {
  const jobContext = `
JOB OPPORTUNITY:
- Title: ${jobData.title}
- Position: ${jobData.position}
- Department: ${jobData.department}
- Seniority Level: ${jobData.seniority}
- Required Tech Stack: ${jobData.techStack.join(', ')}
${jobData.description ? `- Description: ${jobData.description}` : ''}
${jobData.requirements ? `- Requirements: ${jobData.requirements}` : ''}
`;

  const resumeContext = `
CANDIDATE PROFILE:
${resumeData.tagline ? `- Tagline: ${resumeData.tagline}` : ''}
${resumeData.summary ? `- Summary: ${resumeData.summary}` : ''}
${resumeData.skills ? `- Skills: ${resumeData.skills}` : ''}
${resumeData.education && resumeData.education.length > 0 ? `- Education: ${resumeData.education.map(e => `${e.degree} from ${e.institution} (${e.year})`).join('; ')}` : ''}
${resumeData.workDetails && resumeData.workDetails.length > 0 ? `- Work Experience: ${resumeData.workDetails.map(w => `${w.position} at ${w.company} - ${w.description}`).join('; ')}` : ''}
${resumeData.projects && resumeData.projects.length > 0 ? `- Projects: ${resumeData.projects.map(p => `${p.name}: ${p.description}`).join('; ')}` : ''}
${resumeData.certificates && resumeData.certificates.length > 0 ? `- Certifications: ${resumeData.certificates.map(c => `${c.name} from ${c.issuer}`).join('; ')}` : ''}
`;

  return `You are conducting a technical interview for the following position. Generate comprehensive, tailored interview questions based on BOTH the job requirements AND the candidate's background.

${jobContext}

${resumeContext}

INTERVIEW STRUCTURE:
Generate questions that:
1. **Assess fit for the specific role** - Focus on ${jobData.position} responsibilities and ${jobData.seniority} level expectations
2. **Match required tech stack** - Prioritize questions about: ${jobData.techStack.join(', ')}
3. **Explore candidate's experience** - Deep dive into their mentioned projects, work experience, and skills
4. **Progressive difficulty** - Start with fundamentals, move to advanced concepts based on seniority (${jobData.seniority})
5. **Real-world scenarios** - Include practical problems relevant to ${jobData.department} department

QUESTION CATEGORIES (15-20 questions total):
1. Introduction & Role Understanding (2-3 questions)
2. Tech Stack Deep Dive - ${jobData.techStack.slice(0, 3).join(', ')} (5-7 questions)
3. Candidate's Projects & Experience (3-4 questions) 
4. Problem-Solving & System Design for ${jobData.position} (3-4 questions)
5. Advanced Concepts for ${jobData.seniority} level (2-3 questions)

For TECHNICAL questions, you MUST provide the correct answer.

Return ONLY a JSON array in this exact format:
[
  {"question": "Tell me about your experience with [specific tech from their resume] and how it applies to [job requirement]", "category": "non-technical", "answer": ""},
  {"question": "Explain [core concept from required tech stack] and how you would use it in a ${jobData.position} role", "category": "technical", "answer": "detailed technical answer"},
  {"question": "Walk me through your [specific project from resume]. What challenges did you face?", "category": "non-technical", "answer": ""}
]

CRITICAL: 
- Ensure at least 80% are technical questions
- Tailor difficulty to ${jobData.seniority} level (junior=basics, mid=intermediate+design, senior=architecture+optimization)
- Reference specific items from candidate's resume to make questions personal
- Focus heavily on ${jobData.techStack.join(', ')} technologies
`;
};

export const buildQueue2Prompt = (question: string, correctAnswer: string): string => `Based on this technical question:
Question: ${question}
Correct Answer: ${correctAnswer}

Generate 2 follow-up questions:
1. MEDIUM difficulty - dig deeper into the topic
2. HARD difficulty - advanced/complex scenario

Return ONLY a JSON array:
[
  {"question": "medium question", "difficulty": "medium", "answer": "correct answer"},
  {"question": "hard question", "difficulty": "hard", "answer": "correct answer"}
]`;

/**
 * Generate ideal answer with source URLs for verification
 */
export const buildIdealAnswerPrompt = (question: string): string => `For this technical question, provide a comprehensive ideal answer with supporting sources:

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

export const buildAnalysisPrompt = (question: string, idealAnswer: string, userAnswer: string): string => `Compare these answers and determine correctness percentage:

Question: ${question}
Ideal Answer: ${idealAnswer}
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

export const buildFollowupPrompt = (question: string, wrongAnswer: string): string => `The candidate gave a completely wrong answer:

Question: ${question}
Wrong Answer: ${wrongAnswer}

Generate ONE strong follow-up question to clarify their understanding or correct their misconception.

Return ONLY a JSON object:
{"question": "your follow-up question"}`;

export const buildMoodFollowupPrompt = (mood: string, context: string): string => `The candidate is showing signs of ${mood} during the interview.

Current context: ${context}

Generate ONE empathetic follow-up question that:
1. Acknowledges their emotional state appropriately
2. Helps them feel more comfortable
3. Allows them to clarify or elaborate

Return ONLY a JSON object:
{"question": "your mood-based follow-up question"}`;

// Batched generation prompt: limit number of questions
export const buildQueue1BatchPrompt = (
  jobData: {
    title: string;
    position: string;
    techStack: string[];
    seniority: string;
  },
  resumeData: {
    skills?: string;
    projects?: any[];
    workDetails?: any[];
  },
  count: number
): string => `Generate ONLY ${count} tailored technical interview questions for a ${jobData.position} (${jobData.seniority} level) position.

Required Tech Stack: ${jobData.techStack.join(', ')}
Candidate Skills: ${resumeData.skills || 'Not specified'}

For technical questions, include the correct answer.

Return ONLY a JSON array:
[
  {"question": "technical question about required stack", "category": "technical", "answer": "correct answer"},
  {"question": "question about candidate's experience", "category": "non-technical", "answer": ""}
]

Ensure at least 80% are technical questions focused on ${jobData.techStack.join(', ')}.`;


