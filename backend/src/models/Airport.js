import mongoose from "mongoose";

const airportSchema = new mongoose.Schema(
  {
    iataCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      match: /^[A-Z]{3}$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    cityName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 2,
      match: /^[A-Z]{2}$/,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
  },
  {
    timestamps: true,
    collection: "airports",
  },
);

airportSchema.index({ cityName: 1 });

export default mongoose.model("Airport", airportSchema);
