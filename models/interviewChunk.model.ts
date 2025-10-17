import mongoose, { Schema, Document } from "mongoose";

/**
 * Interview Chunk Model
 * Stores preprocessed chunks for both Technical and HR interviews
 * Each chunk contains questions, ideal answers, and TTS audio URLs
 */

export interface IInterviewChunk extends Document {
  interviewId: string;
  interviewType: "technical" | "hr";
  chunkNumber: number;
  questions: {
    id: string;
    question: string;
    category: string;
    difficulty?: string;
    answer?: string;
    source_urls?: string[];
    audioUrl?: string; // S3 URL for TTS audio
  }[];
  preprocessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema({
  id: { type: String, required: true },
  question: { type: String, required: true },
  category: { type: String, required: true },
  difficulty: { type: String },
  answer: { type: String },
  source_urls: [{ type: String }],
  audioUrl: { type: String }, // S3 URL for TTS audio
});

const InterviewChunkSchema = new Schema<IInterviewChunk>(
  {
    interviewId: {
      type: String,
      required: true,
      index: true,
    },
    interviewType: {
      type: String,
      required: true,
      enum: ["technical", "hr"],
      index: true,
    },
    chunkNumber: {
      type: Number,
      required: true,
      index: true,
    },
    questions: {
      type: [QuestionSchema],
      required: true,
      default: [],
    },
    preprocessedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying
InterviewChunkSchema.index({ interviewId: 1, chunkNumber: 1 }, { unique: true });
InterviewChunkSchema.index({ interviewId: 1, interviewType: 1 });

const InterviewChunkModel =
  mongoose.models.InterviewChunk ||
  mongoose.model<IInterviewChunk>("InterviewChunk", InterviewChunkSchema);

export default InterviewChunkModel;
