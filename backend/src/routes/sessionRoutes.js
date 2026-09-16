import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import {
  appendSessionMessages,
  createSession,
  deleteSessionForUser,
  getSessionForUser,
  listSessionsForUser,
} from "../services/sessionService.js";
import {
  validateAppendSessionMessages,
  validateCreateSession,
  validateListSessions,
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

router.get("/", authenticate, validateListSessions, async (request, response) => {
  response.json({
    data: await listSessionsForUser({
      userId: request.user._id,
      ...request.validatedQuery,
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
  "/:sessionId/messages",
  authenticate,
  validateSessionId,
  validateAppendSessionMessages,
  async (request, response) => {
    await appendSessionMessages({
      userId: request.user._id,
      sessionId: request.params.sessionId,
      ...request.validatedBody,
    });
    response.status(204).end();
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
