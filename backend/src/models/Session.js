import mongoose from "mongoose";

const { Schema } = mongoose;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sessionSchema = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: uuidPattern,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      default: "New conversation",
      maxlength: 80,
    },
    // Allocates ordering keys, not a turn count: failed/retried inserts can leave gaps.
    nextSequence: { type: Number, default: 0, min: 0 },
    deleting: { type: Boolean, default: false },
    lastAccess: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "sessions",
  },
);

sessionSchema.index({ user: 1, lastAccess: -1, _id: -1 });

export default mongoose.model("Session", sessionSchema);
