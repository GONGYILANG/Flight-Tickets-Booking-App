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
    // An embedded history has MongoDB's 16 MB document limit;
    // move messages to a separate collection if sessions approach it.
    history: {
      type: [Schema.Types.Mixed],
      default: [],
    },
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
