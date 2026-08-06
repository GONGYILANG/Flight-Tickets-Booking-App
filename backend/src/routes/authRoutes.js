import { Router } from "express";
import { login, me, register } from "../controllers/authController.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  validateLogin,
  validateRegister,
} from "../validators/authValidators.js";

const router = Router();

router.post("/register", validateRegister, register);
router.post("/login", validateLogin, login);
router.get("/me", authenticate, me);

export default router;
