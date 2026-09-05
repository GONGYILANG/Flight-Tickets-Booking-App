const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "24h";

if (!jwtSecret || Buffer.byteLength(jwtSecret, "utf8") < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 bytes");
}

if (!/^[1-9]\d*[smhd]$/.test(jwtExpiresIn)) {
  throw new Error("JWT_EXPIRES_IN must use a value such as 30m, 24h, or 7d");
}

export const authConfig = Object.freeze({
  jwtSecret,
  jwtExpiresIn,
  jwtAlgorithm: "HS256",
  jwtIssuer: "flight-booking-api",
  jwtAudience: "flight-booking-android",
  bcryptCost: 12,
});
