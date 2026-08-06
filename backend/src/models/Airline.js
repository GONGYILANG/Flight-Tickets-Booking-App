import mongoose from "mongoose";

const airlineSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 3,
      match: /^[A-Z0-9]{2,3}$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "airlines",
  },
);

export default mongoose.model("Airline", airlineSchema);
