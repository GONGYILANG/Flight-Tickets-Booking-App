import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import User from "../models/User.js";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const applyChanges = process.argv.includes("--apply");
const email = argumentValue("--email")?.trim().toLowerCase();
const role = argumentValue("--role")?.trim().toUpperCase();

async function setUserRole() {
  if (!email) {
    throw new Error("--email is required");
  }
  if (!new Set(["USER", "ADMIN"]).has(role)) {
    throw new Error("--role must be USER or ADMIN");
  }

  const connection = await connectDatabase();
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error(`User was not found: ${email}`);
  }

  const currentRole = user.role ?? "USER";
  console.log(
    JSON.stringify(
      {
        database: connection.name,
        mode: applyChanges ? "APPLY" : "REPORT_ONLY",
        userId: user._id.toString(),
        email: user.email,
        status: user.status,
        currentRole,
        requestedRole: role,
      },
      null,
      2,
    ),
  );

  if (currentRole === role) {
    console.log("User already has the requested role; no change is needed");
    return;
  }
  if (currentRole === "ADMIN" && role === "USER" && user.status === "ACTIVE") {
    const activeAdminCount = await User.countDocuments({
      role: "ADMIN",
      status: "ACTIVE",
    });
    if (activeAdminCount <= 1) {
      throw new Error("The final active administrator cannot be demoted");
    }
  }

  if (!applyChanges) {
    console.log("No changes applied. Re-run with --apply to change the role.");
    return;
  }

  await User.updateOne({ _id: user._id }, { $set: { role } });
  console.log(`Role updated to ${role} for ${user.email}`);
}

try {
  await setUserRole();
} catch (error) {
  console.error("User role update failed:", error.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
