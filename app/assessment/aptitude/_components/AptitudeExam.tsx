'use client';
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Flag, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { useTestQuestions } from '../hooks';
import { submitTest, autoSaveTest } from '../actions';
import { useSession } from 'next-auth/react';
import { useCountdown } from '@/lib/CountdownWrapper';
import { useWarningContext } from '@/lib/WarningContext';
import type { 
  ProcessedQuestion, 
  Section, 
  QuestionStatus, 
  QuestionStats,
  SectionName
} from '../types';
const distributeQuestions = (questions: ProcessedQuestion[]): Section[] => {
  const totalQuestions = questions.length;
  const questionsPerSection = Math.ceil(totalQuestions / 4);
  
  const sectionTitles = [
    "Logical Reasoning", 
    "Quantitative Aptitude",
    "Technical",
    "Verbal Ability"
  ];
  
  
  const sections: Section[] = [];
  
  for (let i = 0; i < 4; i++) {
    const startIndex = i * questionsPerSection;
    const endIndex = Math.min(startIndex + questionsPerSection, totalQuestions);
    
    sections.push({
      name: String.fromCharCode(65 + i), 
      title: sectionTitles[i],
      questions: questions.slice(startIndex, endIndex).map((q, idx) => ({
        id: idx + 1,
        text: q.text,
        options: q.options,
        correctAnswer: q.correctAnswer
      }))
    });
  }
  
  return sections;
};

const getQuestionStatus = (
  sectionName: string, 
  questionId: number, 
  answers: Record<string, number>, 
  markedForReview: Set<string>
): QuestionStatus => {
  const key = `${sectionName}-${questionId}`;
  if (markedForReview.has(key)) return 'marked';
  if (answers[key] !== undefined) return 'attempted';
  return 'unattempted';
};

const getStatusStyles = (status: QuestionStatus, isActive: boolean = false): string => {
  if (isActive) {
    return 'bg-gradient-to-r from-indigo-500 to-rose-500 text-white border-0 shadow-lg';
  }
  
  switch (status) {
    case 'attempted': 
      return 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
    case 'marked': 
      return 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.3)]';
    default: 
      return 'bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.3)]';
  }
};

const calculateStats = (
  sections: Section[], 
  answers: Record<string, number>, 
  markedForReview: Set<string>
): QuestionStats => {
  const total = sections.reduce((acc, section) => acc + section.questions.length, 0);
  const attempted = Object.keys(answers).length;
  const marked = markedForReview.size;
  
  return { 
    total, 
    attempted,
    marked, 
    unattempted: total - attempted 
  };
};

interface AptitudeExamClientProps {
  aptitudeId: string;
}

export default function AptitudeExamClient({ aptitudeId }: AptitudeExamClientProps) {
  const { data: session } = useSession();
  const warningContext = useWarningContext();
  const [activeSection, setActiveSection] = useState('A');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // Load saved answers and marked questions from localStorage on component mount
  const [answers, setAnswers] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`aptitude_${aptitudeId}_answers`);
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });
  
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`aptitude_${aptitudeId}_marked`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    }
    return new Set();
  });
  
 
  const [submitting, setSubmitting] = useState(false);
  const [ended, setEnded] = useState(false);
  const { formattedTime, timeLeft, startTime, clearStartTime, isServerTimeValid, isLoading } = useCountdown();
  const candidateId = session?.user?._id;
  
  // Auto-submit when time is up
  React.useEffect(() => {
    if (timeLeft === 0 && !ended && !submitting) {
      handleSubmitTest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, ended, submitting]);

  // Handle server-side time expiration
  React.useEffect(() => {
    const handleServerTimeExpired = () => {
      if (!ended && !submitting) {
        console.log('⏰ Server time expired, auto-submitting test...');
        handleSubmitTest();
      }
    };

    window.addEventListener('testTimeExpired', handleServerTimeExpired);
    
    return () => {
      window.removeEventListener('testTimeExpired', handleServerTimeExpired);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, submitting]);

  // Auto-submit when warning limits are exceeded
  React.useEffect(() => {
    const handleAutoSubmit = async () => {
      if (warningContext.hasExceededLimits() && !ended && !submitting && candidateId) {
        console.log('⚠️ Warning limits exceeded, auto-submitting test...');
        
        try {
          const exceededWarnings = warningContext.getExceededWarnings();
          const terminationReason = `Test terminated due to: ${exceededWarnings.join(', ')}`;
          const warningState = warningContext.getWarningState();
          const timeTakenValue = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
          
          const result = await autoSaveTest(
            aptitudeId,
            candidateId,
            answers,
            timeTakenValue,
            warningState,
            terminationReason
          );
          
          if (result.success) {
            console.log('✅ Test auto-submitted successfully due to warning limit exceeded');
            setEnded(true);
            clearStartTime();
            // Clear saved answers from localStorage
            if (typeof window !== 'undefined') {
              localStorage.removeItem(`aptitude_${aptitudeId}_answers`);
              localStorage.removeItem(`aptitude_${aptitudeId}_marked`);
            }
          } else {
            console.error('❌ Failed to auto-submit test:', result.error);
          }
        } catch (error) {
          console.error('❌ Error during auto-submit:', error);
        }
      }
    };

    handleAutoSubmit();
  }, [warningContext, ended, submitting, candidateId, aptitudeId, answers, startTime, clearStartTime]);
  
  const { questions, loading, error } = useTestQuestions(aptitudeId);

  const sections: Section[] = distributeQuestions(questions);
  const currentSection = sections.find(s => s.name === activeSection);
  const hasQuestions = currentSection?.questions && currentSection.questions.length > 0;
  const currentQuestion = hasQuestions ? currentSection.questions[currentQuestionIndex] : undefined;
  const questionKey = `${activeSection}-${currentQuestion?.id || 'pending'}`;

 
  const stats = calculateStats(sections, answers, markedForReview);


  const handleAnswerChange = (value: string) => {
    const newAnswers = {
      ...answers,
      [questionKey]: parseInt(value)
    };
    setAnswers(newAnswers);
    // Save to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(`aptitude_${aptitudeId}_answers`, JSON.stringify(newAnswers));
    }
  };

  const handleMarkForReview = () => {
    const newSet = new Set(markedForReview);
    if (newSet.has(questionKey)) {
      newSet.delete(questionKey);
    } else {
      newSet.add(questionKey);
    }
    setMarkedForReview(newSet);
    // Save to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(`aptitude_${aptitudeId}_marked`, JSON.stringify(Array.from(newSet)));
    }
  };

  const handleNext = () => {
    if (currentQuestionIndex < (currentSection?.questions.length || 0) - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleJumpTo = (index: number) => {
    setCurrentQuestionIndex(index);
  };

  const handleSectionChange = (sectionName: string) => {
    setActiveSection(sectionName as SectionName);
    setCurrentQuestionIndex(0);
  };

  const handleSubmitTest = async () => {
    if (submitting || !candidateId) return;
    
    setSubmitting(true);
    
    // Clear saved answers from localStorage on submit
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`aptitude_${aptitudeId}_answers`);
      localStorage.removeItem(`aptitude_${aptitudeId}_marked`);
    }
    
    try {
      // Verify server time before submitting (optional validation)
      if (isServerTimeValid === false) {
        console.warn('⚠️ Server time validation failed, but proceeding with submit');
      }
      
      // Get current warning state from context
      const warningState = warningContext.getWarningState();
      console.log('🚀 AptitudeExam: About to submit test with warning state:', warningState);
      const timeTaken = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
      
      const result = await submitTest(
        aptitudeId, 
        candidateId, 
        answers, 
        timeTaken, 
        warningState, 
        warningContext.hasExceededLimits(),
        warningContext.hasExceededLimits() ? warningContext.getExceededWarnings().join(', ') : undefined
      );
      
      if (result.success) {
        clearStartTime(); // Clear start time from localStorage
        setEnded(true);
      } else {
        alert('Failed to submit test: ' + result.error);
      }
    } catch (error) {
      alert('Error submitting test. Please try again.');
      console.error('Error submitting test:', error);
    } finally {
      setSubmitting(false);
    }
  };

  // Show loading while server initializes timing
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A18] via-[#0D0D20] to-[#0A0A18] flex items-center justify-center text-white/70">
        Initializing secure exam session...
      </div>
    );
  }

  if (loading || !hasQuestions) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A18] via-[#0D0D20] to-[#0A0A18] flex items-center justify-center text-white/70">
        {loading ? 'Loading questions...' : 'No questions available'}
      </div>
    );
  }

 
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0AA18] via-[#0D0D20] to-[#0A0A18] flex items-center justify-center text-red-400">
        Error: {error}
      </div>
    );
  }

  if (!candidateId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A18] via-[#0D0D20] to-[#0A0A18] flex items-center justify-center text-red-400">
        Error: User not authenticated
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A18] via-[#0D0D20] to-[#0A0A18]">
     

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 bg-[#0A0A18]/90 backdrop-blur-xl border-b border-white/10 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-6">
              <span className="text-2xl font-bold bg-gradient-to-r from-indigo-300 to-rose-300 bg-clip-text text-transparent">
                Calibr
              </span>
              <div className="hidden md:block h-6 w-px bg-white/20"></div>
              <div className="hidden md:block">
                <h1 className="text-lg font-semibold text-white/90">Meta Software Developer</h1>
                <p className="text-xs text-white/60 -mt-1">Round 1 - Aptitude Test</p>
             
              </div>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2 text-white/70">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span className="font-mono text-lg font-bold text-white/90">
                    {formattedTime}
                  </span>
                </div>
              </div>
              
              <div className="hidden md:flex items-center space-x-4 text-sm">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                  <span className="text-white/70">{stats.attempted} Attempted</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]"></div>
                  <span className="text-white/70">{stats.marked} Marked</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                  <span className="text-white/70">{stats.unattempted} Remaining</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/10 via-transparent to-rose-900/10" />
      
      <div className="relative z-10 flex min-h-screen pt-16">
        <div className="flex-1 p-6 lg:p-8">
          <div className="max-w-4xl mx-auto h-full">
            <Card className="h-full bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl">
              <CardHeader className="pb-6">
                <Tabs
                  value={activeSection}
                  onValueChange={handleSectionChange}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-4 bg-white/5 border border-white/10 h-12">
                    {sections.map((section) => (
                      <TabsTrigger 
                        key={section.name} 
                        value={section.name}
                        className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-rose-500 data-[state=active]:text-white text-white/70 hover:text-white transition-all duration-300 font-medium"
                      >
                        Section {section.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                
                <div className="flex items-center justify-between mt-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white/90">{currentSection?.title}</h2>
                    <p className="text-sm text-white/60">
                      Question {currentQuestionIndex + 1} of {currentSection?.questions.length}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">
                      {currentQuestionIndex + 1}
                    </div>
                    <div className="text-xs text-white/60">Current</div>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="flex-1 flex flex-col">
                <div className="flex-1">
                  <div className="mb-8">
                    <h3 className="text-xl md:text-2xl font-medium text-white leading-relaxed mb-6">
                      {currentQuestion?.text}
                    </h3>
                    
                    <RadioGroup 
                      value={answers[questionKey]?.toString()} 
                      onValueChange={handleAnswerChange}
                      className="space-y-3"
                    >
                      {currentQuestion?.options.map((option, idx) => (
                        <div key={idx} className="group">
                          <div className="flex items-center space-x-4 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer">
                            <RadioGroupItem 
                              value={idx.toString()} 
                              id={`opt-${activeSection}-${idx}`}
                              className="border-white/30 text-white data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-indigo-500 data-[state=checked]:to-rose-500 data-[state=checked]:border-transparent"
                            />
                            <Label 
                              htmlFor={`opt-${activeSection}-${idx}`}
                              className="flex-1 text-white/90 cursor-pointer text-base leading-relaxed group-hover:text-white transition-colors"
                            >
                              <span className="font-medium text-white/60 mr-2">
                                {String.fromCharCode(65 + idx)}.
                              </span>
                              {option}
                            </Label>
                          </div>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-white/10">
                  <Button 
                    variant="outline" 
                    onClick={handlePrev} 
                    disabled={currentQuestionIndex === 0}
                    className="bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Previous
                  </Button>
                  
                  <Button 
                    variant="outline"
                    onClick={handleMarkForReview}
                    className={`bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white transition-all duration-200 ${
                      markedForReview.has(questionKey) ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : ''
                    }`}
                  >
                    <Flag className="h-4 w-4 mr-2" />
                    {markedForReview.has(questionKey) ? 'Unmark' : 'Mark for Review'}
                  </Button>
                  
                  <div className="flex-1"></div>
                  
                  <Button
                    onClick={handleNext}
                    disabled={currentQuestionIndex === (currentSection?.questions.length || 0) - 1}
                    className="bg-gradient-to-r from-indigo-500 to-rose-500 hover:from-indigo-600 hover:to-rose-600 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Side - Sidebar */}
        <div className="w-80 xl:w-96 p-6 lg:p-8 border-l border-white/10 bg-black/20 backdrop-blur-sm">
          <div className="sticky top-24 space-y-6">
            {/* Timer Card */}
            <Card className="bg-white/5 backdrop-blur-xl border border-white/10">
              <CardContent className="p-6 text-center">
                <div className="flex items-center justify-center mb-2">
                  <div className="w-5 h-5 rounded-full bg-blue-500 shadow-[0_0_12px_RGBA(0,0,255,0.6)]" />
                  <span className="text-sm font-medium text-white/70 ml-2">Test in Progress</span>
                </div>
                <div className="text-3xl font-mono font-bold bg-gradient-to-r from-indigo-400 to-rose-400 bg-clip-text text-transparent">
                  Active
                </div>
              </CardContent>
            </Card>

            {/* Instructions */}
            <Card className="bg-white/5 backdrop-blur-xl border border-white/10">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-white">Instructions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]" />
                  <span className="text-white/80 text-sm">Attempted</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]" />
                  <span className="text-white/80 text-sm">Unattempted</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
                  <span className="text-white/80 text-sm">Marked for Review</span>
                </div>
              </CardContent>
            </Card>

            {/* Current Section */}
            <Card className="bg-white/5 backdrop-blur-xl border border-white/10">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-white">
                  Section {activeSection} - {currentSection?.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-2">
                  {currentSection?.questions.map((q, idx) => {
                    const status = getQuestionStatus(activeSection, q.id, answers, markedForReview);
                    const isActive = idx === currentQuestionIndex;
                    return (
                      <Button
                        key={q.id}
                        variant="outline"
                        className={`w-12 h-12 rounded-lg p-0 text-sm font-medium transition-all duration-200 ${getStatusStyles(status, isActive)}`}
                        onClick={() => handleJumpTo(idx)}
                      >
                        {q.id}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Submit Button */}
            <Button 
              onClick={handleSubmitTest}
              disabled={submitting || ended}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-semibold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-5 w-5 mr-2" />
              {submitting ? 'Submitting...' : 'Submit Test'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
