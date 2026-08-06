import {
  loginUser,
  registerUser,
  toSafeUser,
} from "../services/authService.js";

export async function register(request, response) {
  const result = await registerUser(request.validatedBody);
  response.status(201).json({ data: result });
}

export async function login(request, response) {
  const result = await loginUser(request.validatedBody);
  response.status(200).json({ data: result });
}

export function me(request, response) {
  response.status(200).json({ data: { user: toSafeUser(request.user) } });
}
