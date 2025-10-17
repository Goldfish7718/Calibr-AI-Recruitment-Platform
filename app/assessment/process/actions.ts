'use server';

import { 
  safeAction, 
  createSuccessResponse,
  createErrorResponse,
  withDatabase,
  type ActionResponse 
} from '@/utils/action-helpers';
import { requireAuth } from '@/utils/auth-helpers';
import AssessmentModel from '@/models/assesment.model';
import '@/models/aptitude.model'; 
import '@/models/coding.model'; 

import mongoose from 'mongoose';

export interface AssessmentDetails {
  _id: string;
  title: string;
  description?: string;
  status: string;
  toConductRounds: {
    aptitude: boolean;
    coding: boolean;
    technicalInterview: boolean;
    hrInterview: boolean;
  };
  technicalInterviewId?: string;
  aptitudeDetails?: {
    _id: string;
    totalQuestions: number;
    duration: number;
    passingScore: number;
    sectionWeightage: {
      logicalReasoning: number;
      quantitative: number;
      technical: number;
      verbal: number;
    };
    questionPool: {
      logicalReasoning: number;
      quantitative: number;
      technical: number;
      verbal: number;
    };
    randomizeQuestions: boolean;
    showResultImmediately: boolean;
    allowReviewBeforeSubmit: boolean;
    negativeMarking: boolean;
    negativeMarkingPercentage?: number;
    warnings: {
      fullscreen: number;
      tabSwitch: number;
      audio: number;
    };
  };
  codingDetails?: {
    _id: string;
    totalProblems: number;
    duration: number;
    passingScore: number;
    difficultyWeightage: {
      easy: number;
      medium: number;
      hard: number;
    };
    problemPool: {
      easy: number;
      medium: number;
      hard: number;
    };
    randomizeProblems: boolean;
    manuallyAddProblems: boolean;
    showResultImmediately: boolean;
    allowReviewBeforeSubmit: boolean;
    languages: string[];
    compilerTimeout: number;
    memoryLimit: number;
    warnings: {
      fullscreen: number;
      tabSwitch: number;
      audio: number;
    };
  };
  overallPassingCriteria: {
    minimumRoundsToPass: number;
    overallMinimumScore?: number;
    weightagePerRound: {
      aptitude?: number;
      coding?: number;
      technicalInterview?: number;
      hrInterview?: number;
    };
  };
  instructions?: string;
  candidateInstructions?: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function fetchAssessmentDetails(
  assessmentId: string
): Promise<ActionResponse<AssessmentDetails>> {
  return safeAction(async () => {
    await requireAuth(); // Ensure user is authenticated

    if (!mongoose.Types.ObjectId.isValid(assessmentId)) {
      return createErrorResponse('Invalid assessment ID');
    }

    return await withDatabase(async () => {
      // Fetch assessment with populated aptitude and coding details
      const assessment = await AssessmentModel.findById(assessmentId)
        .populate('aptitudeId')
        .populate('codingRoundId')
        .lean();

        console.log("Ae" , assessment);

      if (!assessment) {
        return createErrorResponse('Assessment not found');
      }

      // Check if assessment is active or draft
      if (!['active', 'draft'].includes(assessment.status)) {
        return createErrorResponse('Assessment is not available');
      }

      // Transform aptitude details if available
      let aptitudeDetails = undefined;
      if (assessment.aptitudeId && assessment.toConductRounds?.aptitude) {
        const aptitude = assessment.aptitudeId as any;
        aptitudeDetails = {
          _id: aptitude._id.toString(),
          totalQuestions: aptitude.totalQuestions,
          duration: aptitude.duration,
          passingScore: aptitude.passingScore,
          sectionWeightage: aptitude.sectionWeightage,
          questionPool: aptitude.questionPool,
          randomizeQuestions: aptitude.randomizeQuestions,
          showResultImmediately: aptitude.showResultImmediately,
          allowReviewBeforeSubmit: aptitude.allowReviewBeforeSubmit,
          negativeMarking: aptitude.negativeMarking,
          negativeMarkingPercentage: aptitude.negativeMarkingPercentage,
          warnings: aptitude.warnings
        };
      }

      // Transform coding details if available
      let codingDetails = undefined;
      if (assessment.codingRoundId && assessment.toConductRounds?.coding) {
        const coding = assessment.codingRoundId as any;
        codingDetails = {
          _id: coding._id.toString(),
          totalProblems: coding.totalProblems,
          duration: coding.duration,
          passingScore: coding.passingScore,
          difficultyWeightage: coding.difficultyWeightage,
          problemPool: coding.problemPool,
          randomizeProblems: coding.randomizeProblems,
          manuallyAddProblems: coding.manuallyAddProblems,
          showResultImmediately: coding.showResultImmediately,
          allowReviewBeforeSubmit: coding.allowReviewBeforeSubmit,
          languages: coding.languages,
          compilerTimeout: coding.compilerTimeout,
          memoryLimit: coding.memoryLimit,
          warnings: coding.warnings
        };
      }

      const assessmentDetails: AssessmentDetails = {
        _id: assessment._id.toString(),
        title: assessment.title,
        description: assessment.description,
        status: assessment.status,
        toConductRounds: assessment.toConductRounds,
        technicalInterviewId: assessment.technicalInterviewId?.toString(),
        aptitudeDetails,
        codingDetails,
        overallPassingCriteria: assessment.overallPassingCriteria,
        instructions: assessment.instructions,
        candidateInstructions: assessment.candidateInstructions,
        createdAt: assessment.createdAt,
        updatedAt: assessment.updatedAt
      };

      return createSuccessResponse('Assessment details fetched successfully', assessmentDetails);
    });
  });
}
