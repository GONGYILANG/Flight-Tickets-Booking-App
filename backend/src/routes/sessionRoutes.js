import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import {
  startTurn,
  finishTurn,
  createSession,
  deleteSessionForUser,
  getSessionForUser,
  listSessionsForUser,
} from "../services/sessionService.js";
import {
  validateStartTurn,
  validateFinishTurn,
  validateCreateSession,
  validateSessionId,
} from "../validators/sessionValidators.js";

const router = Router();

router.post("/", authenticate, validateCreateSession, async (request, response) => {
  const result = await createSession({
    userId: request.user._id,
    ...request.validatedBody,
  });
  response.status(result.alreadyExists ? 200 : 201).json({
    data: { session: result.session },
    meta: { alreadyExists: result.alreadyExists },
  });
});

router.get("/", authenticate, async (request, response) => {
  response.json({
    data: await listSessionsForUser({
      userId: request.user._id,
    }),
  });
});

router.get("/:sessionId", authenticate, validateSessionId, async (request, response) => {
  response.json({
    data: {
      session: await getSessionForUser({
        userId: request.user._id,
        sessionId: request.params.sessionId,
      }),
    },
  });
});

router.post(
  "/:sessionId/turns",
  authenticate,
  validateSessionId,
  validateStartTurn,
  async (request, response) => {
    const result = await startTurn({
      userId: request.user._id,
      sessionId: request.params.sessionId,
      ...request.validatedBody,
    });
    response.status(result.alreadyExists ? 200 : 201).json({
      data: { turn: result.turn },
      meta: { alreadyExists: result.alreadyExists },
    });
  },
);

router.post(
  "/:sessionId/turns/:turnId/finish",
  authenticate,
  validateSessionId,
  validateFinishTurn,
  async (request, response) => {
    const result = await finishTurn({
      userId: request.user._id,
      sessionId: request.params.sessionId,
      turnId: request.params.turnId,
      ...request.validatedBody,
    });
    response.json({
      data: { turn: result.turn },
      meta: { alreadyCompleted: result.alreadyCompleted },
    });
  },
);

router.delete("/:sessionId", authenticate, validateSessionId, async (request, response) => {
  await deleteSessionForUser({
    userId: request.user._id,
    sessionId: request.params.sessionId,
  });
  response.status(204).end();
});

export default router;
