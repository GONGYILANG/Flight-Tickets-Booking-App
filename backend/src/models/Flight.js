import mongoose from "mongoose";

const { Schema } = mongoose;

const flightSchema = new Schema(
  {
    airline: {
      type: Schema.Types.ObjectId,
      ref: "Airline",
      required: true,
    },
    flightNumber: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 12,
    },
    originAirport: {
      type: Schema.Types.ObjectId,
      ref: "Airport",
      required: true,
    },
    destinationAirport: {
      type: Schema.Types.ObjectId,
      ref: "Airport",
      required: true,
    },
    departureAt: {
      type: Date,
      required: true,
    },
    arrivalAt: {
      type: Date,
      required: true,
    },
    priceCents: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Flight price must be a safe integer number of cents",
      },
    },
    totalSeats: {
      type: Number,
      required: true,
      min: 1,
    },
    availableSeats: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["SCHEDULED", "DELAYED", "CANCELLED", "DEPARTED", "ARRIVED"],
      default: "SCHEDULED",
    },
    statusUpdatedAt: {
      type: Date,
      default: null,
    },
    statusUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    statusReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "flights",
  },
);

flightSchema.index({ originAirport: 1, destinationAirport: 1, departureAt: 1 });
flightSchema.index({ airline: 1, departureAt: 1 });
flightSchema.index({ departureAt: 1, _id: 1 });
flightSchema.index({ arrivalAt: 1, _id: 1 });
flightSchema.index({ availableSeats: 1, _id: 1 });
flightSchema.index({ priceCents: 1, _id: 1 });
flightSchema.index(
  { airline: 1, flightNumber: 1, departureAt: 1 },
  { unique: true },
);

flightSchema.pre("validate", function validateFlight() {
  if (
    this.originAirport &&
    this.destinationAirport &&
    this.originAirport.equals(this.destinationAirport)
  ) {
    this.invalidate(
      "destinationAirport",
      "Origin and destination airports cannot be the same",
    );
  }

  if (this.departureAt && this.arrivalAt && this.arrivalAt <= this.departureAt) {
    this.invalidate("arrivalAt", "Arrival time must be after departure time");
  }

  if (
    Number.isFinite(this.totalSeats) &&
    Number.isFinite(this.availableSeats) &&
    this.availableSeats > this.totalSeats
  ) {
    this.invalidate(
      "availableSeats",
      "Available seats cannot exceed total seats",
    );
  }
});

export default mongoose.model("Flight", flightSchema);
