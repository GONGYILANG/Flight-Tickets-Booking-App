import mongoose from "mongoose";

const { Schema } = mongoose;

const priceSnapshotSchema = new Schema(
  {
    unitPriceCents: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "unitPriceCents must be a safe integer",
      },
    },
    totalPriceCents: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "totalPriceCents must be a safe integer",
      },
    },
    currency: {
      type: String,
      required: true,
      enum: ["USD"],
      default: "USD",
    },
  },
  { _id: false },
);

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
      lowercase: true,
      trim: true,
      maxlength: 36,
    },
    priceSnapshot: {
      type: priceSnapshotSchema,
      required: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationSource: {
      type: String,
      enum: ["USER", "ADMIN", "FLIGHT"],
      default: null,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "bookings",
  },
);

bookingSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, name: "user_1_idempotencyKey_1" },
);
bookingSchema.index({ user: 1, createdAt: -1, _id: -1 });
bookingSchema.index({ flight: 1, status: 1 });
bookingSchema.index({ createdAt: -1, _id: -1 });
bookingSchema.index({ status: 1, createdAt: -1, _id: -1 });
bookingSchema.index({ flight: 1, createdAt: -1, _id: -1 });

bookingSchema.pre("validate", function validatePriceSnapshot() {
  if (
    this.priceSnapshot &&
    Number.isSafeInteger(this.priceSnapshot.unitPriceCents) &&
    Number.isSafeInteger(this.seatCount) &&
    this.priceSnapshot.totalPriceCents !==
      this.priceSnapshot.unitPriceCents * this.seatCount
  ) {
    this.invalidate(
      "priceSnapshot.totalPriceCents",
      "totalPriceCents must equal unitPriceCents multiplied by seatCount",
    );
  }
});

export default mongoose.model("Booking", bookingSchema);
