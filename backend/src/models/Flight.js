import mongoose from "mongoose";

const { Schema } = mongoose;

const scheduleChangeSchema = new Schema(
  {
    revision: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Schedule revision must be a safe integer",
      },
    },
    previousDepartureAt: {
      type: Date,
      required: true,
    },
    previousArrivalAt: {
      type: Date,
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
    changedAt: {
      type: Date,
      required: true,
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 500,
    },
  },
  { _id: false },
);

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
    scheduledDepartureAt: {
      type: Date,
      default() {
        return this.departureAt ?? null;
      },
    },
    scheduledArrivalAt: {
      type: Date,
      default() {
        return this.arrivalAt ?? null;
      },
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
    scheduleVersion: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "Schedule version must be a safe integer",
      },
    },
    scheduleUpdatedAt: {
      type: Date,
      default: null,
    },
    scheduleUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    scheduleReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    scheduleChanges: {
      type: [scheduleChangeSchema],
      default: [],
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
flightSchema.index({ status: 1, departureAt: 1, _id: 1 });
flightSchema.index({ flightNumber: 1, departureAt: 1, _id: 1 });
flightSchema.index(
  { airline: 1, flightNumber: 1, scheduledDepartureAt: 1 },
  {
    unique: true,
    name: "airline_1_flightNumber_1_scheduledDepartureAt_1",
  },
);

flightSchema.pre("validate", function validateFlight() {
  if (!this.scheduledDepartureAt && this.departureAt) {
    this.scheduledDepartureAt = this.departureAt;
  }
  if (!this.scheduledArrivalAt && this.arrivalAt) {
    this.scheduledArrivalAt = this.arrivalAt;
  }

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
    this.scheduledDepartureAt &&
    this.scheduledArrivalAt &&
    this.scheduledArrivalAt <= this.scheduledDepartureAt
  ) {
    this.invalidate(
      "scheduledArrivalAt",
      "Scheduled arrival time must be after scheduled departure time",
    );
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
