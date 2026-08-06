import mongoose from "mongoose";

const { Schema } = mongoose;

const bookingSchema = new Schema(
  {
    bookingReference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 16,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    flight: {
      type: Schema.Types.ObjectId,
      ref: "Flight",
      required: true,
    },
    seatCount: {
      type: Number,
      required: true,
      min: 1,
      max: 9,
      default: 1,
    },
    source: {
      type: String,
      enum: ["UI", "AI"],
      default: "UI",
    },
    status: {
      type: String,
      enum: ["CONFIRMED", "CANCELLED"],
      default: "CONFIRMED",
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 100,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "bookings",
  },
);

bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ flight: 1, status: 1 });

export default mongoose.model("Booking", bookingSchema);
