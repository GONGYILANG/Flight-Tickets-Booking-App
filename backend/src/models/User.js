import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 320,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "LOCKED", "DISABLED"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

export default mongoose.model("User", userSchema);
