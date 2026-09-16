import mongoose from "mongoose";

const { Schema } = mongoose;

const eventSchema = new Schema(
  {
    tool: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const turnSchema = new Schema(
  {
    session: { type: Schema.Types.ObjectId, ref: "Session", required: true },
    // Reuse the middle layer's requestId for retry-safe creation and completion.
    turnId: {
      type: String,
      required: true,
      match: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    },
    sequence: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
    // Preserve the serialized SDK message, including provider-specific fields.
    messages: { type: [Schema.Types.Mixed], required: true },
    view: {
      userMessage: { type: String, required: true },
      assistantMessage: { type: String, default: null },
      events: { type: [eventSchema], default: [] },
    },
    error: { type: String, default: null },
  },
  { timestamps: true, collection: "turns", minimize: false },
);

turnSchema.index({ session: 1, turnId: 1 }, { unique: true });
turnSchema.index({ session: 1, sequence: 1 }, { unique: true });

export default mongoose.model("Turn", turnSchema);
