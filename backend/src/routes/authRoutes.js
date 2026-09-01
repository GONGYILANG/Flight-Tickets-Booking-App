import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import {
  loginUser,
  registerUser,
  toSafeUser,
} from "../services/authService.js";
import {
  validateLogin,
  validateRegister,
} from "../validators/authValidators.js";

const router = Router();

router.post("/register", validateRegister, async (request, response) => {
  response.status(201).json({ data: await registerUser(request.validatedBody) });
});
router.post("/login", validateLogin, async (request, response) => {
  response.json({ data: await loginUser(request.validatedBody) });
});
router.get("/me", authenticate, (request, response) => {
  response.json({ data: { user: toSafeUser(request.user) } });
});

export default router;
